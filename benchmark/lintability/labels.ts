import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readJsonFiles } from "../../coherence/validation/corrections.ts";

export const declarableKinds = ["import-boundary", "public-entry", "banned-api", "paved-path", "file-placement", "vocabulary"] as const;
export const judgmentKinds = ["reuse-unnamed", "duplication", "logic-placement", "decomposition", "concept-naming", "design-other"] as const;
export const ruleKinds = [...declarableKinds, ...judgmentKinds, "none"] as const;
export const tiers = ["lintable-now", "lintable-with-a-custom-rule", "not-lintable"] as const;
export const tools = ["oxlint", "eslint", "tach", "import-linter", "ruff", "semgrep", "clippy", "coherence", "review-only"] as const;
export const catchables = ["yes", "partial", "no"] as const;
export const guardNames = ["general", "existed", "syntactic", "firesAndClears"] as const;

export type RuleKind = (typeof ruleKinds)[number];
export type Tool = (typeof tools)[number];
export type Catchable = (typeof catchables)[number];
export type GuardName = (typeof guardNames)[number];

const outcome = z.enum(["pass", "fail", "n/a"]);

const labelFieldsSchema = z.object({
  id: z.string(),
  catchable: z.enum(catchables),
  ruleKind: z.enum(ruleKinds),
  tier: z.enum(tiers),
  tool: z.enum(tools),
  ruleSketch: z.string().max(200),
  guards: z.object({ general: outcome, existed: outcome, syntactic: outcome, firesAndClears: outcome }),
  note: z.string().max(200),
});

export const lintabilityLabelSchema = labelFieldsSchema.superRefine((label, context) => {
  for (const problem of inconsistencies(label)) context.addIssue({ code: "custom", message: `${label.id}: ${problem}` });
});

export type LintabilityLabel = z.infer<typeof lintabilityLabelSchema>;

export const ruleGroupSchema = z.object({ id: z.string(), rule: z.string().min(1).max(120) });
export type RuleGroup = z.infer<typeof ruleGroupSchema>;

function inconsistencies(label: z.infer<typeof labelFieldsSchema>): string[] {
  const failed = failedGuards(label);
  const caught = label.catchable !== "no";
  const declarable = (declarableKinds as readonly string[]).includes(label.ruleKind);
  return [
    caught && failed.length > 0 ? `catchable "${label.catchable}" but guards failed: ${failed.join(", ")}` : null,
    caught && !declarable ? `catchable "${label.catchable}" needs a declarable kind, not ${label.ruleKind}` : null,
    caught && (label.tool === "review-only" || label.tier === "not-lintable") ? `catchable "${label.catchable}" needs a linting tool and tier` : null,
    !caught && (label.tool !== "review-only" || label.tier !== "not-lintable") ? `catchable "no" must be review-only and not-lintable` : null,
    !caught && declarable && failed.length === 0 ? "catchable \"no\" with a declarable kind must name the guard that failed" : null,
  ].filter((problem) => problem !== null);
}

export function failedGuards(label: Pick<LintabilityLabel, "guards">): GuardName[] {
  return guardNames.filter((name) => label.guards[name] === "fail");
}

export async function readStage<T extends { id: string }>(directory: string, schema: z.ZodType<T>): Promise<Map<string, T>> {
  await mkdir(directory, { recursive: true });
  const labels = new Map<string, T>();
  for (const label of await readJsonFiles(directory, schema)) labels.set(label.id, label);
  return labels;
}

export function stageDirectory(work: string, stage: string): string {
  return join(work, "labels", stage);
}
