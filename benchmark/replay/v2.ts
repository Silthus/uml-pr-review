import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { caseVerdict, latency, median, meetsControl, row, TABLE_HEADER, type ReplayCase, type RunRecord } from "./replay.ts";

export const VARIANTS = ["draft", "intent"] as const;
export type Variant = (typeof VARIANTS)[number];

export function isVariant(value: string): value is Variant {
  return (VARIANTS as readonly string[]).includes(value);
}

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

function variantSection(replay: ReplayCase, variant: Variant, runs: RunRecord[]): string[] {
  const ofVariant = runs.filter((run) => run.pr === replay.pr && run.variant === variant).sort((a, b) => a.arm.localeCompare(b.arm) || a.n - b.n);
  const control = ofVariant.filter((run) => run.arm === "control");
  const hooks = ofVariant.filter((run) => run.arm === "hooks");
  return [
    `### ${variant}`,
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
    `**Verdict (${variant}): ${caseVerdict(control, hooks, meetsHooks)}**`,
    "",
  ];
}

export function renderV2(runs: RunRecord[], cases: ReplayCase[]): string {
  return cases.flatMap((replay) => VARIANTS.flatMap((variant) => variantSection(replay, variant, runs))).join("\n");
}
