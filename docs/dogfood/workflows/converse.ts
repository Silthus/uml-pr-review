import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

const MODEL = "claude-opus-5-5";
const SKILL_DIR = resolve(import.meta.dir, "../../../skills/define-invariant");
const SKILL_FILES = ["SKILL.md", "enforcers.md"];
const TURN_TIMEOUT_MS = 30 * 60 * 1000;
const DONE = /^\W*DONE\W*$/i;
const USAGE = "usage: bun docs/dogfood/workflows/converse.ts <kit dir> --opening <message> --persona <file> --out <dir> [--max-turns <n>]";

interface Turn {
  speaker: "skill" | "engineer";
  text: string;
  tools: string[];
  seconds: number;
}

interface SkillReply {
  sessionId: string;
  text: string;
  tools: string[];
}

const toolUse = z.object({ type: z.literal("tool_use"), name: z.string(), input: z.record(z.string(), z.unknown()) });
const assistantEvent = z.object({ type: z.literal("assistant"), message: z.object({ content: z.array(z.unknown()) }) });
const resultEvent = z.object({ type: z.literal("result"), session_id: z.string(), is_error: z.boolean(), result: z.string().optional(), subtype: z.string() });

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function describeTool(name: string, input: Record<string, unknown>): string {
  const target = input["command"] ?? input["file_path"] ?? input["pattern"] ?? input["path"] ?? "";
  return `${name}: ${String(target)}`;
}

function toolsUsed(event: unknown): string[] {
  const assistant = assistantEvent.safeParse(event);
  if (!assistant.success) return [];
  return assistant.data.message.content.flatMap((block) => {
    const use = toolUse.safeParse(block);
    return use.success ? [describeTool(use.data.name, use.data.input)] : [];
  });
}

function readSkillReply(stdout: string): SkillReply {
  const events = stdout.split("\n").map(parseLine);
  const result = events.map((event) => resultEvent.safeParse(event)).find((parsed) => parsed.success)?.data;
  if (result === undefined) throw new Error(`the skill session printed no result:\n${stdout.slice(-2000)}`);
  if (result.is_error || result.result === undefined) throw new Error(`the skill session ended in ${result.subtype}`);
  return { sessionId: result.session_id, text: result.result, tools: events.flatMap(toolsUsed) };
}

function spawn(argv: string[], cwd: string, env: Record<string, string | undefined>) {
  const run = Bun.spawnSync(argv, { cwd, env, stdout: "pipe", stderr: "pipe", timeout: TURN_TIMEOUT_MS });
  if (run.exitCode !== 0) throw new Error(`${argv[0]} exited ${run.exitCode}: ${run.stderr.toString().slice(-2000)}`);
  return run.stdout.toString();
}

function runSkillTurn(worktree: string, coherence: string, message: string, sessionId: string | undefined): SkillReply {
  const resume = sessionId === undefined ? [] : ["--resume", sessionId];
  const argv = [
    "claude", "-p", message, "--model", MODEL, "--plugin-dir", SKILL_DIR, "--setting-sources", "local",
    "--permission-mode", "acceptEdits", "--allowedTools", "Bash", "Read", "Grep", "Glob", "Edit", "Write",
    "--output-format", "stream-json", "--verbose", ...resume,
  ];
  return readSkillReply(spawn(argv, worktree, { ...process.env, COHERENCE_HOME: coherence }));
}

function transcriptText(turns: Turn[]): string {
  return turns.map((turn) => `### ${turn.speaker === "skill" ? "Skill" : "Engineer"}\n\n${turn.text}`).join("\n\n");
}

function runEngineerTurn(persona: string, turns: Turn[]): string {
  const prompt = `${transcriptText(turns)}\n\n---\nReply to the skill's last message as the engineer. If its last message is the closing summary and it asks nothing more, reply with exactly DONE.`;
  const argv = ["claude", "-p", prompt, "--model", MODEL, "--tools", "", "--setting-sources", "local", "--system-prompt", persona];
  return spawn(argv, "/tmp", process.env).trim();
}

function timed<T>(step: () => T): { value: T; seconds: number } {
  const started = performance.now();
  const value = step();
  return { value, seconds: Math.round((performance.now() - started) / 100) / 10 };
}

function skillHash(): string {
  const hash = createHash("sha256");
  for (const file of SKILL_FILES) hash.update(readFileSync(join(SKILL_DIR, file)));
  return hash.digest("hex").slice(0, 12);
}

function renderTools(tools: string[]): string {
  if (tools.length === 0) return "";
  const blocks = tools.map((tool) => "```\n" + tool + "\n```").join("\n");
  return `\n\n<details><summary>${tools.length} tool calls</summary>\n\n${blocks}\n\n</details>`;
}

function renderTranscript(turns: Turn[], hash: string): string {
  const header = `Skill: \`skills/define-invariant\` (${SKILL_FILES.join(" + ")}), sha256 ${hash}. Model: ${MODEL}.`;
  const body = turns.map((turn, index) => `## ${index + 1}. ${turn.speaker === "skill" ? "Skill" : "Engineer"} (${turn.seconds} s)\n\n${turn.text}${renderTools(turn.tools)}`);
  return [header, ...body].join("\n\n");
}

function save(out: string, turns: Turn[], hash: string) {
  writeFileSync(join(out, "transcript.md"), `${renderTranscript(turns, hash)}\n`);
}

function converse(dir: string, opening: string, persona: string, out: string, maxTurns: number) {
  const hash = skillHash();
  const worktree = join(dir, "posthog");
  const coherence = join(dir, "coherence");
  const turns: Turn[] = [{ speaker: "engineer", text: opening, tools: [], seconds: 0 }];
  let sessionId: string | undefined;
  let message = opening;
  for (let round = 0; round < maxTurns; round++) {
    const skill = timed(() => runSkillTurn(worktree, coherence, message, sessionId));
    sessionId = skill.value.sessionId;
    turns.push({ speaker: "skill", text: skill.value.text, tools: skill.value.tools, seconds: skill.seconds });
    save(out, turns, hash);
    const engineer = timed(() => runEngineerTurn(persona, turns));
    if (DONE.test(engineer.value)) return;
    turns.push({ speaker: "engineer", text: engineer.value, tools: [], seconds: engineer.seconds });
    save(out, turns, hash);
    message = engineer.value;
  }
  throw new Error(`no closing summary after ${maxTurns} skill turns`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { opening: { type: "string" }, persona: { type: "string" }, out: { type: "string" }, "max-turns": { type: "string", default: "16" } },
});
const [dir] = positionals;
const maxTurns = z.coerce.number().int().positive().safeParse(values["max-turns"]);
if (dir === undefined || values.opening === undefined || values.persona === undefined || values.out === undefined || !maxTurns.success) {
  console.error(USAGE);
  process.exit(64);
}
mkdirSync(values.out, { recursive: true });
converse(resolve(dir), values.opening, readFileSync(values.persona, "utf8"), values.out, maxTurns.data);
