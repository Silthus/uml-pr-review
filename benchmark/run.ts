import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runAgent, type AgentOutcome } from "./lib/agent-run.ts";
import { architectureServer, invocationFor, type ReplayArm } from "./lib/invocation.ts";
import type { RunMeta } from "./lib/meta.ts";
import { planFiles, plansDirectory, removeRunPlans } from "./lib/run-plans.ts";
import { benchmarkDir, nextRunIndex, snapshotTask, taskRunsDir, writeJson } from "./lib/runs.ts";
import { addScratchWorktree, posthogRepository, removeScratchWorktree, workingTreeDiff } from "./lib/scratch-worktree.ts";
import { loadTask, type Task } from "./lib/task.ts";

const wallTimeCapMs = 40 * 60_000;
const skillPath = join(benchmarkDir, "..", "skills", "planning-architecture", "SKILL.md");

const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), options: { repeat: { type: "string", default: "1" } }, allowPositionals: true });
const [taskPath, arm] = positionals;
const repeat = Number(values.repeat);
if (!taskPath || (arm !== "B" && arm !== "C") || !Number.isInteger(repeat) || repeat < 1) {
  console.error("Usage: bun benchmark/run.ts <task.json> <B|C> [--repeat n]\n  Replays the task on Claude Opus 5.5 in a scratch PostHog worktree; arm C adds the uml-pr-review MCP server and the planning-architecture skill.");
  process.exit(1);
}

const task = await loadTask(taskPath);
const taskDir = taskRunsDir(String(task.pr));
await snapshotTask(taskDir, task);
if (arm === "C") await assertArchitectureServer();
const interruption = new AbortController();
process.on("SIGINT", () => interruption.abort());
process.on("SIGTERM", () => interruption.abort());
let failures = 0;
for (let run = 0; run < repeat && !interruption.signal.aborted; run++) {
  const meta = await replay(task, arm, await nextRunIndex(taskDir, arm));
  console.log(`${meta.arm}: ${meta.exit.reason}${meta.exit.detail ? ` (${meta.exit.detail})` : ""}, ${meta.turns ?? "?"} turns, ${meta.wallSeconds} s, $${meta.costUsd ?? "?"}`);
  if (meta.exit.reason !== "completed") failures++;
}
process.exit(failures > 0 ? 1 : 0);

async function replay(task: Task, arm: ReplayArm, index: number): Promise<RunMeta> {
  const runDir = join(taskDir, `${arm}-${index}`);
  const worktree = `/tmp/bench-${task.pr}-${arm}-${index}`;
  const plans = await plansDirectory(posthogRepository);
  const plansBefore = await planFiles(plans);
  await mkdir(runDir, { recursive: true });
  const startedAt = new Date();
  const outcome = await agentInWorktree(task, arm, runDir, worktree).catch((error: unknown) => failedOutcome(error));
  const transcript = Bun.file(join(runDir, "transcript.jsonl"));
  const planIds = await removeRunPlans(plans, plansBefore, (await transcript.exists()) ? await transcript.text() : "");
  const meta = metaOf(task, `${arm}-${index}`, outcome, startedAt, planIds);
  await writeJson(join(runDir, "meta.json"), meta);
  return meta;
}

async function agentInWorktree(task: Task, arm: ReplayArm, runDir: string, worktree: string): Promise<AgentOutcome> {
  await addScratchWorktree(posthogRepository, worktree, task.baseCommit);
  try {
    const outcome = await runAgent({
      invocation: invocationFor(task, arm, await Bun.file(skillPath).text(), process.env),
      arm,
      cwd: worktree,
      transcriptPath: join(runDir, "transcript.jsonl"),
      stderrPath: join(runDir, "stderr.log"),
      timeoutMs: wallTimeCapMs,
      interruption: interruption.signal,
    });
    await Bun.write(join(runDir, "diff.patch"), await workingTreeDiff(worktree, task.baseCommit));
    return outcome;
  } finally {
    await removeScratchWorktree(posthogRepository, worktree);
  }
}

function failedOutcome(error: unknown): AgentOutcome {
  return { reason: "failed", code: null, detail: error instanceof Error ? error.message : String(error), model: null, sessionId: null, result: null };
}

function metaOf(task: Task, arm: string, outcome: AgentOutcome, startedAt: Date, planIds: string[]): RunMeta {
  return {
    pr: task.pr,
    arm,
    model: outcome.model,
    sessionId: outcome.sessionId,
    turns: outcome.result?.num_turns ?? null,
    costUsd: outcome.result?.total_cost_usd ?? null,
    wallSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
    startedAt: startedAt.toISOString(),
    exit: { reason: outcome.reason, code: outcome.code, ...(outcome.detail ? { detail: outcome.detail } : {}) },
    baseCommit: task.baseCommit,
    planIds,
  };
}

async function assertArchitectureServer() {
  const reachable = await fetch(architectureServer.url, { method: "GET", signal: AbortSignal.timeout(5_000) }).then(
    () => true,
    () => false,
  );
  if (!reachable) {
    console.error(`Arm C needs the uml-pr-review MCP server at ${architectureServer.url}. Start it first (bun run start).`);
    process.exit(1);
  }
}
