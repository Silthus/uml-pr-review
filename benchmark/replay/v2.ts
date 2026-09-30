import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { caseVerdict, hookGroup, median, meetsControl, row, seconds, TABLE_HEADER, VARIANTS, type ReplayCase, type RunRecord, type Variant } from "./replay.ts";

const METHOD = [
  "v1 above could not meet criterion 2: its task dictated the file and kept the change to that file, so the fix it asked the hooks arm for was one the task forbade. v2 changes three things and keeps the rest of v1's method.",
  "",
  "1. **Prompts that allow the fix.** Each case has two variants, with 3 hooks and 3 control runs each:",
  "   - **draft**: v1's task with two sentences changed. The file's `before` content is given as \"my draft of `<file>` to start from\", and the task ends \"Make this change; follow the codebase's conventions. Do not run git.\" The code block is v1's, byte for byte. It no longer says \"exactly\" or keeps the change to one file.",
  "   - **intent**: the PR's title and intent, plus what the change does in the commented file, in prose. No code is given, so this variant measures whether the violation arises at all.",
  "2. **The edit hook only.** `setup.ts --hooks` runs `coherence hooks install --host claude`, which wires six events. For the hooks arm, `keepOnlyEditHook` in `benchmark/replay/v2.ts` then deletes Coherence's entries for `SessionStart`, `SubagentStart`, `UserPromptSubmit`, `Stop`, and `SubagentStop` from the `/tmp` worktree's `.claude/settings.json`, and keeps `PostToolUse`. Hooks that are not Coherence's stay. Each hooks run's `witness.txt` records the line that names what was turned off.",
  "   - Why not `.coherence/hooks/<Event>.override.md`: Coherence applies an override to the text only, after the event has done its work. In [`runHook`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/src/lifecycle/hook.ts#L834-L860) at the kit's Coherence base `d7fc348`, `SessionStart` computes `lexiconCoverage` and waits on `gapReading` before `voiced` applies the override, and `Stop` still checks the changed files. An empty override silences the event but keeps its cost. `coherence hooks install` has no per-event option, so deleting the entries is the only per-event switch we found. `coherence hooks check` would name the deleted events as missing.",
  "3. **Criterion 2 without the route.** A hooks run meets it when an edit hook names the invariant after the bypassing edit, the session ends without the bypass, and `run` passes. The reviewer's-route column is informational.",
  "",
  "The rest is v1's method: a fresh kit per run, the identical declaration in both arms, the witness red then green, PostHog's own SessionStart scripts removed in both arms, the same headless `claude -p` command with `acceptEdits`, and the `~/posthog` check after every run. Kits are `/tmp/replay-124-<pr>-<variant>-<arm>-<n>`, and evidence is in `docs/replay/v2/<pr>/<variant>/<arm>-<n>/`. The command was `bun benchmark/replay/run.ts <pr> --arm hooks|control --runs 3 --variant draft|intent`.",
  "",
  "**Command audit.** PostHog's `.claude/settings.json` grants no `permissions.allow`, the runs load only project settings, and no run gets a follow-up turn. Headless, `acceptEdits` then denied every Bash call that was not read-only. That is what these transcripts show, not a guarantee. The audit below reads every v2 transcript. A call ran unless its result is an error other than the command's own exit code. Each call that ran is checked against a read-only allowlist: reading and searching programs, `sed` without `-i`, `find` without `-exec` or `-delete`, and `git status`, `diff`, `log`, `show`, `ls-files`, `grep`, `blame`, and `rev-parse`, with no redirect into a file, no heredoc, and no command substitution. The allowlist is strict, so each call it names needs reading by hand. In these runs the only such call pipes `grep -l` into `xargs grep`, which only reads.",
  "",
  "Deviations from v1:",
  "",
  "- `--max-turns` is 50, not 30, because the intent prompts leave the agent to explore. A run that hit the limit says `error_max_turns` in its row.",
  "- The eight arm-and-variant processes started at the same time but did not end together. Every #64506 run had finished by about 12:53 UTC and the #68756 control runs by about 13:01. #68756 hooks runs 2 and 3 ran on until 13:07 with fewer processes beside them (see the timestamps in each `run-status.txt`). The #68756 hooks runs saw less contention than their control runs, so the #68756 wall-time overhead is, if anything, understated.",
  "- #68756 intent hooks runs ended at 50 and 51 turns, at the raised cap, all with `success`. The cap may have squeezed that variant's turns overhead.",
  "- \"Median\" is the lower middle value when a count is even, as in v1.",
  "",
  "**Adoption cost** compares the medians of the hooks arm and the control arm in one variant: wall time, turns, and the edit hook's own time per `Write`, `Edit`, or `MultiEdit`. The SessionStart / Stop column reads `off` for v2 hooks runs, because those hooks were not installed. Coherence's `PostToolUse` also fires after `Bash`, `Read`, and other tools. Those hooks add a few seconds per session to wall time, but they are not in the edit-hook figure.",
  "",
  "**A separate finding, not re-measured here: the full install's SessionStart.** With every Coherence hook installed, v1's SessionStart hit its 60 s timeout in 6 of 6 hooks runs (the SessionStart / Stop column in v1's tables above), so its context never reached the agent, and Stop was cancelled in 3 of 3 Python runs. That cost at least 60 s per session. v2 does not install those hooks, so it neither repeats nor re-measures that number.",
  "",
  "Threats to validity:",
  "",
  "- **The declaration is visible in both arms.** Both arms carry the spec and the lint entry, uncommitted in the `/tmp` worktree, so the control arm is \"declared, without the hook\", not \"undeclared\". An agent free to explore can read the spec, or diff the lint config, before it writes. v1's dictated task hid this effect.",
  "- **Agents ran git despite the prompt.** The prompts say \"Do not run git\", and 16 of 24 runs still called read-only git. Some of those calls were denied, and the rest ran. That is part of how the declaration reached the control arm. #64506 draft hooks 1, 2, and 3 and intent control 3 ran `git diff -- .oxlintrc.nodejs.json`, which shows the added ban ([draft hooks 3](v2/64506/draft/hooks-3/transcript.jsonl)). #68756 draft control 2 ran `git status`, which lists the untracked `Helpers.spec.md` ([transcript](v2/68756/draft/control-2/transcript.jsonl)).",
  "- **The sample is small.** Three runs per arm and variant describe these runs. They do not give a rate.",
  "",
  "Proof: the red and green test logs, the gate, and the `~/posthog` check after the last batch are in [`docs/replay/v2/proof/`](v2/proof/). The harness also stops with an error if `~/posthog` changes after any run, and all 24 runs finished.",
  "",
];

const EDIT_HOOK = "PostToolUse";
const COHERENCE_HOOK = /\bcoherence hook (\w+)\s*$/;

const claudeSettings = z.looseObject({ hooks: z.record(z.string(), z.array(hookGroup)).default({}) });

type HookGroup = z.infer<typeof hookGroup>;

function isCoherenceHook(hook: HookGroup["hooks"][number]): boolean {
  return COHERENCE_HOOK.test(hook.command ?? "");
}

function withoutCoherence(groups: HookGroup[]): HookGroup[] {
  return groups.map((group) => ({ ...group, hooks: group.hooks.filter((hook) => !isCoherenceHook(hook)) })).filter((group) => group.hooks.length > 0);
}

export function keepOnlyEditHook(worktree: string): string[] {
  const path = join(worktree, ".claude/settings.json");
  const settings = claudeSettings.parse(JSON.parse(readFileSync(path, "utf8")));
  const turnedOff: string[] = [];
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const turnsOff = event !== EDIT_HOOK && groups.some((group) => group.hooks.some(isCoherenceHook));
    const kept = turnsOff ? withoutCoherence(groups) : groups;
    if (turnsOff) turnedOff.push(event);
    if (kept.length > 0) hooks[event] = kept;
  }
  writeFileSync(path, `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`);
  return turnedOff;
}

function meetsHooks(run: RunRecord): boolean {
  return run.session.flagged && !run.final.bypass && run.final.verdict === "pass";
}

function introducedIn(runs: RunRecord[]): string {
  return `${runs.filter((run) => run.session.introduced).length} of ${runs.length}`;
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

function editHookCost(hooks: RunRecord[]): string {
  const latencies = hooks.flatMap((run) => run.session.hookSeconds);
  if (latencies.length === 0) return "no edit hook ran";
  return `edit hook ${seconds(median(latencies))} per edit (max ${seconds(Math.max(...latencies))})`;
}

function adoptionCost(control: RunRecord[], hooks: RunRecord[]): string {
  if (control.length === 0 || hooks.length === 0) return "Adoption cost: not measured, an arm has no runs.";
  const wall = (runs: RunRecord[]) => Math.round(median(runs.map((run) => run.session.seconds)));
  const turns = (runs: RunRecord[]) => median(runs.map((run) => run.session.turns));
  return `Adoption cost, median over each arm: wall time ${wall(hooks)} s against ${wall(control)} s (${signed(wall(hooks) - wall(control))} s), turns ${turns(hooks)} against ${turns(control)} (${signed(turns(hooks) - turns(control))}), ${editHookCost(hooks)}.`;
}

function notExercised(control: RunRecord[], hooks: RunRecord[]): string {
  const complete = control.length > 0 && hooks.length > 0;
  if (!complete || hooks.some((run) => run.session.introduced)) return "";
  return ` (criterion 2 not exercised: 0 of ${hooks.length} hooks runs wrote the bypass)`;
}

interface VariantSection {
  lines: string[];
  verdict: string;
}

function variantSection(replay: ReplayCase, variant: Variant, runs: RunRecord[]): VariantSection {
  const ofVariant = runs.filter((run) => run.pr === replay.pr && run.variant === variant).sort((a, b) => a.arm.localeCompare(b.arm) || a.n - b.n);
  const control = ofVariant.filter((run) => run.arm === "control");
  const hooks = ofVariant.filter((run) => run.arm === "hooks");
  const verdict = `${caseVerdict(control, hooks, meetsHooks)}${notExercised(control, hooks)}`;
  const lines = [
    `#### ${variant}`,
    "",
    `| ${TABLE_HEADER.join(" | ")} |`,
    `|${TABLE_HEADER.map(() => "---").join("|")}|`,
    ...ofVariant.map(row),
    "",
    `1. Control: ${control.filter(meetsControl).length} of ${control.length} runs end with the bypass in the final diff and \`run\` failing the invariant.`,
    `2. Hooks: ${hooks.filter(meetsHooks).length} of ${hooks.length} runs have a hook name the invariant after the bypassing edit, end without the bypass, and pass \`run\`.`,
    "",
    `The violation arose in ${introducedIn(control)} control runs and ${introducedIn(hooks)} hooks runs.`,
    adoptionCost(control, hooks),
    "",
    `**Verdict (${variant}): ${verdict}**`,
    "",
  ];
  return { lines, verdict };
}

function caseSection(replay: ReplayCase, runs: RunRecord[]): string[] {
  const sections = VARIANTS.map((variant) => ({ variant, ...variantSection(replay, variant, runs) }));
  return [
    `### #${replay.pr}: \`${replay.file}\``,
    "",
    `Invariant: \`${replay.invariant}\`, at PostHog \`${replay.ref.slice(0, 12)}\`. Prompts: [draft](../../benchmark/replay/cases/${replay.pr}/draft.md), [intent](../../benchmark/replay/cases/${replay.pr}/intent.md).`,
    "",
    ...sections.flatMap((section) => section.lines),
    ...replay.v2Notes.map((note) => `- ${note}`),
    ...(replay.v2Notes.length > 0 ? [""] : []),
    `**Case verdict for #${replay.pr}: ${sections.map((section) => `${section.variant} ${section.verdict}`).join(", ")}.**`,
    "",
  ];
}

export interface TranscriptAudit {
  calls: number;
  ran: number;
  notReadOnly: string[];
}

export interface CommandAudit {
  transcripts: number;
  calls: number;
  ran: number;
  notReadOnly: { run: string; command: string }[];
}

function auditLines(audit: CommandAudit): string[] {
  const count = audit.notReadOnly.length;
  return [
    `Command audit: the ${audit.transcripts} transcripts made ${audit.calls} Bash calls, and ${audit.ran} of them ran. ${count} of those that ran ${count === 1 ? "is" : "are"} not on the read-only allowlist${count === 0 ? "." : ":"}`,
    ...audit.notReadOnly.map((entry) => `- ${entry.run}: \`${entry.command}\``),
    "",
  ];
}

export function renderV2(runs: RunRecord[], cases: ReplayCase[], audit: CommandAudit): string {
  return ["## v2: protocol without the confound", "", ...METHOD, ...auditLines(audit), ...cases.flatMap((replay) => caseSection(replay, runs))].join("\n");
}

const OWN_EXIT_CODE = /^\W*Exit code \d+/;
const READ_ONLY_PROGRAMS = new Set(["ls", "cat", "head", "tail", "grep", "rg", "wc", "sort", "uniq", "cut", "tr", "echo", "printf", "pwd", "cd", "which", "file", "stat", "du", "tree", "diff", "test", "true", "basename", "dirname", "realpath", "awk", "jq", "sed", "find", "for", "done"]);
const READ_ONLY_GIT = new Set(["status", "diff", "log", "show", "ls-files", "grep", "blame", "rev-parse"]);
const PREFIXES = new Set(["do", "then", "else"]);
const WRITING_FLAGS: Record<string, RegExp> = { sed: /^(?:-i|--in-place)/, find: /^-(?:exec|execdir|delete|fprint|fprintf|fls)$/ };
const UNSAFE_SYNTAX = /\$\(|`|<<|<\(|(?<![0-9&])>(?!&|\s*\/dev\/null)/;

const turn = z.object({ type: z.enum(["assistant", "user"]), message: z.object({ content: z.array(z.unknown()) }) });
const bashUse = z.object({ type: z.literal("tool_use"), id: z.string(), name: z.literal("Bash"), input: z.object({ command: z.string() }) });
const toolResult = z.object({ type: z.literal("tool_result"), tool_use_id: z.string(), is_error: z.boolean().default(false), content: z.unknown() });

function blocks(line: string): unknown[] {
  const parsed = turn.safeParse(JSON.parse(line));
  return parsed.success ? parsed.data.message.content : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  const texts = z.array(z.object({ text: z.string() })).safeParse(content);
  return texts.success ? texts.data.map((block) => block.text).join("\n") : "";
}

function deniedUse(block: unknown): string[] {
  const result = toolResult.safeParse(block);
  return result.success && result.data.is_error && !OWN_EXIT_CODE.test(resultText(result.data.content)) ? [result.data.tool_use_id] : [];
}

function withoutQuotedText(command: string): string {
  return command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");
}

function program(segment: string): string[] {
  const words = segment.trim().split(/\s+/).filter((word) => word !== "" && !/^\w+=/.test(word));
  if (words[0] === "timeout") return program(words.slice(2).join(" "));
  if (PREFIXES.has(words[0] ?? "")) return program(words.slice(1).join(" "));
  return words;
}

function isReadOnlySegment(segment: string): boolean {
  const [name, ...args] = program(segment);
  if (name === undefined) return true;
  const writing = WRITING_FLAGS[name];
  if (writing !== undefined && args.some((arg) => writing.test(arg))) return false;
  if (name === "git") return READ_ONLY_GIT.has((args[0] === "-C" ? args[2] : args[0]) ?? "");
  return READ_ONLY_PROGRAMS.has(name);
}

function isReadOnly(command: string): boolean {
  const bare = withoutQuotedText(command);
  if (UNSAFE_SYNTAX.test(bare)) return false;
  return bare.split(/&&|\|\||[;|\n]/).every(isReadOnlySegment);
}

export function auditTranscript(transcript: string): TranscriptAudit {
  const all = transcript.split("\n").filter((line) => line.trim() !== "").flatMap(blocks);
  const denied = new Set(all.flatMap(deniedUse));
  const calls = all.flatMap((block) => {
    const use = bashUse.safeParse(block);
    return use.success ? [use.data] : [];
  });
  const ran = calls.filter((call) => !denied.has(call.id));
  return { calls: calls.length, ran: ran.length, notReadOnly: ran.map((call) => call.input.command).filter((command) => !isReadOnly(command)) };
}
