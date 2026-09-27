#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { splits, type Split } from "../corrections/comments.ts";
import { configDigest, readConfig } from "./config.ts";
import { readCorpus, verifyHeldOutDigest } from "./corpus.ts";
import { cleanPullRequests, correctionCases, readSlimPullRequests, type CleanPullRequest, type CorrectionCase } from "./evaluation/jobs.ts";
import type { ScoredCase } from "./evaluation/metrics.ts";
import { GradeStore, type StoredGrade } from "./evaluation/store.ts";
import { tuningReport } from "./evaluation/tuning.ts";
import { createGrader } from "./grade.ts";
import { addressed, readVerifications } from "./verification.ts";

const usage = `Usage: bun benchmark/grader/evaluate.ts <grade|report> --split development|heldout --posthog ~/dev/posthog [--shard 0/4] [--clean 200]`;
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
  },
});

const split = z.enum(splits).safeParse(values.split);
if (!split.success || !values.posthog || !["grade", "report"].includes(positionals[0] ?? "")) {
  console.error(usage);
  process.exit(2);
}
const repository = resolve(values.posthog);
const config = await readConfig();
const digest = await configDigest();
if (split.data === "heldout") await refuseUnfrozen(digest);
const store = new GradeStore(join(resolve(values.cache!), "reports", digest.slice(0, 12)));
const rows = await readCorpus();
const cases = await correctionCases(repository, rows, split.data);
const clean = cleanPullRequests(await readSlimPullRequests(resolve(values.work!)), rows, split.data, cleanSampleSize, `100:${split.data}:clean`);

if (positionals[0] === "grade") await gradeShard(cases, clean, values.shard!);
else console.log(tuningReport(await scoredCases(cases, split.data), await storedClean(clean), config));

async function gradeShard(cases: CorrectionCase[], clean: CleanPullRequest[], shard: string): Promise<void> {
  const [index, count] = shard.split("/").map(Number) as [number, number];
  const timeline = [...cases.map(({ fix, reviewed, fixed }) => ({ at: fix.mergedAt, ranges: [reviewed, fixed] })), ...clean.map(({ mergedAt, range }) => ({ at: mergedAt, ranges: [range] }))].sort((a, b) => a.at.localeCompare(b.at));
  const all = timeline.flatMap(({ ranges }) => ranges);
  const size = Math.ceil(all.length / count);
  const ranges = all.slice(index * size, (index + 1) * size);
  const grader = await createGrader(repository, config, resolve(values.cache!));
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
