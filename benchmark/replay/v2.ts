import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { caseVerdict, latency, median, meetsControl, row, TABLE_HEADER, type ReplayCase, type RunRecord } from "./replay.ts";

export const VARIANTS = ["draft", "intent"] as const;
export type Variant = (typeof VARIANTS)[number];

export function isVariant(value: string): value is Variant {
  return (VARIANTS as readonly string[]).includes(value);
}

const METHOD = [
  "v1 above could not meet criterion 2: its task dictated the file and kept the change to that file, so the fix it asked the hooks arm for was one the task forbade. v2 changes three things and keeps the rest of v1's method.",
  "",
  "1. **Prompts that allow the fix.** Each case has two variants, with 3 hooks and 3 control runs each:",
  "   - **draft**: v1's task with two sentences changed. The file's `before` content is given as \"my draft of `<file>` to start from\", and the task ends \"Make this change; follow the codebase's conventions. Do not run git.\" The code block is v1's, byte for byte. It no longer says \"exactly\" or keeps the change to one file.",
  "   - **intent**: the PR's title and intent, plus what the change does in the commented file, in prose. No code is given, so this variant measures whether the violation arises at all.",
  "2. **The edit hook only.** `setup.ts --hooks` runs `coherence hooks install --host claude`, which wires six events. For the hooks arm, `keepOnlyEditHook` in `benchmark/replay/v2.ts` then deletes Coherence's entries for `SessionStart`, `SubagentStart`, `UserPromptSubmit`, `Stop`, and `SubagentStop` from the `/tmp` worktree's `.claude/settings.json`, and keeps `PostToolUse`. Hooks that are not Coherence's stay. Each hooks run's `witness.txt` records the line that names what was turned off.",
  "   - Why not `.coherence/hooks/<Event>.override.md`: Coherence applies an override to the text only, after the event has done its work. In `runHook` (`src/lifecycle/hook.ts`), `SessionStart` computes `lexiconCoverage` and waits on `gapReading` before `voiced` applies the override, and `Stop` still checks the changed files. An empty override silences the event but keeps its cost. `coherence hooks install` has no per-event option, so deleting the entries is the only way to turn an event off. `coherence hooks check` would name the deleted events as missing.",
  "3. **Criterion 2 without the route.** A hooks run meets it when an edit hook names the invariant after the bypassing edit, the session ends without the bypass, and `run` passes. The reviewer's-route column is informational.",
  "",
  "The rest is v1's method: a fresh kit per run, the identical declaration in both arms, the witness red then green, PostHog's own SessionStart scripts removed in both arms, the same headless `claude -p` command with `acceptEdits`, and the `~/posthog` check after every run. Kits are `/tmp/replay-124-<pr>-<variant>-<arm>-<n>`, and evidence is in `docs/replay/v2/<pr>/<variant>/<arm>-<n>/`. The command was `bun benchmark/replay/run.ts <pr> --arm hooks|control --runs 3 --variant draft|intent`.",
  "",
  "The runs can't reach out. PostHog's `.claude/settings.json` grants no `permissions.allow`, the runs load only project settings, and no run gets a follow-up turn, so headless `acceptEdits` denies every Bash call that is not read-only. The command audit below also reads every v2 transcript for a Bash call that could reach the network or write outside the worktree.",
  "",
  "Deviations from v1:",
  "",
  "- `--max-turns` is 50, not 30, because the intent prompts leave the agent to explore. A run that hit the limit says `error_max_turns` in its row.",
  "- The eight arm-and-variant processes ran at the same time. Wall times include that contention, in both arms.",
  "",
  "**Adoption cost** compares the medians of the hooks arm and the control arm in one variant: wall time, turns, and the edit hook's own time per `Write`, `Edit`, or `MultiEdit`. The SessionStart / Stop column reads `off` for v2 hooks runs, because those hooks were not installed.",
  "",
  "**A separate finding, not re-measured here: the full install's SessionStart.** With every Coherence hook installed, v1's SessionStart hit its 60 s timeout in 6 of 6 hooks runs (the SessionStart / Stop column in v1's tables above), so its context never reached the agent, and Stop was cancelled in 3 of 3 Python runs. That cost at least 60 s per session. v2 does not install those hooks, so it neither repeats nor re-measures that number.",
  "",
  "Threats to validity:",
  "",
  "- **The declaration is visible in both arms.** Both arms carry the spec and the lint entry, uncommitted in the `/tmp` worktree, so the control arm is \"declared, without the hook\", not \"undeclared\". An agent free to explore can read the spec, or diff the lint config, before it writes. v1's dictated task hid this effect.",
  "- **The sample is small.** Three runs per arm and variant describe these runs. They do not give a rate.",
  "",
];

const EDIT_HOOK = "PostToolUse";
const COHERENCE_HOOK = /\bcoherence hook (\w+)\s*$/;

const hookCommand = z.looseObject({ command: z.string().optional() });
const hookGroup = z.looseObject({ hooks: z.array(hookCommand) });
const claudeSettings = z.looseObject({ hooks: z.record(z.string(), z.array(hookGroup)).default({}) });

type HookGroup = z.infer<typeof hookGroup>;

function isCoherenceHook(hook: z.infer<typeof hookCommand>): boolean {
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

function adoptionCost(control: RunRecord[], hooks: RunRecord[]): string {
  if (control.length === 0 || hooks.length === 0) return "Adoption cost: not measured, an arm has no runs.";
  const wall = (runs: RunRecord[]) => Math.round(median(runs.map((run) => run.session.seconds)));
  const turns = (runs: RunRecord[]) => median(runs.map((run) => run.session.turns));
  const editHook = latency(hooks.flatMap((run) => run.session.hookSeconds));
  return `Adoption cost, median over each arm: wall time ${wall(hooks)} s against ${wall(control)} s (${signed(wall(hooks) - wall(control))} s), turns ${turns(hooks)} against ${turns(control)} (${signed(turns(hooks) - turns(control))}), edit hook ${editHook.replace(" (", " per edit (")}.`;
}

interface VariantSection {
  lines: string[];
  verdict: string;
}

function variantSection(replay: ReplayCase, variant: Variant, runs: RunRecord[]): VariantSection {
  const ofVariant = runs.filter((run) => run.pr === replay.pr && run.variant === variant).sort((a, b) => a.arm.localeCompare(b.arm) || a.n - b.n);
  const control = ofVariant.filter((run) => run.arm === "control");
  const hooks = ofVariant.filter((run) => run.arm === "hooks");
  const verdict = caseVerdict(control, hooks, meetsHooks);
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

export interface OutwardCommand {
  command: string;
  ran: boolean;
}

export interface CommandAudit {
  transcripts: number;
  commands: (OutwardCommand & { run: string })[];
}

function auditLines(audit: CommandAudit): string[] {
  const ran = audit.commands.filter((command) => command.ran).length;
  return [
    `Command audit: ${audit.commands.length} Bash calls in ${audit.transcripts} transcripts tried \`gh\`, \`git push\`, \`git commit\`, \`curl\`, \`wget\`, \`flox\`, a package manager, or \`uv\`, and ${ran} of them ran.`,
    ...audit.commands.map((command) => `- ${command.run}, ${command.ran ? "ran" : "denied"}: \`${command.command}\``),
    "",
  ];
}

export function renderV2(runs: RunRecord[], cases: ReplayCase[], audit: CommandAudit): string {
  return ["## v2: protocol without the confound", "", ...METHOD, ...auditLines(audit), ...cases.flatMap((replay) => caseSection(replay, runs))].join("\n");
}

const OUTWARD = /(?:^|[\s;&|(])(?:gh|git\s+(?:push|commit)|curl|wget|flox|npm|npx|pnpm|yarn|pip|uv|uvx)(?:\s|$)/m;
const DENIED = /requires? approval/;
const turn = z.object({ type: z.enum(["assistant", "user"]), message: z.object({ content: z.array(z.unknown()) }) });
const bashUse = z.object({ type: z.literal("tool_use"), id: z.string(), name: z.literal("Bash"), input: z.object({ command: z.string() }) });
const toolResult = z.object({ type: z.literal("tool_result"), tool_use_id: z.string(), is_error: z.boolean().default(false), content: z.unknown() });

function blocks(line: string): unknown[] {
  const parsed = turn.safeParse(JSON.parse(line));
  return parsed.success ? parsed.data.message.content : [];
}

function deniedUse(block: unknown): string[] {
  const result = toolResult.safeParse(block);
  return result.success && result.data.is_error && DENIED.test(JSON.stringify(result.data.content)) ? [result.data.tool_use_id] : [];
}

export function outwardCommands(transcript: string): OutwardCommand[] {
  const all = transcript.split("\n").filter((line) => line.trim() !== "").flatMap(blocks);
  const denied = new Set(all.flatMap(deniedUse));
  return all.flatMap((block) => {
    const use = bashUse.safeParse(block);
    if (!use.success || !OUTWARD.test(use.data.input.command)) return [];
    return [{ command: use.data.input.command, ran: !denied.has(use.data.id) }];
  });
}
