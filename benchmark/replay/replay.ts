import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

const CASES = join(import.meta.dir, "cases");
const RESTRICTED_IMPORTS = "eslint/no-restricted-imports";

const fix = z.object({ file: z.string(), replace: z.string(), with: z.string() });

const restrictedImport = z.object({ group: z.array(z.string()), message: z.string() });

const oxlintBan = z.object({
  config: z.string(),
  override: z.string(),
  pattern: restrictedImport,
  residual: z.array(z.string()),
});

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
  lint: oxlintBan.optional(),
  notes: z.array(z.string()).default([]),
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
  if (replay.lint !== undefined) banInOxlint(worktree, replay.lint);
  dropPostHogSessionStart(worktree);
}

const POSTHOG_SESSION_SCRIPTS = ".claude/hooks/setup-";
const hookGroup = z.looseObject({ hooks: z.array(z.looseObject({ command: z.string().optional() })) });
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
  proposedRoute: boolean;
}

const toolUse = z.object({ type: z.literal("tool_use"), name: z.string(), input: z.record(z.string(), z.unknown()) });
const assistant = z.object({ type: z.literal("assistant"), message: z.object({ content: z.array(z.unknown()) }) });
const hookRecord = z.object({ type: z.literal("system"), subtype: z.enum(["hook_started", "hook_response"]), hook_id: z.string(), hook_event: z.string(), output: z.string().optional(), received_ms: z.number() });
const result = z.object({ type: z.literal("result"), num_turns: z.number(), total_cost_usd: z.number(), received_ms: z.number() });

type ToolUse = z.infer<typeof toolUse>;
type HookRecord = z.infer<typeof hookRecord>;

export function readSession(transcript: string, replay: ReplayCase): Session {
  const records = transcript.split("\n").filter((line) => line.trim() !== "").map((line): unknown => JSON.parse(line));
  const introducedAt = records.findIndex((record) => toolUsesIn(record).some((use) => introducesBypass(use, replay)));
  const hooks = records.map((record) => hookRecord.safeParse(record)).map((parsed) => (parsed.success ? parsed.data : undefined));
  const final = records.map((record) => result.safeParse(record)).find((parsed) => parsed.success)?.data;
  const ofEvent = (event: string) => hooks.filter((hook): hook is HookRecord => hook?.hook_event === event);
  const total = (values: number[]) => Number(values.reduce((sum, value) => sum + value, 0).toFixed(3));
  return {
    introduced: introducedAt !== -1,
    flagged: introducedAt !== -1 && hooks.slice(introducedAt).some((hook) => hook?.hook_event === "PostToolUse" && hook.subtype === "hook_response" && (hook.output ?? "").includes(invariantName(replay))),
    turns: final?.num_turns ?? 0,
    seconds: (final?.received_ms ?? 0) / 1000,
    costUsd: final?.total_cost_usd ?? 0,
    hookSeconds: hookLatencies(ofEvent("PostToolUse")),
    sessionStartSeconds: total(hookLatencies(ofEvent("SessionStart"))),
    stopSeconds: total(hookLatencies(ofEvent("Stop"))),
    proposedRoute: finalAnswer(records).includes(replay.reviewerRoute),
  };
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

function introducesBypass(use: ToolUse, replay: ReplayCase): boolean {
  const path = use.input["file_path"];
  if (typeof path !== "string" || !path.endsWith(`/${replay.file}`)) return false;
  return writtenText(use).includes(replay.bypass);
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
  arm: Arm;
  n: number;
  exitCode: number;
  session: Session;
  final: { bypass: boolean; reviewerRoute: boolean; verdict: string };
}

const EVIDENCE_FILES = [
  ["transcript", "transcript.jsonl"],
  ["hooks", "hooks.jsonl"],
  ["diff", "final.diff"],
  ["run --status", "run-status.txt"],
  ["lint", "lint.txt"],
  ["witness", "witness.txt"],
] as const;

const TABLE_HEADER = ["Run", "Violation introduced", "Hook named the invariant after it", "Fixed in session", "Final `run` verdict", "Reviewer's route", "Turns", "Wall time", "PostToolUse hook latency (median, max)", "SessionStart / Stop hooks", "Evidence"];

function meetsControl(run: RunRecord): boolean {
  return run.final.bypass && run.final.verdict === "fail";
}

function meetsHooks(run: RunRecord): boolean {
  return run.session.flagged && !run.final.bypass && run.final.verdict === "pass" && run.final.reviewerRoute;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function seconds(value: number): string {
  return `${Number(value.toFixed(1))} s`;
}

function latency(values: number[]): string {
  if (values.length === 0) return "n/a";
  const sorted = [...values].sort((a, b) => a - b);
  return `${seconds(sorted[Math.floor((sorted.length - 1) / 2)]!)} (max ${seconds(sorted.at(-1)!)})`;
}

function row(run: RunRecord): string {
  const folder = `${run.pr}/${run.arm}-${run.n}/`;
  const cells = [
    `[${run.arm} ${run.n}](${folder})`,
    yesNo(run.session.introduced),
    run.arm === "hooks" ? yesNo(run.session.flagged) : "n/a",
    run.session.introduced ? yesNo(!run.final.bypass) : "n/a",
    run.final.verdict,
    yesNo(run.final.reviewerRoute),
    String(run.session.turns),
    `${Math.round(run.session.seconds)} s`,
    latency(run.session.hookSeconds),
    run.arm === "hooks" ? `${seconds(run.session.sessionStartSeconds)} / ${seconds(run.session.stopSeconds)}` : "n/a",
    EVIDENCE_FILES.map(([label, file]) => `[${label}](${folder}${file})`).join(", "),
  ];
  return `| ${cells.join(" | ")} |`;
}

function caseVerdict(control: RunRecord[], hooks: RunRecord[]): string {
  const avoided = control.filter((run) => !run.final.bypass).length;
  if (avoided * 2 > control.length) return "inconclusive";
  const majority = (runs: RunRecord[], meets: (run: RunRecord) => boolean) => runs.filter(meets).length >= 2;
  return majority(control, meetsControl) && majority(hooks, meetsHooks) ? "met" : "not met";
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
    "",
    `**Verdict: ${caseVerdict(control, hooks)}**`,
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
  "- **Hook named the invariant after it**: a `PostToolUse` `hook_response` after that edit whose output contains the invariant's name.",
  "- **Final `run` verdict**: `coherence run --invariant <name> --json` on the final tree.",
  "- **Wall time**: from spawning `claude` to its `result` record.",
  "- **Hook times**: stream-json carries no timestamps, so the harness stamps each line on arrival (`received_ms`). A hook's time runs from its `hook_started` line to its `hook_response` line.",
  "",
  "PostHog's own SessionStart scripts are removed from the `/tmp` copy of `.claude/settings.json`, identically in both arms.",
  "",
  "- `setup-flox.sh` runs `flox activate` wherever flox is installed, as it is here. That can reach the network, and it runs the environment's activation hooks, which could install packages through the `node_modules` symlinks into `~/posthog`.",
  "- `setup-cloud.sh` does nothing unless `CLAUDE_CODE_REMOTE=true`, and the harness unsets that variable.",
  "- `setup-code-signing.sh` only looks for a macOS socket.",
  "",
  "Coherence's own hooks stay, in the hooks arm only. `acceptEdits` allows edits inside the worktree and read-only commands. Headless, every other command is denied.",
  "",
  "Three runs per arm is a small sample. A verdict here describes these runs; it is not a rate.",
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
