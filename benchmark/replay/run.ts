import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { defaultEnvironment, setUp, tearDown, witness } from "./kit/kit.ts";
import { declareCase, EVIDENCE_FILES, invariantName, isVariant, loadCase, readSession, renderReport, VARIANTS, type Arm, type ReplayCase, type RunRecord, type Variant } from "./replay.ts";
import { auditTranscript, keepOnlyEditHook, renderV2, type CommandAudit } from "./v2.ts";

const USAGE = "usage: bun benchmark/replay/run.ts <pr> --arm hooks|control --runs <n> [--first <k>] [--variant draft|intent]\n       bun benchmark/replay/run.ts report";
const EVIDENCE = resolve(import.meta.dir, "../../docs/replay");
const POSTHOG = join(homedir(), "posthog");
const SESSION_TIMEOUT_MS = 20 * 60 * 1000;
const TRIM_AT = 4000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { arm: { type: "string" }, runs: { type: "string", default: "1" }, first: { type: "string", default: "1" }, variant: { type: "string" } },
});

function isArm(value: string | undefined): value is Arm {
  return value === "hooks" || value === "control";
}

interface Protocol {
  variant?: Variant;
  kit: string;
  evidence: string;
  task: string;
  maxTurns: number;
}

function protocolFor(replay: ReplayCase, arm: Arm, n: number, variant: Variant | undefined): Protocol {
  if (variant === undefined) return { kit: `/tmp/replay-118-${replay.pr}-${arm}-${n}`, evidence: join(EVIDENCE, String(replay.pr), `${arm}-${n}`), task: "task.md", maxTurns: 30 };
  return { variant, kit: `/tmp/replay-124-${replay.pr}-${variant}-${arm}-${n}`, evidence: join(EVIDENCE, "v2", String(replay.pr), variant, `${arm}-${n}`), task: `${variant}.md`, maxTurns: 50 };
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

const PRIVATE_KEYS = new Set(["signature"]);

function trimmed(value: unknown): unknown {
  if (typeof value === "string") return value.length > TRIM_AT ? `${value.slice(0, TRIM_AT)}…[trimmed ${value.length - TRIM_AT} chars]` : value;
  if (Array.isArray(value)) return value.map(trimmed);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_KEYS.has(key)).map(([key, inner]) => [key, trimmed(inner)]));
  return value;
}

function publicRecord(line: string): Record<string, unknown> {
  let record: Record<string, unknown>;
  try {
    record = z.record(z.string(), z.unknown()).parse(JSON.parse(line));
  } catch {
    return { type: "unparsed", text: line };
  }
  if (record["type"] !== "system" || record["subtype"] !== "init") return record;
  const { type, subtype, model, permissionMode, claude_code_version } = record;
  return { type, subtype, model, permissionMode, claude_code_version };
}

function stamped(lines: string[], started: number): string[] {
  const received = Math.round(performance.now() - started);
  return lines.filter((line) => line.trim() !== "").map((line) => JSON.stringify({ ...publicRecord(line), received_ms: received }));
}

async function runSession(dir: string, task: string, maxTurns: number): Promise<{ lines: string[]; exitCode: number }> {
  const env: Record<string, string | undefined> = { ...process.env, COHERENCE_HOME: join(dir, "coherence") };
  for (const key of ["CLAUDE_CODE_REMOTE", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]) delete env[key];
  const argv = ["claude", "-p", task, "--model", "claude-opus-5-5", "--permission-mode", "acceptEdits", "--setting-sources", "project"];
  const started = performance.now();
  const child = Bun.spawn([...argv, "--output-format", "stream-json", "--verbose", "--include-hook-events", "--max-turns", String(maxTurns)], { cwd: join(dir, "posthog"), env, stdout: "pipe", stderr: "inherit" });
  const timer = setTimeout(() => child.kill(), SESSION_TIMEOUT_MS);
  const lines: string[] = [];
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      const parts = `${pending}${decoder.decode(read.value, { stream: true })}`.split("\n");
      pending = parts.pop() ?? "";
      lines.push(...stamped(parts, started));
    }
    lines.push(...stamped([pending], started));
  } finally {
    clearTimeout(timer);
    child.kill();
  }
  return { lines, exitCode: await child.exited };
}

function finalDiff(worktree: string, file: string): string {
  const tracked = sh(["git", "ls-files", "--error-unmatch", file], worktree).code === 0;
  if (tracked) return sh(["git", "diff", "HEAD", "--", file], worktree).stdout;
  if (!existsSync(join(worktree, file))) return `${file} does not exist\n`;
  return sh(["git", "diff", "--no-index", "--", "/dev/null", file], worktree).stdout;
}

const KIT_LINT_TARGET = "nodejs";
const coherenceConfig = z.object({ lint: z.record(z.string(), z.object({ command: z.array(z.string()) })) });

function lintFinal(worktree: string, replay: ReplayCase): string {
  const config = coherenceConfig.parse(JSON.parse(readFileSync(join(worktree, "coherence.config.json"), "utf8")));
  const command = Object.values(config.lint)[0]?.command ?? [];
  const argv = [...command.filter((arg) => arg !== KIT_LINT_TARGET), replay.file];
  const result = sh(argv, worktree);
  return `$ ${argv.join(" ")}\n${result.stdout}${result.stderr}[exit ${result.code}]\n`;
}

const runReport = z.object({ invariants: z.array(z.object({ name: z.string(), verdict: z.string() })) });

function runVerdict(stdout: string, name: string): string {
  try {
    const record = runReport.parse(JSON.parse(stdout.slice(stdout.indexOf("{"))));
    return record.invariants.find((entry) => entry.name === name)?.verdict ?? "missing";
  } catch {
    return "unreadable";
  }
}

async function cleanUp(dir: string, baseline: PostHogState, ref: string) {
  const failures: unknown[] = [];
  const attempt = async (step: () => unknown) => {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  };
  await attempt(() => stopCoherenceServers(dir));
  await attempt(() => tearDown(dir, () => undefined));
  await attempt(() => assertIntact(baseline, ref, dir));
  if (failures.length > 0) throw new AggregateError(failures, `cleaning up ${dir} failed`);
}

async function replayOnce(replay: ReplayCase, arm: Arm, n: number, protocol: Protocol, baseline: PostHogState): Promise<RunRecord> {
  const { kit: dir, evidence } = protocol;
  rmSync(evidence, { recursive: true, force: true });
  mkdirSync(evidence, { recursive: true });
  const kitLog: string[] = [];
  await setUp({ dir, ref: replay.ref, language: replay.language, hooks: arm === "hooks" }, defaultEnvironment(), (line) => kitLog.push(line));
  try {
    const worktree = join(dir, "posthog");
    declareCase(replay, worktree);
    if (arm === "hooks" && protocol.variant !== undefined) kitLog.push(`Coherence hooks turned off in .claude/settings.json, only PostToolUse kept: ${keepOnlyEditHook(worktree).join(", ")}`);
    const witnessed = await witness(dir, replay.invariant, (line) => kitLog.push(line));
    writeFileSync(join(evidence, "witness.txt"), `${kitLog.join("\n")}\n`);
    if (!witnessed) throw new Error(`the witness did not go red then green for ${replay.invariant}; see ${evidence}/witness.txt`);
    const session = await runSession(dir, readFileSync(join(replay.dir, protocol.task), "utf8"), protocol.maxTurns);
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
      ...(protocol.variant === undefined ? {} : { variant: protocol.variant }),
      arm,
      n,
      exitCode: session.exitCode,
      session: readSession(session.lines.join("\n"), replay),
      final: { bypass: content.includes(replay.bypass), reviewerRoute: content.includes(replay.reviewerRoute), verdict: runVerdict(run.stdout, name) },
    };
    writeFileSync(join(evidence, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally {
    await cleanUp(dir, baseline, replay.ref);
  }
}

const recordedRun = z.object({
  pr: z.number(),
  variant: z.enum(VARIANTS).optional(),
  arm: z.enum(["hooks", "control"]),
  n: z.number(),
  exitCode: z.number(),
  session: z.looseObject({ introduced: z.boolean(), flagged: z.boolean() }),
  final: z.object({ bypass: z.boolean(), reviewerRoute: z.boolean(), verdict: z.string() }),
});

function rescored(folder: string): RunRecord {
  const recorded = recordedRun.parse(JSON.parse(readFileSync(join(folder, "run.json"), "utf8")));
  const session = readSession(readFileSync(join(folder, "transcript.jsonl"), "utf8"), loadCase(String(recorded.pr)));
  if (session.introduced !== recorded.session.introduced || session.flagged !== recorded.session.flagged) throw new Error(`${folder}: the trimmed transcript no longer reads as the session run.json recorded`);
  const record: RunRecord = { ...recorded, session };
  writeFileSync(join(folder, "run.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function isComplete(folder: string): boolean {
  return ["run.json", ...EVIDENCE_FILES.map(([, file]) => file)].every((file) => existsSync(join(folder, file)));
}

function subfolders(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(folder, entry.name));
}

function prFolders(root: string): string[] {
  return subfolders(root).filter((folder) => /^\d+$/.test(basename(folder)));
}

function v1Folders(): string[] {
  return prFolders(EVIDENCE).flatMap(subfolders).filter(isComplete);
}

function v2Folders(): string[] {
  return prFolders(join(EVIDENCE, "v2")).flatMap(subfolders).flatMap(subfolders).filter(isComplete);
}

function commandAudit(folders: string[]): CommandAudit {
  const audits = folders.map((folder) => ({ run: relative(EVIDENCE, folder), ...auditTranscript(readFileSync(join(folder, "transcript.jsonl"), "utf8")) }));
  return {
    transcripts: folders.length,
    calls: audits.reduce((sum, audit) => sum + audit.calls, 0),
    ran: audits.reduce((sum, audit) => sum + audit.ran, 0),
    notReadOnly: audits.flatMap((audit) => audit.notReadOnly.map((command) => ({ run: audit.run, command }))),
  };
}

function writeReport() {
  const cases = ["64506", "68756"].map(loadCase);
  const v2 = v2Folders();
  const v1Report = renderReport(v1Folders().map(rescored), cases);
  writeFileSync(join(EVIDENCE, "report.md"), `${v1Report}\n${renderV2(v2.map(rescored), cases, commandAudit(v2))}`);
}

async function main() {
  const [command] = positionals;
  if (command === "report") {
    writeReport();
    return;
  }
  const runs = Number(values.runs);
  const first = Number(values.first);
  if (command === undefined || !isArm(values.arm) || !Number.isInteger(runs) || runs < 1 || !Number.isInteger(first) || first < 1) {
    console.error(USAGE);
    process.exit(64);
  }
  const variant = values.variant;
  if (variant !== undefined && !isVariant(variant)) {
    console.error(USAGE);
    process.exit(64);
  }
  const replay = loadCase(command);
  const baseline = posthogState(replay.ref);
  for (let n = first; n < first + runs; n++) {
    const record = await replayOnce(replay, values.arm, n, protocolFor(replay, values.arm, n, variant), baseline);
    console.log(JSON.stringify(record));
  }
}

await main();
