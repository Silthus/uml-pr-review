import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { defaultEnvironment, setUp, tearDown, witness } from "./kit/kit.ts";
import { declareCase, invariantName, loadCase, readSession, renderReport, type Arm, type ReplayCase, type RunRecord } from "./replay.ts";

const USAGE = "usage: bun benchmark/replay/run.ts <pr> --arm hooks|control --runs <n> [--first <k>]\n       bun benchmark/replay/run.ts report";
const KIT_PREFIX = "/tmp/replay-118";
const EVIDENCE = resolve(import.meta.dir, "../../docs/replay");
const POSTHOG = join(homedir(), "posthog");
const SESSION_TIMEOUT_MS = 20 * 60 * 1000;
const TRIM_AT = 4000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { arm: { type: "string" }, runs: { type: "string", default: "1" }, first: { type: "string", default: "1" } },
});

function isArm(value: string | undefined): value is Arm {
  return value === "hooks" || value === "control";
}

function sh(argv: string[], cwd: string, env: Record<string, string | undefined> = process.env) {
  const result = Bun.spawnSync(argv, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function coherence(dir: string, args: string[]) {
  return sh(["node", "--disable-warning=ExperimentalWarning", join(dir, "coherence/src/cli.ts"), ...args], join(dir, "posthog"));
}

interface PostHogState {
  settings: string;
  status: string;
  refs: string;
}

function posthogState(ref: string): PostHogState {
  return {
    settings: new Bun.CryptoHasher("sha256").update(readFileSync(join(POSTHOG, ".claude/settings.json"))).digest("hex"),
    status: sh(["git", "status", "--porcelain"], POSTHOG).stdout,
    refs: sh(["git", "for-each-ref", `refs/uml-pr-review/${ref}`], POSTHOG).stdout,
  };
}

function kitWorktreesLeft(dir: string): string[] {
  return sh(["git", "worktree", "list", "--porcelain"], POSTHOG)
    .stdout.split("\n")
    .filter((line) => line === `worktree ${dir}/posthog`);
}

function assertIntact(before: PostHogState, ref: string, dir: string) {
  const after = posthogState(ref);
  const drift = (Object.keys(before) as (keyof PostHogState)[]).filter((key) => before[key] !== after[key]);
  const left = kitWorktreesLeft(dir);
  if (drift.length > 0 || left.length > 0) throw new Error(`~/posthog changed after ${dir}: ${[...drift, ...left].join(", ")}`);
}

function stopCoherenceServers(dir: string) {
  sh(["pkill", "-f", `${dir}/coherence/`], "/");
}

function trimmed(value: unknown): unknown {
  if (typeof value === "string") return value.length > TRIM_AT ? `${value.slice(0, TRIM_AT)}…[trimmed ${value.length - TRIM_AT} chars]` : value;
  if (Array.isArray(value)) return value.map(trimmed);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, trimmed(inner)]));
  return value;
}

function publicRecord(record: Record<string, unknown>): Record<string, unknown> {
  if (record["type"] !== "system" || record["subtype"] !== "init") return record;
  const { type, subtype, model, permissionMode, claude_code_version } = record;
  return { type, subtype, model, permissionMode, claude_code_version };
}

async function runSession(dir: string, task: string): Promise<{ lines: string[]; exitCode: number }> {
  const env: Record<string, string | undefined> = { ...process.env, COHERENCE_HOME: join(dir, "coherence") };
  for (const key of ["CLAUDE_CODE_REMOTE", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]) delete env[key];
  const argv = ["claude", "-p", task, "--model", "claude-opus-5-5", "--permission-mode", "acceptEdits", "--setting-sources", "project"];
  const started = performance.now();
  const child = Bun.spawn([...argv, "--output-format", "stream-json", "--verbose", "--include-hook-events", "--max-turns", "30"], { cwd: join(dir, "posthog"), env, stdout: "pipe", stderr: "inherit" });
  const timer = setTimeout(() => child.kill(), SESSION_TIMEOUT_MS);
  const lines: string[] = [];
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    const received = Math.round(performance.now() - started);
    const parts = `${pending}${decoder.decode(read.value, { stream: true })}`.split("\n");
    pending = parts.pop() ?? "";
    for (const line of parts.filter((part) => part.trim() !== "")) lines.push(JSON.stringify({ ...publicRecord(JSON.parse(line)), received_ms: received }));
  }
  clearTimeout(timer);
  return { lines, exitCode: await child.exited };
}

function finalDiff(worktree: string, file: string): string {
  const tracked = sh(["git", "ls-files", "--error-unmatch", file], worktree).code === 0;
  if (tracked) return sh(["git", "diff", "HEAD", "--", file], worktree).stdout;
  if (!existsSync(join(worktree, file))) return `${file} does not exist\n`;
  return sh(["git", "diff", "--no-index", "--", "/dev/null", file], worktree).stdout;
}

function lintFinal(worktree: string, replay: ReplayCase): string {
  const config = JSON.parse(readFileSync(join(worktree, "coherence.config.json"), "utf8")) as { lint: Record<string, { command: string[] }> };
  const command = Object.values(config.lint)[0]?.command ?? [];
  const argv = [...command.filter((arg) => arg !== "nodejs"), replay.file];
  const result = sh(argv, worktree);
  return `$ ${argv.join(" ")}\n${result.stdout}${result.stderr}[exit ${result.code}]\n`;
}

function runVerdict(stdout: string, name: string): string {
  try {
    const record = JSON.parse(stdout.slice(stdout.indexOf("{"))) as { invariants: { name: string; verdict: string }[] };
    return record.invariants.find((entry) => entry.name === name)?.verdict ?? "missing";
  } catch {
    return "unreadable";
  }
}

async function replayOnce(replay: ReplayCase, arm: Arm, n: number, baseline: PostHogState): Promise<RunRecord> {
  const dir = `${KIT_PREFIX}-${replay.pr}-${arm}-${n}`;
  const evidence = join(EVIDENCE, String(replay.pr), `${arm}-${n}`);
  mkdirSync(evidence, { recursive: true });
  const kitLog: string[] = [];
  await setUp({ dir, ref: replay.ref, language: replay.language, hooks: arm === "hooks" }, defaultEnvironment(), (line) => kitLog.push(line));
  try {
    const worktree = join(dir, "posthog");
    declareCase(replay, worktree);
    const witnessed = await witness(dir, replay.invariant, (line) => kitLog.push(line));
    writeFileSync(join(evidence, "witness.txt"), `${kitLog.join("\n")}\n`);
    if (!witnessed) throw new Error(`the witness did not go red then green for ${replay.invariant}; see ${evidence}/witness.txt`);
    const session = await runSession(dir, readFileSync(join(replay.dir, "task.md"), "utf8"));
    writeFileSync(join(evidence, "transcript.jsonl"), `${session.lines.map((line) => JSON.stringify(trimmed(JSON.parse(line)))).join("\n")}\n`);
    writeFileSync(join(evidence, "hooks.jsonl"), `${session.lines.filter((line) => line.includes('"subtype":"hook_')).join("\n")}\n`);
    const name = invariantName(replay);
    const run = coherence(dir, ["run", "--invariant", name, "--json", "--no-server", "--session", "replay-final", "--agent", "replay"]);
    const status = coherence(dir, ["run", "--status"]);
    writeFileSync(join(evidence, "run-status.txt"), `$ coherence run --status\n${status.stdout}${status.stderr}`);
    writeFileSync(join(evidence, "lint.txt"), lintFinal(worktree, replay));
    writeFileSync(join(evidence, "final.diff"), finalDiff(worktree, replay.file));
    writeFileSync(join(evidence, "changed-files.txt"), sh(["git", "status", "--porcelain", "--untracked-files=all"], worktree).stdout);
    const content = existsSync(join(worktree, replay.file)) ? readFileSync(join(worktree, replay.file), "utf8") : "";
    const record: RunRecord = {
      pr: replay.pr,
      arm,
      n,
      exitCode: session.exitCode,
      session: readSession(session.lines.join("\n"), replay),
      final: { bypass: content.includes(replay.bypass), reviewerRoute: content.includes(replay.reviewerRoute), verdict: runVerdict(run.stdout, name) },
    };
    writeFileSync(join(evidence, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally {
    stopCoherenceServers(dir);
    await tearDown(dir, () => undefined);
    assertIntact(baseline, replay.ref, dir);
  }
}

function rescored(folder: string): RunRecord {
  const recorded = JSON.parse(readFileSync(join(folder, "run.json"), "utf8")) as RunRecord;
  const session = readSession(readFileSync(join(folder, "transcript.jsonl"), "utf8"), loadCase(String(recorded.pr)));
  if (session.introduced !== recorded.session.introduced || session.flagged !== recorded.session.flagged) throw new Error(`${folder}: the trimmed transcript no longer reads as the session run.json recorded`);
  return { ...recorded, session };
}

function recordedRuns(): RunRecord[] {
  return readdirSync(EVIDENCE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .flatMap((pr) => readdirSync(join(EVIDENCE, pr.name)).map((run) => join(EVIDENCE, pr.name, run)))
    .filter((folder) => existsSync(join(folder, "run.json")))
    .map(rescored);
}

async function main() {
  const [command] = positionals;
  if (command === "report") {
    writeFileSync(join(EVIDENCE, "report.md"), renderReport(recordedRuns(), ["64506", "68756"].map(loadCase)));
    return;
  }
  if (command === undefined || !isArm(values.arm)) {
    console.error(USAGE);
    process.exit(64);
  }
  const replay = loadCase(command);
  const baseline = posthogState(replay.ref);
  const first = Number(values.first);
  for (let n = first; n < first + Number(values.runs); n++) {
    const record = await replayOnce(replay, values.arm, n, baseline);
    console.log(JSON.stringify(record));
  }
}

await main();
