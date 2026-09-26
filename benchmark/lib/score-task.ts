import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createRepositoryIndexer, type RepositoryIndexer } from "../../src/architecture/index/index.ts";
import { focusScores, hygieneScore } from "./metric-scores.ts";
import { measureArm, type ArmMeasure } from "./measure.ts";
import type { RunMeta } from "./meta.ts";
import { consistency, overlap, type Overlap } from "./overlap.ts";
import { processMetrics, type ProcessMetrics } from "./process-metrics.ts";
import { armRuns, loadRunTask, readJson, writeJson, type ArmRun } from "./runs.ts";
import { claudeTrace, parseJsonLines, type TraceEvent } from "./trace.ts";

export type ArmScore = ArmMeasure & {
  arm: string;
  exit: RunMeta["exit"] | null;
  hygiene: number | null;
  focusScore: number | null;
  alignment: Overlap | null;
  process: (ProcessMetrics & Pick<RunMeta, "turns" | "wallSeconds" | "costUsd">) | null;
};

export type TaskScores = { pr: number | string; baseCommit: string; scoredAt: string; arms: Record<string, ArmScore>; consistency: Record<string, Overlap | null> };

const originalArm = "A";

export type ScoreOptions = { repository: string; indexer?: RepositoryIndexer };

export async function scoreTaskRuns(taskDir: string, { repository, indexer = createRepositoryIndexer() }: ScoreOptions): Promise<TaskScores> {
  const task = await loadRunTask(taskDir);
  const measured: [ArmRun, ArmMeasure, RunMeta | undefined][] = [];
  for (const run of await armRuns(taskDir)) {
    const patch = await Bun.file(join(run.dir, "diff.patch")).text();
    const scratch = join(tmpdir(), `bench-score-${basename(taskDir)}-${run.name}-${crypto.randomUUID().slice(0, 8)}`);
    const meta = await readJson<RunMeta>(join(run.dir, "meta.json"));
    measured.push([run, await measureArm({ repository, base: meta?.diffFrom ?? task.baseCommit, patch, scratch, indexer }), meta]);
  }
  const focuses = focusScores(Object.fromEntries(measured.flatMap(([run, measure]) => (measure.focus ? [[run.name, measure.focus]] : []))));
  const original = measured.find(([run]) => run.arm === originalArm)?.[1];
  const arms: Record<string, ArmScore> = {};
  for (const [run, measure, meta] of measured) {
    arms[run.name] = {
      arm: run.arm,
      exit: meta?.exit ?? null,
      ...measure,
      hygiene: measure.boundary ? hygieneScore(measure.boundary) : null,
      focusScore: focuses[run.name] ?? null,
      alignment: original && run.arm !== originalArm ? overlap(measure.files, original.files) : null,
      process: await processOf(run, meta),
    };
  }
  const scores: TaskScores = { pr: task.pr, baseCommit: task.baseCommit, scoredAt: new Date().toISOString(), arms, consistency: consistencyByArm(measured) };
  await writeJson(join(taskDir, "scores.json"), scores);
  return scores;
}

function consistencyByArm(measured: [ArmRun, ArmMeasure, RunMeta | undefined][]): Record<string, Overlap | null> {
  const arms = [...new Set(measured.map(([run]) => run.arm))].filter((arm) => arm !== originalArm);
  return Object.fromEntries(arms.map((arm) => [arm, consistency(measured.filter(([run]) => run.arm === arm).map(([, measure]) => measure.files))]));
}

export async function traceOf(run: ArmRun): Promise<TraceEvent[] | undefined> {
  const normalized = Bun.file(join(run.dir, "trace.jsonl"));
  if (await normalized.exists()) return parseJsonLines(await normalized.text()) as TraceEvent[];
  const transcript = Bun.file(join(run.dir, "transcript.jsonl"));
  if (await transcript.exists()) return claudeTrace(parseJsonLines(await transcript.text()));
  return undefined;
}

async function processOf(run: ArmRun, meta: RunMeta | undefined): Promise<ArmScore["process"]> {
  const trace = await traceOf(run);
  if (!trace) return null;
  const startedAt = meta?.startedAt ? Date.parse(meta.startedAt) : undefined;
  return { ...processMetrics(trace, startedAt), turns: meta?.turns ?? null, wallSeconds: meta?.wallSeconds ?? null, costUsd: meta?.costUsd ?? null };
}
