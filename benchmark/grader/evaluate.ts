#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { splits, type Split } from "../corrections/comments.ts";
import { configDigest, readConfig } from "./config.ts";
import { isolatedFixes, readCorpus, stableOrder, verifyHeldOutDigest } from "./corpus.ts";
import { cleanPullRequests, correctionCases, readSlimPullRequests, type CleanPullRequest, type CorrectionCase } from "./evaluation/jobs.ts";
import type { ScoredCase } from "./evaluation/metrics.ts";
import { GradeStore, type StoredGrade } from "./evaluation/store.ts";
import { tuningReport } from "./evaluation/tuning.ts";
import { falseAlarmLabelSchema, flagsToJudge, writeFalseAlarmPackets } from "./evaluation/false-alarms.ts";
import { scopeIndexResults } from "./evaluation/scope-index.ts";
import { detectorTable, validationReport, type EvaluatedSplit } from "./evaluation/validation.ts";
import { readLabels } from "../corrections/labels.ts";
import { createGrader } from "./grade.ts";
import { addressed, readVerifications } from "./verification.ts";

const usage = `Usage: bun benchmark/grader/evaluate.ts <stage> --split development|heldout --posthog ~/dev/posthog [--shard 0/4] [--config <file>]

Stages: grade (resumable, shardable), report (tuning table, development only), false-alarms (judge packets), scope (old scope index on a sample), validate (writes docs/corrections/grader-validation.md)`;
const stages = ["grade", "report", "false-alarms", "scope", "validate"];
const scopeSampleSize = 40;
const falseAlarmLabels = join(import.meta.dir, "false-alarms");
const validationFile = join(import.meta.dir, "..", "..", "docs", "corrections", "grader-validation.md");
const cleanSampleSize = 200;
const frozenFile = join(import.meta.dir, "frozen.json");
const FrozenSchema = z.object({ configSha256: z.string(), frozenAt: z.string() });

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    split: { type: "string" },
    posthog: { type: "string" },
    shard: { type: "string", default: "0/1" },
    work: { type: "string", default: join(import.meta.dir, "..", ".cache", "corrections") },
    cache: { type: "string", default: join(import.meta.dir, "..", ".cache", "grader") },
    config: { type: "string" },
  },
});

const split = z.enum(splits).safeParse(values.split);
if (!split.success || !values.posthog || !stages.includes(positionals[0] ?? "")) {
  console.error(usage);
  process.exit(2);
}
const repository = resolve(values.posthog);
const config = await readConfig(values.config);
const digest = await configDigest(values.config);
if (split.data === "heldout") await refuseUnfrozen(digest);
const store = new GradeStore(join(resolve(values.cache!), "reports", digest.slice(0, 12)));
const rows = await readCorpus();
const cases = await correctionCases(repository, rows, split.data);
const clean = cleanPullRequests(await readSlimPullRequests(resolve(values.work!)), rows, split.data, cleanSampleSize, `100:${split.data}:clean`);

const cacheDirectory = resolve(values.cache!);
const stage = positionals[0];
if (stage === "grade") await gradeShard(cases, clean, values.shard!);
if (stage === "report") console.log(tuningReport(await scoredCases(cases, split.data), await storedClean(clean), config));
if (stage === "false-alarms") console.log(await writeJudgePackets(clean));
if (stage === "scope") console.log(`${(await scopeSample(split.data)).length} scope-index results`);
if (stage === "validate") await writeValidation();

async function writeJudgePackets(clean: CleanPullRequest[]): Promise<string> {
  const flags = flagsToJudge(clean, await cleanGradesByPullRequest(clean), config.detectors);
  const names = await writeFalseAlarmPackets(repository, join(cacheDirectory, "packets", "false-alarm"), flags);
  return `${flags.length} flags from ${clean.length} clean pull requests in ${names.length} packets`;
}

async function scopeSample(split: Split) {
  const verifications = await readVerifications(split);
  const verified = isolatedFixes(rows, split).filter((fix) => addressed(fix, verifications) === true);
  return scopeIndexResults(repository, stableOrder(verified, `100:${split}:scope`).slice(0, scopeSampleSize), join(cacheDirectory, "scope", split));
}

async function writeValidation(): Promise<void> {
  const development: EvaluatedSplit = await evaluatedSplit("development");
  const heldOut: EvaluatedSplit = { cases: await scoredCases(cases, "heldout"), clean: await storedClean(clean) };
  const flags = flagsToJudge(clean, await cleanGradesByPullRequest(clean), config.detectors);
  const report = validationReport({
    detectors: config.detectors,
    configSha256: digest,
    heldOutSha256: await verifyHeldOutDigest(),
    development,
    heldOut,
    flags,
    labels: await readLabels(falseAlarmLabels, "heldout", falseAlarmLabelSchema),
    scope: await scopeSample("heldout"),
  });
  const developmentTable = detectorTable({ cases: development.cases.filter(({ verified }) => verified === true), clean: development.clean }, config.detectors).join("\n");
  const document = await Bun.file(validationFile).text();
  await Bun.write(validationFile, replaceRegion(replaceRegion(document, "development", developmentTable), "held-out", report));
  console.log(`wrote ${validationFile}`);
}

async function evaluatedSplit(split: Split): Promise<EvaluatedSplit> {
  const splitCases = await correctionCases(repository, rows, split);
  const splitClean = cleanPullRequests(await readSlimPullRequests(resolve(values.work!)), rows, split, cleanSampleSize, `100:${split}:clean`);
  return { cases: await scoredCases(splitCases, split), clean: await storedClean(splitClean) };
}

async function cleanGradesByPullRequest(clean: CleanPullRequest[]): Promise<Map<number, StoredGrade>> {
  const entries = await Promise.all(clean.map(async ({ pr, range }) => [pr, await store.read(range)] as const));
  return new Map(entries.filter((entry): entry is readonly [number, StoredGrade] => entry[1] !== undefined));
}

function replaceRegion(document: string, name: string, content: string): string {
  const [start, end] = [`<!-- ${name}:start -->`, `<!-- ${name}:end -->`];
  const [from, to] = [document.indexOf(start), document.indexOf(end)];
  if (from === -1 || to === -1) throw new Error(`${validationFile} has no ${start} ... ${end} region`);
  return `${document.slice(0, from + start.length)}\n${content}\n${document.slice(to)}`;
}

async function gradeShard(cases: CorrectionCase[], clean: CleanPullRequest[], shard: string): Promise<void> {
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
  console.error(`shard ${shard}: ${ranges.length} ranges graded`);
}

async function scoredCases(cases: CorrectionCase[], split: Split): Promise<ScoredCase[]> {
  const verifications = await readVerifications(split);
  const scored: ScoredCase[] = [];
  for (const { fix, reviewed, fixed } of cases) {
    const [reviewedGrade, fixedGrade] = [await store.read(reviewed), await store.read(fixed)];
    if (!reviewedGrade || !fixedGrade) continue;
    scored.push({ id: fix.id, subtype: fix.subtype, path: fix.path, line: fix.line, verified: addressed(fix, verifications), reviewed: reviewedGrade, fixed: fixedGrade });
  }
  return scored;
}

async function storedClean(clean: CleanPullRequest[]): Promise<StoredGrade[]> {
  const grades = await Promise.all(clean.map(({ range }) => store.read(range)));
  return grades.filter((grade): grade is StoredGrade => grade !== undefined);
}

async function refuseUnfrozen(digest: string): Promise<void> {
  await verifyHeldOutDigest();
  const frozen = FrozenSchema.parse(await Bun.file(frozenFile).json().catch(() => ({ configSha256: "", frozenAt: "" })));
  if (frozen.configSha256 !== digest) {
    console.error(`The held-out set runs only with the frozen config: config.json hashes to ${digest}, frozen.json records ${frozen.configSha256 || "nothing"}.`);
    process.exit(1);
  }
}
