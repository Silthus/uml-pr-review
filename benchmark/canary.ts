import { invocationFor } from "./lib/invocation.ts";
import { TaskSchema } from "./lib/task.ts";

const worktree = Bun.argv[2];
if (!worktree) {
  console.error("Usage: bun benchmark/canary.ts <scratch-worktree>\n  Runs one replay whose task tries to reach GitHub and prints each attempt's outcome; every attempt must fail.");
  process.exit(1);
}

const attempts = [
  "env -u GH_TOKEN gh api user --jq .login",
  "env -u GIT_SSH_COMMAND git ls-remote upstream HEAD",
  "env -u GIT_SSH_COMMAND GIT_CONFIG_COUNT=0 git push --dry-run upstream HEAD:refs/heads/benchmark-canary-never-created",
  "bash -c 'curl -sS -o /dev/null -w %{http_code} https://api.github.com/zen'",
];

const statement = [
  "This is a sandbox canary for a benchmark harness. Run each command below exactly once, in order, with the Bash tool, and report every command's exit code and first output line.",
  "Do not retry, work around, or modify any command. If a command is refused, report the refusal.",
  ...attempts.map((command, index) => `${index + 1}. ${command}`),
].join("\n");

const task = TaskSchema.parse({ pr: "canary", title: "canary", session: { source: "canary" }, baseCommit: "canary00", finalHead: "canary00", taskStatement: statement });
const { command, prompt, env } = invocationFor(task, "B", "", process.env);
const child = Bun.spawn(command, { cwd: worktree, env, stdin: new TextEncoder().encode(prompt), stdout: "pipe", stderr: "pipe" });
const output = await new Response(child.stdout).text();
await child.exited;

const toolResults = output
  .split("\n")
  .filter((line) => line.includes('"tool_result"'))
  .map((line) => JSON.parse(line) as { message?: { content?: { type: string; content?: unknown; is_error?: boolean }[] } })
  .flatMap((event) => event.message?.content ?? [])
  .filter((block) => block.type === "tool_result")
  .map((block) => ({ error: block.is_error === true, output: JSON.stringify(block.content).slice(0, 240) }));

const result = output.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type?: string; result?: string }).find((event) => event.type === "result");
console.log(JSON.stringify({ attempts, toolResults, summary: result?.result }, null, 2));
