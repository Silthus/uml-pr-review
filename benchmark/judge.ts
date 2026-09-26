import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../src/git.ts";
import { execute } from "./lib/execute.ts";
import { judgePrompt, shuffledKey, unshuffledVerdicts, verdictSchema, type JudgeKey } from "./lib/judge.ts";
import { armRuns, loadRunTask, taskRunsDir, writeJson } from "./lib/runs.ts";
import { posthogRepository } from "./lib/scratch-worktree.ts";

const judgeModel = "gpt-6-astra";

const key = Bun.argv[2];
if (!key) {
  console.error("Usage: bun benchmark/judge.ts <pr>\n  Asks a blind codex judge to score every arm diff of the task under shuffled labels; writes runs/<pr>/judge.json and the label key.");
  process.exit(1);
}

const taskDir = taskRunsDir(key);
const task = await loadRunTask(taskDir);
const runs = await armRuns(taskDir);
const judgeKey = shuffledKey(
  runs.map(({ name }) => name),
  crypto.getRandomValues(new Uint32Array(1))[0]!,
);
await writeJson(join(taskDir, "judge-key.json"), judgeKey);

const prompt = judgePrompt({
  taskStatement: task.taskStatement,
  architecture: await git(posthogRepository, ["show", `${task.baseCommit}:products/architecture.md`]),
  diffs: await Promise.all(Object.entries(judgeKey.labels).map(async ([label, name]) => ({ label, patch: await Bun.file(join(taskDir, name, "diff.patch")).text() }))),
});
await Bun.write(join(taskDir, "judge-prompt.md"), prompt);

const output = await askJudge(prompt, judgeKey);
await writeJson(join(taskDir, "judge.json"), { model: judgeModel, judgedAt: new Date().toISOString(), verdicts: unshuffledVerdicts(output, judgeKey) });
console.log(`Judged ${runs.length} diffs of ${key} with ${judgeModel}.`);

async function askJudge(prompt: string, judgeKey: JudgeKey): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), "bench-judge-"));
  try {
    const schemaPath = join(scratch, "schema.json");
    const answerPath = join(scratch, "answer.json");
    await Bun.write(schemaPath, JSON.stringify(verdictSchema(Object.keys(judgeKey.labels))));
    const command = ["codex", "exec", "-m", judgeModel, "-s", "read-only", "--skip-git-repo-check", "--ephemeral", "-C", scratch, "--output-schema", schemaPath, "-o", answerPath, "-"];
    const result = await execute(scratch, command, prompt);
    if (result.code !== 0) throw new Error(`codex exec failed (${result.code}): ${result.stderr.trim().split("\n").slice(-5).join("\n")}`);
    return await Bun.file(answerPath).text();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
