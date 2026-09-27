#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { Glob } from "bun";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { splits, type Split } from "../corrections/comments.ts";
import { readLabels } from "../corrections/labels.ts";
import { isProductionSource } from "./change.ts";
import { configDigest, readConfig } from "./config.ts";
import { isolatedFixes, readCorpus, stableOrder, verifyHeldOutDigest } from "./corpus.ts";
import { falseAlarmLabelSchema, flagsToJudge, writeFalseAlarmPackets } from "./evaluation/false-alarms.ts";
import { cleanPullRequests, correctionCases, readSlimPullRequests, type CleanPullRequest, type CorrectionCase } from "./evaluation/jobs.ts";
import type { ScoredCase } from "./evaluation/metrics.ts";
import { scopeIndexResults } from "./evaluation/scope-index.ts";
import { GradeStore, type StoredGrade } from "./evaluation/store.ts";
import { timeConsecutiveCommits } from "./evaluation/timing.ts";
import { tuningReport } from "./evaluation/tuning.ts";
import { developmentTables, validationReport, type EvaluatedSplit } from "./evaluation/validation.ts";
import { createGrader } from "./grade.ts";
import { addressed, readVerifications } from "./verification.ts";

const usage = `Usage: bun benchmark/grader/evaluate.ts <stage> --split development|heldout --posthog ~/dev/posthog [--shard 0/4] [--config <file>]

Stages:
  grade         grade the corpus ranges and the clean pull requests (resumable, shardable)
  report        the tuning table (development)
  false-alarms  judge packets for the flags on clean pull requests
  scope         the old scope index and #95's diff-local prototype on a sample of verified fixes
  validate      write docs/corrections/grader-validation.md (held-out)
  timing        grade consecutive mainline commits in one process (--commits 100)`;
const stages = ["grade", "report", "false-alarms", "scope", "validate", "timing"];
const scopeSampleSize = 40;
const cleanSampleSize = 200;
const falseAlarmLabels = join(import.meta.dir, "false-alarms");
const validationFile = join(import.meta.dir, "..", "..", "docs", "corrections", "grader-validation.md");
const evaluationSources = new Set(["evaluate.ts", "verification.ts", "corpus.ts"]);
const frozenFile = join(import.meta.dir, "frozen.json");
const FrozenSchema = z.object({ configSha256: z.string(), graderSha256: z.string(), frozenAt: z.string() });

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    split: { type: "string" },
    posthog: { type: "string" },
    shard: { type: "string", default: "0/1" },
    commits: { type: "string", default: "100" },
    work: { type: "string", default: join(import.meta.dir, "..", ".cache", "corrections") },
    cache: { type: "string", default: join(import.meta.dir, "..", ".cache", "grader") },
    config: { type: "string" },
  },
});

const stage = positionals[0] ?? "";
const split = z.enum(splits).safeParse(values.split);
if (!values.posthog || !stages.includes(stage) || (stage !== "timing" && !split.success)) {
  console.error(usage);
  process.exit(2);
}
const repository = resolve(values.posthog);
const cacheDirectory = resolve(values.cache!);
const config = await readConfig(values.config);
const digest = await configDigest(values.config);
const graderSha256 = await graderDigest(digest);

if (stage === "timing") console.log(await timeConsecutiveCommits(await createGrader(repository, config, cacheDirectory), Number(values.commits)));
else await runSplitStage(split.data!);

async function runSplitStage(split: Split): Promise<void> {
  if (split === "heldout") await refuseUnfrozen();
  const store = new GradeStore(join(cacheDirectory, "reports", graderSha256.slice(0, 12)));
  const rows = await readCorpus();
  const slimPullRequests = await readSlimPullRequests(resolve(values.work!));
  const casesOf = (of: Split) => correctionCases(repository, rows, of);
  const cleanOf = (of: Split) => cleanPullRequests(slimPullRequests, rows, of, cleanSampleSize, `100:${of}:clean`);

  const evaluated = async (of: Split): Promise<EvaluatedSplit> => {
    const [splitCases, splitClean] = [await casesOf(of), cleanOf(of)];
    const scored = await scoredCases(store, splitCases, of);
    const cleanGrades = await storedClean(store, splitClean);
    return { cases: scored.filter(({ path }) => isProductionSource(path)), outsideProduction: scored.filter(({ path }) => !isProductionSource(path)).length, clean: cleanGrades, cleanSampled: splitClean.length };
  };

  if (stage === "grade") await gradeShard(store, await casesOf(split), cleanOf(split), values.shard!);
  if (stage === "report") {
    const { cases, clean } = await evaluated(split);
    console.log(tuningReport(cases, clean, config));
  }
  if (stage === "false-alarms") console.log(await writeJudgePackets(store, cleanOf(split)));
  if (stage === "scope") console.log(`${(await scopeSample(rows, split)).length} scope-index results`);
  if (stage === "validate") await writeValidation(store, await evaluated("development"), await evaluated("heldout"), cleanOf("heldout"), await scopeSample(rows, "heldout"));
}

async function writeJudgePackets(store: GradeStore, clean: CleanPullRequest[]): Promise<string> {
  const flags = flagsToJudge(clean, await cleanGradesByPullRequest(store, clean), config.detectors);
  const names = await writeFalseAlarmPackets(repository, join(cacheDirectory, "packets", "false-alarm"), flags);
  return `${flags.length} flags from ${clean.length} clean pull requests in ${names.length} packets`;
}

async function scopeSample(rows: Awaited<ReturnType<typeof readCorpus>>, split: Split) {
  const verifications = await readVerifications(split);
  const verified = isolatedFixes(rows, split).filter((fix) => addressed(fix, verifications) === true);
  return scopeIndexResults(repository, stableOrder(verified, `100:${split}:scope`).slice(0, scopeSampleSize), join(cacheDirectory, "scope", split));
}

async function writeValidation(store: GradeStore, development: EvaluatedSplit, heldOut: EvaluatedSplit, clean: CleanPullRequest[], scope: Awaited<ReturnType<typeof scopeIndexResults>>): Promise<void> {
  const report = validationReport({
    detectors: config.detectors,
    configSha256: digest,
    graderSha256,
    heldOutSha256: await verifyHeldOutDigest(),
    development,
    heldOut,
    flags: flagsToJudge(clean, await cleanGradesByPullRequest(store, clean), config.detectors),
    labels: await readLabels(falseAlarmLabels, "heldout", falseAlarmLabelSchema),
    scope,
  });
  const document = await Bun.file(validationFile).text();
  await Bun.write(validationFile, replaceRegion(replaceRegion(document, "development", developmentTables(development, config.detectors).join("\n")), "held-out", report));
  console.log(`wrote ${validationFile}`);
}

async function cleanGradesByPullRequest(store: GradeStore, clean: CleanPullRequest[]): Promise<Map<number, StoredGrade>> {
  const entries = await Promise.all(clean.map(async ({ pr, range }) => [pr, await store.read(range)] as const));
  return new Map(entries.filter((entry): entry is readonly [number, StoredGrade] => entry[1] !== undefined));
}

function replaceRegion(document: string, name: string, content: string): string {
  const [start, end] = [`<!-- ${name}:start -->`, `<!-- ${name}:end -->`];
  const [from, to] = [document.indexOf(start), document.indexOf(end)];
  if (from === -1 || to === -1) throw new Error(`${validationFile} has no ${start} ... ${end} region`);
  return `${document.slice(0, from + start.length)}\n${content}\n${document.slice(to)}`;
}

async function gradeShard(store: GradeStore, cases: CorrectionCase[], clean: CleanPullRequest[], shard: string): Promise<void> {
  const [index, count] = shard.split("/").map(Number) as [number, number];
  const timeline = [...cases.map(({ fix, reviewed, fixed }) => ({ at: fix.mergedAt, ranges: [reviewed, fixed] })), ...clean.map(({ mergedAt, range }) => ({ at: mergedAt, ranges: [range] }))].sort((a, b) => a.at.localeCompare(b.at));
  const all = timeline.flatMap(({ ranges }) => ranges);
  const size = Math.ceil(all.length / count);
  const ranges = all.slice(index * size, (index + 1) * size);
  const grader = await createGrader(repository, config, cacheDirectory);
  const started = performance.now();
  try {
    await store.gradeAll(grader, ranges, (done, report) => {
      if (done % 20 === 0) console.error(`${done}/${ranges.length} graded, ${((performance.now() - started) / 1000 / done).toFixed(2)} s each, last ${report.seconds.toFixed(1)} s`);
    });
  } finally {
    grader.close();
  }
  const failures = await store.failures(ranges);
  console.error(`shard ${shard}: ${ranges.length} ranges graded, ${failures.length} failed${failures.map(({ head, error }) => `\n  ${head}: ${error}`).join("")}`);
}

async function scoredCases(store: GradeStore, cases: CorrectionCase[], split: Split): Promise<ScoredCase[]> {
  const verifications = await readVerifications(split);
  const scored: ScoredCase[] = [];
  for (const { fix, reviewed, fixed } of cases) {
    const [reviewedGrade, fixedGrade] = [await store.read(reviewed), await store.read(fixed)];
    if (!reviewedGrade || !fixedGrade) continue;
    scored.push({ id: fix.id, subtype: fix.subtype, path: fix.path, line: fix.line, verified: addressed(fix, verifications), reviewed: reviewedGrade, fixed: fixedGrade });
  }
  return scored;
}

async function storedClean(store: GradeStore, clean: CleanPullRequest[]): Promise<StoredGrade[]> {
  const grades = await Promise.all(clean.map(({ range }) => store.read(range)));
  return grades.filter((grade): grade is StoredGrade => grade !== undefined);
}

async function refuseUnfrozen(): Promise<void> {
  await verifyHeldOutDigest();
  const frozen = FrozenSchema.safeParse(await Bun.file(frozenFile).json().catch(() => ({})));
  if (!frozen.success || frozen.data.configSha256 !== digest || frozen.data.graderSha256 !== graderSha256) {
    console.error(`The held-out set runs only with the frozen grader: config ${digest} and grader ${graderSha256} must match frozen.json.`);
    process.exit(1);
  }
}

async function graderDigest(configSha256: string): Promise<string> {
  const hash = createHash("sha256").update(configSha256);
  const sources = await Array.fromAsync(new Glob("{*.ts,detectors/*.ts}").scan({ cwd: import.meta.dir }));
  for (const source of sources.filter((source) => !evaluationSources.has(source)).sort()) hash.update(source).update(await Bun.file(join(import.meta.dir, source)).text());
  return hash.digest("hex");
}
