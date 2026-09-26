import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedClient, gradeDiff, type JevAnswer, type JevGrade, type JevReport } from "./lib/jev.ts";
import { gatewayJev, jevModel } from "./lib/jev-gateway.ts";
import type { RunMeta } from "./lib/meta.ts";
import { parsePatch } from "./lib/patch.ts";
import { armRuns, benchmarkDir, loadRunTask, readJson, taskRunsDir, writeJson } from "./lib/runs.ts";
import { posthogRepository, withPatchedWorktree } from "./lib/scratch-worktree.ts";

const cachePath = join(benchmarkDir, ".cache", "jev.json");

const key = Bun.argv[2];
if (!key) {
  console.error("Usage: AI_GATEWAY_API_KEY=… bun benchmark/jev-grade.ts <pr>\n  Grades every arm diff of the task with Jev (typesafe-ai/jev) and writes runs/<pr>/jev.json.");
  process.exit(1);
}

const taskDir = taskRunsDir(key);
const report = await grade().catch((error: unknown): JevReport => ({ status: "unavailable", reason: error instanceof Error ? error.message : String(error) }));
await writeJson(join(taskDir, "jev.json"), report);
console.log(report.status === "graded" ? `Jev graded ${Object.keys(report.runs).length} diffs of ${key}.` : `jev: unavailable (${report.reason})`);

async function grade(): Promise<JevReport> {
  if (!process.env.AI_GATEWAY_API_KEY) return { status: "unavailable", reason: "AI_GATEWAY_API_KEY is not set" };
  const task = await loadRunTask(taskDir);
  const cache = new Map(Object.entries((await readJson<Record<string, Record<string, JevAnswer>>>(cachePath)) ?? {}));
  const client = cachedClient(gatewayJev(), cache);
  const runs: Record<string, JevGrade> = {};
  try {
    for (const run of await armRuns(taskDir)) {
      const patch = await Bun.file(join(run.dir, "diff.patch")).text();
      const files = parsePatch(patch);
      if (files.length === 0) continue;
      const base = (await readJson<RunMeta>(join(run.dir, "meta.json")))?.diffFrom ?? task.baseCommit;
      const scratch = join(tmpdir(), `bench-jev-${key}-${run.name}-${crypto.randomUUID().slice(0, 8)}`);
      runs[run.name] = await withPatchedWorktree(posthogRepository, scratch, base, patch, async (worktree, applied) => {
        if (applied.application === "failed") throw new Error(`${run.name}'s diff does not apply: ${applied.applyError}`);
        return gradeDiff(client, task.taskStatement, patch, files, (path) => Bun.file(join(worktree, path)).text());
      });
    }
  } finally {
    await writeJson(cachePath, Object.fromEntries(cache));
  }
  return { status: "graded", model: jevModel, gradedAt: new Date().toISOString(), runs };
}
