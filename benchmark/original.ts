import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunMeta } from "./lib/meta.ts";
import { pullRequestDiff } from "./lib/pr-diff.ts";
import { snapshotTask, taskRunsDir, writeJson } from "./lib/runs.ts";
import { posthogRepository } from "./lib/scratch-worktree.ts";
import { sessionTrace } from "./lib/session.ts";
import { loadTask, sessionId, sessionModel, type Task } from "./lib/task.ts";
import type { TraceEvent } from "./lib/trace.ts";

const taskPath = Bun.argv[2];
if (!taskPath) {
  console.error("Usage: bun benchmark/original.ts <task.json>\n  Writes arm A: the PR's own changes, diffed from the upstream commit its branch last synced with, and the authoring session's trace.");
  process.exit(1);
}

const task = await loadTask(taskPath);
const taskDir = taskRunsDir(String(task.pr));
const armDir = join(taskDir, "A");
await snapshotTask(taskDir, task);
await mkdir(armDir, { recursive: true });

const diff = await pullRequestDiff(posthogRepository, task.baseCommit, task.finalHead);
await Bun.write(join(armDir, "diff.patch"), diff.patch);

const trace = await sessionTrace(task.session);
if (trace) await Bun.write(join(armDir, "trace.jsonl"), `${trace.map((event) => JSON.stringify(event)).join("\n")}\n`);
else console.warn(`No ${task.session.source} session transcript found; arm A has no process metrics.`);

await writeJson(join(armDir, "meta.json"), metaOf(task, diff.from, trace));
console.log(`A: diff from ${diff.from.slice(0, 11)} to ${task.finalHead.slice(0, 11)}, ${trace ? `${trace.length} session events` : "no session trace"}`);

function metaOf(task: Task, diffFrom: string, trace: TraceEvent[] | undefined): RunMeta {
  const times = (trace ?? []).flatMap((event) => (event.at === undefined ? [] : [event.at]));
  const first = times.length > 0 ? Math.min(...times) : undefined;
  const last = times.length > 0 ? Math.max(...times) : undefined;
  return {
    pr: task.pr,
    arm: "A",
    model: sessionModel(task.session) ?? null,
    sessionId: sessionId(task.session) ?? null,
    sessionSource: task.session.source,
    turns: trace ? trace.filter((event) => event.kind === "prompt").length : null,
    costUsd: null,
    wallSeconds: first !== undefined && last !== undefined ? Math.round((last - first) / 1000) : null,
    startedAt: first !== undefined ? new Date(first).toISOString() : null,
    exit: { reason: "historical", code: null },
    baseCommit: task.baseCommit,
    diffFrom,
  };
}
