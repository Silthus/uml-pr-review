import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

const CASES = join(import.meta.dir, "cases");

export const VARIANTS = ["draft", "intent"] as const;
export type Variant = (typeof VARIANTS)[number];

export function isVariant(value: string): value is Variant {
  return (VARIANTS as readonly string[]).includes(value);
}
const RESTRICTED_IMPORTS = "eslint/no-restricted-imports";

const fix = z.object({ file: z.string(), replace: z.string(), with: z.string() });

const restrictedImport = z.object({ group: z.array(z.string()), message: z.string() });

const oxlintBan = z.object({
  config: z.string(),
  override: z.string(),
  pattern: restrictedImport,
  residual: z.array(z.string()),
});

const forbiddenElement = z.object({
  config: z.string(),
  override: z.string(),
  forbid: z.object({ element: z.string(), message: z.string() }),
  residual: z.array(z.string()),
  target: z.string(),
});

export type ForbiddenElement = z.infer<typeof forbiddenElement>;

const replayCase = z.object({
  pr: z.number(),
  language: z.enum(["typescript", "python"]),
  ref: z.string(),
  file: z.string(),
  spec: z.string(),
  invariant: z.string(),
  bypass: z.string(),
  reviewerRoute: z.string(),
  fixes: z.array(fix),
  lint: z.union([oxlintBan, forbiddenElement]).optional(),
  notes: z.array(z.string()).default([]),
  v2Notes: z.array(z.string()).default([]),
});

export type ReplayCase = z.infer<typeof replayCase> & { dir: string };

export function loadCase(pr: string): ReplayCase {
  const dir = join(CASES, pr);
  return { ...replayCase.parse(JSON.parse(readFileSync(join(dir, "case.json"), "utf8"))), dir };
}

export function declareCase(replay: ReplayCase, worktree: string) {
  for (const change of replay.fixes) applyFix(worktree, change);
  mkdirSync(dirname(join(worktree, replay.spec)), { recursive: true });
  copyFileSync(join(replay.dir, basename(replay.spec)), join(worktree, replay.spec));
  if (replay.lint !== undefined) declareLint(worktree, replay.lint);
  dropPostHogSessionStart(worktree);
}

function isForbiddenElement(lint: NonNullable<ReplayCase["lint"]>): lint is ForbiddenElement {
  return "forbid" in lint;
}

function declareLint(worktree: string, lint: NonNullable<ReplayCase["lint"]>) {
  if (!isForbiddenElement(lint)) return banInOxlint(worktree, lint);
  forbidInOxlint(worktree, lint);
  pointCoherenceAt(worktree, lint);
}

export function lintTarget(replay: ReplayCase): string | undefined {
  return replay.lint !== undefined && isForbiddenElement(replay.lint) ? replay.lint.target : undefined;
}

const POSTHOG_SESSION_SCRIPTS = ".claude/hooks/setup-";
export const hookGroup = z.looseObject({ hooks: z.array(z.looseObject({ command: z.string().optional() })) });
const claudeSettings = z.looseObject({ hooks: z.looseObject({ SessionStart: z.array(hookGroup).optional() }).optional() });

function dropPostHogSessionStart(worktree: string) {
  const path = join(worktree, ".claude/settings.json");
  if (!existsSync(path)) return;
  const settings = claudeSettings.parse(JSON.parse(readFileSync(path, "utf8")));
  const sessionStart = settings.hooks?.SessionStart;
  if (settings.hooks === undefined || sessionStart === undefined) return;
  settings.hooks.SessionStart = sessionStart.filter((group) => !group.hooks.some((hook) => hook.command?.includes(POSTHOG_SESSION_SCRIPTS)));
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

function applyFix(worktree: string, change: z.infer<typeof fix>) {
  const path = join(worktree, change.file);
  const before = readFileSync(path, "utf8");
  if (!before.includes(change.replace)) throw new Error(`${change.file} does not contain "${change.replace}", so the pre-declaration fix does not apply`);
  writeFileSync(path, before.replaceAll(change.replace, change.with));
}

export function invariantName(replay: ReplayCase): string {
  return replay.invariant.slice(dirname(replay.spec).length + 1);
}

export interface Session {
  introduced: boolean;
  flagged: boolean;
  turns: number;
  seconds: number;
  costUsd: number;
  hookSeconds: number[];
  sessionStartSeconds: number;
  stopSeconds: number;
  cancelledHooks: string[];
  ending: string;
  proposedRoute: boolean;
  closingQuestion: string;
}

const toolUse = z.object({ type: z.literal("tool_use"), name: z.string(), input: z.record(z.string(), z.unknown()) });
const assistant = z.object({ type: z.literal("assistant"), message: z.object({ content: z.array(z.unknown()) }) });
const hookRecord = z.object({
  type: z.literal("system"),
  subtype: z.enum(["hook_started", "hook_response"]),
  hook_id: z.string(),
  hook_name: z.string(),
  hook_event: z.string(),
  output: z.string().optional(),
  outcome: z.string().optional(),
  received_ms: z.number(),
});
const result = z.object({ type: z.literal("result"), subtype: z.string().default("unknown"), num_turns: z.number(), total_cost_usd: z.number(), received_ms: z.number() });

const EDIT_HOOKS = /^PostToolUse:(Write|Edit|MultiEdit)$/;

type ToolUse = z.infer<typeof toolUse>;
type HookRecord = z.infer<typeof hookRecord>;

function total(values: number[]): number {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(3));
}

export function readSession(transcript: string, replay: ReplayCase): Session {
  const records = transcript.split("\n").filter((line) => line.trim() !== "").map((line): unknown => JSON.parse(line));
  const introducedAt = records.findIndex((record) => toolUsesIn(record).some((use) => introducesBypass(use, replay)));
  const hooks = records.map((record) => hookRecord.safeParse(record)).map((parsed) => (parsed.success ? parsed.data : undefined));
  const known = hooks.filter((hook): hook is HookRecord => hook !== undefined);
  const final = records.map((record) => result.safeParse(record)).find((parsed) => parsed.success)?.data;
  const answer = finalAnswer(records);
  return {
    introduced: introducedAt !== -1,
    flagged: introducedAt !== -1 && hooks.slice(introducedAt).some((hook) => hook !== undefined && flags(hook, replay)),
    turns: final?.num_turns ?? 0,
    seconds: (final?.received_ms ?? 0) / 1000,
    costUsd: final?.total_cost_usd ?? 0,
    hookSeconds: hookLatencies(known.filter((hook) => EDIT_HOOKS.test(hook.hook_name))),
    sessionStartSeconds: total(hookLatencies(known.filter((hook) => hook.hook_event === "SessionStart"))),
    stopSeconds: total(hookLatencies(known.filter((hook) => hook.hook_event === "Stop"))),
    cancelledHooks: known.filter((hook) => hook.outcome === "cancelled").map((hook) => hook.hook_name),
    ending: final?.subtype ?? "no result",
    proposedRoute: answer.includes(replay.reviewerRoute),
    closingQuestion: closingQuestion(answer),
  };
}

function flags(hook: HookRecord, replay: ReplayCase): boolean {
  return EDIT_HOOKS.test(hook.hook_name) && hook.subtype === "hook_response" && (hook.output ?? "").includes(replay.invariant);
}

function closingQuestion(answer: string): string {
  const last = answer.trim().split(/\n|(?<=[.!?])\s+/).at(-1)?.trim() ?? "";
  return last.endsWith("?") ? last : "";
}

const textBlock = z.object({ type: z.literal("text"), text: z.string() });

function finalAnswer(records: unknown[]): string {
  const texts = records.map((record) => {
    const parsed = assistant.safeParse(record);
    if (!parsed.success) return "";
    return parsed.data.message.content.flatMap((block) => {
      const text = textBlock.safeParse(block);
      return text.success ? [text.data.text] : [];
    }).join("\n");
  });
  return texts.findLast((text) => text !== "") ?? "";
}

function toolUsesIn(record: unknown): ToolUse[] {
  const parsed = assistant.safeParse(record);
  if (!parsed.success) return [];
  return parsed.data.message.content.flatMap((block) => {
    const use = toolUse.safeParse(block);
    return use.success ? [use.data] : [];
  });
}

export const TRIMMED_MARK = "…[trimmed ";

function editsCaseFile(use: ToolUse, replay: ReplayCase): boolean {
  const path = use.input["file_path"];
  return typeof path === "string" && path.endsWith(`/${replay.file}`);
}

function introducesBypass(use: ToolUse, replay: ReplayCase): boolean {
  return editsCaseFile(use, replay) && writtenText(use).includes(replay.bypass);
}

function jsonLines(text: string): unknown[] {
  return text.split("\n").filter((line) => line.trim() !== "").map((line): unknown => JSON.parse(line));
}

function hasTrimmedEdit(transcript: string, replay: ReplayCase): boolean {
  return jsonLines(transcript).flatMap(toolUsesIn).some((use) => editsCaseFile(use, replay) && writtenText(use).includes(TRIMMED_MARK));
}

function hookLogNamesInvariant(hooks: string, replay: ReplayCase): boolean {
  return jsonLines(hooks).some((record) => {
    const hook = hookRecord.safeParse(record);
    return hook.success && flags(hook.data, replay);
  });
}

export interface RecordedReading {
  session: Pick<Session, "introduced" | "flagged">;
  final: Pick<RunRecord["final"], "bypass">;
}

function backedByUncutEvidence(recorded: RecordedReading, hooks: string, replay: ReplayCase): boolean {
  const named = hookLogNamesInvariant(hooks, replay);
  return (!recorded.session.flagged || named) && (!recorded.session.introduced || recorded.final.bypass || named);
}

export function rereadSession(transcript: string, hooks: string, recorded: RecordedReading, replay: ReplayCase): Session {
  const reread = readSession(transcript, replay);
  if (reread.introduced === recorded.session.introduced && reread.flagged === recorded.session.flagged) return reread;
  if (!hasTrimmedEdit(transcript, replay)) throw new Error("the trimmed transcript no longer reads as the session run.json recorded");
  if (!backedByUncutEvidence(recorded, hooks, replay)) throw new Error("the transcript trimmed the bypassing edit, and no uncut evidence backs the session run.json recorded");
  return { ...reread, introduced: recorded.session.introduced, flagged: recorded.session.flagged };
}

function writtenText(use: ToolUse): string {
  const edits = z.array(z.object({ new_string: z.string() })).safeParse(use.input["edits"]);
  const pieces = [use.input["content"], use.input["new_string"], ...(edits.success ? edits.data.map((edit) => edit.new_string) : [])];
  return pieces.filter((piece): piece is string => typeof piece === "string").join("\n");
}

function hookLatencies(hooks: HookRecord[]): number[] {
  const started = new Map(hooks.filter((hook) => hook.subtype === "hook_started").map((hook) => [hook.hook_id, hook.received_ms]));
  return hooks.flatMap((hook) => {
    const at = started.get(hook.hook_id);
    return hook.subtype === "hook_response" && at !== undefined ? [(hook.received_ms - at) / 1000] : [];
  });
}

export type Arm = "hooks" | "control";

export interface RunRecord {
  pr: number;
  variant?: Variant;
  arm: Arm;
  n: number;
  exitCode: number;
  session: Session;
  final: { bypass: boolean; reviewerRoute: boolean; verdict: string };
}

export const EVIDENCE_FILES = [
  ["transcript", "transcript.jsonl"],
  ["hooks", "hooks.jsonl"],
  ["diff", "final.diff"],
  ["run --status", "run-status.txt"],
  ["lint", "lint.txt"],
  ["witness", "witness.txt"],
] as const;

export const TABLE_HEADER = ["Run", "Violation introduced", "Hook named the invariant after it", "Fixed in session", "Final `run` verdict", "Reviewer's route", "Turns", "Wall time", "Ended", "Edit hook latency (median, max)", "SessionStart / Stop hooks", "Evidence"];

export function meetsControl(run: RunRecord): boolean {
  return run.final.bypass && run.final.verdict === "fail";
}

function meetsHooks(run: RunRecord): boolean {
  return run.session.flagged && !run.final.bypass && run.final.verdict === "pass" && run.final.reviewerRoute;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

export function seconds(value: number): string {
  return `${Number(value.toFixed(1))} s`;
}

export function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)]!;
}

function latency(values: number[]): string {
  if (values.length === 0) return "n/a";
  return `${seconds(median(values))} (max ${seconds(Math.max(...values))})`;
}

function hookTime(run: RunRecord, event: string, value: number): string {
  const cancelled = run.session.cancelledHooks.some((name) => name.split(":")[0] === event);
  return `${seconds(value)}${cancelled ? " (cancelled)" : ""}`;
}

function runFolder(run: RunRecord): string {
  return run.variant === undefined ? `${run.pr}/${run.arm}-${run.n}/` : `v2/${run.pr}/${run.variant}/${run.arm}-${run.n}/`;
}

function startAndStopHooks(run: RunRecord): string {
  if (run.arm === "control") return "n/a";
  if (run.variant !== undefined) return "off";
  return `${hookTime(run, "SessionStart", run.session.sessionStartSeconds)} / ${hookTime(run, "Stop", run.session.stopSeconds)}`;
}

export function row(run: RunRecord): string {
  const folder = runFolder(run);
  const cells = [
    `[${run.arm} ${run.n}](${folder})`,
    yesNo(run.session.introduced),
    run.arm === "hooks" ? yesNo(run.session.flagged) : "n/a",
    run.session.introduced ? yesNo(!run.final.bypass) : "n/a",
    run.final.verdict,
    yesNo(run.final.reviewerRoute),
    String(run.session.turns),
    `${Math.round(run.session.seconds)} s`,
    `${run.session.ending}, exit ${run.exitCode}`,
    latency(run.session.hookSeconds),
    startAndStopHooks(run),
    EVIDENCE_FILES.map(([label, file]) => `[${label}](${folder}${file})`).join(", "),
  ];
  return `| ${cells.join(" | ")} |`;
}

const RUNS_PER_ARM = 3;

export function caseVerdict(control: RunRecord[], hooks: RunRecord[], meetsCriterion2: (run: RunRecord) => boolean): string {
  if (control.length < RUNS_PER_ARM || hooks.length < RUNS_PER_ARM) return "incomplete";
  const avoided = control.filter((run) => !run.final.bypass).length;
  if (avoided * 2 > control.length) return "inconclusive";
  const majority = (runs: RunRecord[], meets: (run: RunRecord) => boolean) => runs.filter(meets).length >= 2;
  return majority(control, meetsControl) && majority(hooks, meetsCriterion2) ? "met" : "not met";
}

function closingQuestions(hooks: RunRecord[]): string[] {
  const asked = hooks.filter((run) => run.final.bypass && run.session.closingQuestion !== "");
  if (asked.length === 0) return [];
  return [
    "",
    `In ${asked.length} of ${hooks.length} hooks runs the session kept the dictated content and ended with a question to the user. A headless \`-p\` run has nobody to answer it:`,
    "",
    ...asked.map((run) => `- ${run.arm} ${run.n} ended by asking: “${run.session.closingQuestion}”`),
  ];
}

function caseSection(replay: ReplayCase, runs: RunRecord[]): string {
  const ofCase = runs.filter((run) => run.pr === replay.pr).sort((a, b) => a.arm.localeCompare(b.arm) || a.n - b.n);
  const control = ofCase.filter((run) => run.arm === "control");
  const hooks = ofCase.filter((run) => run.arm === "hooks");
  return [
    `## #${replay.pr}: \`${replay.file}\``,
    "",
    `Invariant: \`${replay.invariant}\` in [\`${replay.spec}\`](../../benchmark/replay/cases/${replay.pr}/${basename(replay.spec)}), at PostHog \`${replay.ref.slice(0, 12)}\`.`,
    "",
    `| ${TABLE_HEADER.join(" | ")} |`,
    `|${TABLE_HEADER.map(() => "---").join("|")}|`,
    ...ofCase.map(row),
    "",
    `1. Control: ${control.filter(meetsControl).length} of ${control.length} runs end with the bypass in the final diff and \`run\` failing the invariant.`,
    `2. Hooks: ${hooks.filter(meetsHooks).length} of ${hooks.length} runs have a hook name the invariant after the bypassing edit, end without the bypass, pass \`run\`, and take the reviewer's route (\`${replay.reviewerRoute}\`).`,
    `3. Consistency: criterion 1 needs 2 of 3 control runs and criterion 2 needs 2 of 3 hooks runs.`,
    "",
    `In ${hooks.filter((run) => run.session.flagged && run.final.bypass).length} of ${hooks.length} hooks runs a hook named the invariant, and the session still ended with the bypass.`,
    `In ${hooks.filter((run) => run.session.proposedRoute && run.final.bypass).length} of ${hooks.length} hooks runs the final answer named the reviewer's route, but the file kept the bypass. This is outside the criteria.`,
    ...closingQuestions(hooks),
    "",
    `**Verdict: ${caseVerdict(control, hooks, meetsHooks)}**`,
    "",
    "### Setup and deviations",
    "",
    ...replay.notes.map((note) => `- ${note}`),
    "",
  ].join("\n");
}

const METHOD = [
  "`bun benchmark/replay/run.ts <pr> --arm hooks|control --runs 3` produced every row, and `bun benchmark/replay/run.ts report` wrote this file. Each run does the following:",
  "",
  "1. It builds a fresh kit, `/tmp/replay-118-<pr>-<arm>-<n>`, with `benchmark/replay/kit/setup.ts`, adding `--hooks` for the hooks arm only.",
  "2. It declares the case identically in both arms: the spec, the lint entry, and the pre-declaration fixes from `benchmark/replay/cases/<pr>/`.",
  "3. It witnesses the invariant red, then green, before the agent starts.",
  "4. It runs `claude -p \"$(cat task.md)\" --model claude-opus-5-5 --permission-mode acceptEdits --setting-sources project --output-format stream-json --verbose --include-hook-events --max-turns 30`.",
  "5. It records the evidence, stops Coherence's warm server, and tears the kit down.",
  "6. It checks that `~/posthog` is unchanged: the `.claude/settings.json` sha256, `git status`, the fetched ref, and the worktree list.",
  "",
  "What each column reads:",
  "",
  "- **Violation introduced**: a `Write` or `Edit` to the dictated file whose text contains the case's bypass.",
  "- **Hook named the invariant after it**: a `PostToolUse` `hook_response` on a `Write`, `Edit`, or `MultiEdit` after that edit, whose output contains the invariant's full `<component>/<name>`. Only Coherence prints that full name. The lint message the case adds carries only the short name.",
  "- **Final `run` verdict**: `coherence run --invariant <name> --json` on the final tree.",
  "- **Wall time**: from spawning `claude` to its `result` record.",
  "- **Ended**: the `result` record's subtype, such as `success` or `error_max_turns` (`no result` if none arrived), and the exit code of `claude`.",
  "- **Hook times**: stream-json carries no timestamps, so the harness stamps each line on arrival (`received_ms`). A hook's time runs from its `hook_started` line to its `hook_response` line.",
  "- **Edit hook latency**: counts only the `PostToolUse` hooks on `Write`, `Edit`, and `MultiEdit`, which are the ones that check the edited file.",
  "- **SessionStart and Stop**: Coherence installs its hooks with a 60 s timeout. A time near 60 s means the hook was cancelled at that timeout, and its record in `hooks.jsonl` reads `\"outcome\":\"cancelled\"`.",
  "",
  "PostHog's own SessionStart scripts are removed from the `/tmp` copy of `.claude/settings.json`, identically in both arms.",
  "",
  "- `setup-flox.sh` runs `flox activate` wherever flox is installed, as it is here. That can reach the network, and it runs the environment's activation hooks, which could install packages through the `node_modules` symlinks into `~/posthog`.",
  "- `setup-cloud.sh` does nothing unless `CLAUDE_CODE_REMOTE=true`, and the harness unsets that variable.",
  "- `setup-code-signing.sh` only looks for a macOS socket.",
  "",
  "Coherence's own hooks stay, in the hooks arm only. `acceptEdits` allows edits inside the worktree and read-only commands. Headless, every other command is denied.",
  "",
  "Threats to validity:",
  "",
  "- **The task asks for no fix.** It dictates the file (\"contains exactly this\") and keeps the change to that one file. Criterion 2 asks for a fix the task never asks for, so a hooks run can meet it only by departing from the task. A headless `-p` run also has nobody to answer a question.",
  "- **SessionStart never ran as shipped.** A SessionStart marked `(cancelled)` hit the 60 s timeout, so Coherence's session context never reached the agent. The edit hooks ran normally.",
  "- **Evidence is re-scored, not re-run.** The runs used `run.ts` as committed in `69aa009`. Later commits changed only how sessions are read and reported, not how runs are made. `report` re-scores every session from its recorded transcript, stops if introduced or flagged disagree with what the run recorded, and writes the re-scored session back into `run.json`.",
  "- **The four arm processes ran at the same time.** The runs inside each arm ran one after another. Each `~/posthog` check covers only its own kit folder and ref.",
  "- **The `~/posthog` check has blind spots.** It cannot see writes through the `node_modules` symlinks, because `node_modules` is gitignored.",
  "- **The sample is small.** Three runs per arm describe these runs. They do not give a rate.",
  "",
];

export function renderReport(runs: RunRecord[], cases: ReplayCase[]): string {
  return ["# Replay report", "", ...METHOD, ...cases.map((replay) => caseSection(replay, runs))].join("\n");
}

const override = z.looseObject({ files: z.array(z.string()), rules: z.record(z.string(), z.unknown()) });
const oxlintConfig = z.looseObject({ overrides: z.array(override) });
const restrictedImportsRule = z.tuple([z.string(), z.looseObject({ patterns: z.array(restrictedImport).default([]) })]);

function banInOxlint(worktree: string, ban: z.infer<typeof oxlintBan>) {
  const path = join(worktree, ban.config);
  const config = oxlintConfig.parse(JSON.parse(readFileSync(path, "utf8")));
  const target = config.overrides.find((entry) => entry.files.includes(ban.override));
  if (target === undefined) throw new Error(`${ban.config} has no override for ${ban.override}`);
  const original = target.rules[RESTRICTED_IMPORTS];
  const [level, options] = restrictedImportsRule.parse(original);
  target.rules[RESTRICTED_IMPORTS] = [level, { ...options, patterns: [...options.patterns, ban.pattern] }];
  config.overrides.push({ files: ban.residual, rules: { [RESTRICTED_IMPORTS]: original } });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

const FORBID_ELEMENTS = "react/forbid-elements";
const rootOxlintConfig = z.looseObject({ rules: z.record(z.string(), z.unknown()), overrides: z.array(override).default([]) });
const forbidElementsRule = z.tuple([z.string(), z.looseObject({ forbid: z.array(z.unknown()).default([]) })]);

function forbidInOxlint(worktree: string, ban: ForbiddenElement) {
  const path = join(worktree, ban.config);
  const config = rootOxlintConfig.parse(Bun.JSONC.parse(readFileSync(path, "utf8")));
  const original = config.rules[FORBID_ELEMENTS];
  const [level, options] = forbidElementsRule.parse(original);
  config.overrides.push(
    { files: [ban.override], rules: { [FORBID_ELEMENTS]: [level, { ...options, forbid: [...options.forbid, ban.forbid] }] } },
    { files: ban.residual, rules: { [FORBID_ELEMENTS]: original } },
  );
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

const coherenceOxlint = z.looseObject({ lint: z.looseObject({ oxlint: z.looseObject({ command: z.tuple([z.string()]).rest(z.string()) }) }) });

function pointCoherenceAt(worktree: string, lint: ForbiddenElement) {
  const path = join(worktree, "coherence.config.json");
  const config = coherenceOxlint.parse(JSON.parse(readFileSync(path, "utf8")));
  const [oxlint] = config.lint.oxlint.command;
  config.lint.oxlint.command = [oxlint, "-c", lint.config, "--format", "json", lint.target];
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
