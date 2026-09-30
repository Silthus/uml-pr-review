import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const MODEL = "claude-opus-5-5";
const DONE = "DONE";
const SKILL_DIR = resolve(import.meta.dir, "../../../skills/define-invariant");
const USAGE = "usage: bun docs/dogfood/workflows/converse.ts <kit dir> --opening <message> --persona <file> --out <dir> [--max-turns <n>]";

interface Turn {
  speaker: "skill" | "engineer";
  text: string;
  commands: string[];
  seconds: number;
}

interface SkillReply {
  sessionId: string;
  text: string;
  commands: string[];
}

function streamEvent(line: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function bashCommands(event: Record<string, unknown>): string[] {
  const message = event["message"] as { content?: { type: string; name?: string; input?: { command?: string } }[] } | undefined;
  return (message?.content ?? []).filter((block) => block.type === "tool_use" && block.name === "Bash").map((block) => block.input?.command ?? "");
}

function readSkillReply(stdout: string): SkillReply {
  const events = stdout.split("\n").map(streamEvent).filter((event) => event !== undefined);
  const result = events.find((event) => event["type"] === "result");
  if (result === undefined) throw new Error(`the skill session printed no result:\n${stdout.slice(-2000)}`);
  const commands = events.filter((event) => event["type"] === "assistant").flatMap(bashCommands);
  return { sessionId: String(result["session_id"]), text: String(result["result"] ?? ""), commands };
}

function runSkillTurn(worktree: string, coherence: string, message: string, sessionId: string | undefined): SkillReply {
  const resume = sessionId === undefined ? [] : ["--resume", sessionId];
  const argv = [
    "claude", "-p", message, "--model", MODEL, "--plugin-dir", SKILL_DIR, "--setting-sources", "local",
    "--permission-mode", "acceptEdits", "--allowedTools", "Bash", "Read", "Grep", "Glob", "Edit", "Write",
    "--output-format", "stream-json", "--verbose", ...resume,
  ];
  const run = Bun.spawnSync(argv, { cwd: worktree, env: { ...process.env, COHERENCE_HOME: coherence }, stdout: "pipe", stderr: "pipe" });
  return readSkillReply(run.stdout.toString());
}

function transcriptText(turns: Turn[]): string {
  return turns.map((turn) => `### ${turn.speaker === "skill" ? "Skill" : "Engineer"}\n\n${turn.text}`).join("\n\n");
}

function runEngineerTurn(persona: string, turns: Turn[]): string {
  const prompt = `${transcriptText(turns)}\n\n---\nReply to the skill's last message as the engineer. If its last message is the closing summary and it asks nothing more, reply with exactly ${DONE}.`;
  const argv = ["claude", "-p", prompt, "--model", MODEL, "--tools", "", "--setting-sources", "local", "--system-prompt", persona];
  const run = Bun.spawnSync(argv, { cwd: "/tmp", stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`the engineer session exited ${run.exitCode}: ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}

function timed<T>(step: () => T): { value: T; seconds: number } {
  const started = performance.now();
  const value = step();
  return { value, seconds: Math.round((performance.now() - started) / 100) / 10 };
}

function renderCommands(commands: string[]): string {
  if (commands.length === 0) return "";
  const blocks = commands.map((command) => "```sh\n" + command + "\n```").join("\n");
  return `\n\n<details><summary>${commands.length} commands</summary>\n\n${blocks}\n\n</details>`;
}

function renderTranscript(turns: Turn[]): string {
  return turns.map((turn, index) => `## ${index + 1}. ${turn.speaker === "skill" ? "Skill" : "Engineer"} (${turn.seconds} s)\n\n${turn.text}${renderCommands(turn.commands)}`).join("\n\n");
}

function save(out: string, turns: Turn[]) {
  writeFileSync(join(out, "transcript.md"), `${renderTranscript(turns)}\n`);
  writeFileSync(join(out, "transcript.json"), `${JSON.stringify(turns, null, 2)}\n`);
}

function converse(dir: string, opening: string, persona: string, out: string, maxTurns: number) {
  const worktree = join(dir, "posthog");
  const coherence = join(dir, "coherence");
  const turns: Turn[] = [{ speaker: "engineer", text: opening, commands: [], seconds: 0 }];
  let sessionId: string | undefined;
  let message = opening;
  for (let round = 0; round < maxTurns; round++) {
    const skill = timed(() => runSkillTurn(worktree, coherence, message, sessionId));
    sessionId = skill.value.sessionId;
    turns.push({ speaker: "skill", text: skill.value.text, commands: skill.value.commands, seconds: skill.seconds });
    save(out, turns);
    const engineer = timed(() => runEngineerTurn(persona, turns));
    if (engineer.value === DONE) return;
    turns.push({ speaker: "engineer", text: engineer.value, commands: [], seconds: engineer.seconds });
    save(out, turns);
    message = engineer.value;
  }
  throw new Error(`no closing summary after ${maxTurns} skill turns`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { opening: { type: "string" }, persona: { type: "string" }, out: { type: "string" }, "max-turns": { type: "string", default: "16" } },
});
const [dir] = positionals;
if (dir === undefined || values.opening === undefined || values.persona === undefined || values.out === undefined) {
  console.error(USAGE);
  process.exit(64);
}
mkdirSync(values.out, { recursive: true });
converse(resolve(dir), values.opening, readFileSync(values.persona, "utf8"), values.out, Number(values["max-turns"]));
