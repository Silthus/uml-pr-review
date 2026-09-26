import { z } from "zod";
import { PlannedModuleSchema, SeamSchema } from "./plan.ts";

export const FindingRuleSchema = z.enum([
  "unplanned-module", "unplanned-dependency", "bypasses-seam", "off-interface", "against-removed-seam",
  "seam-not-removed", "missing-seam", "missing-module", "module-not-removed", "unresolved-import",
]);

export const FindingSchema = z.object({
  id: z.string(),
  rule: FindingRuleSchema,
  severity: z.enum(["violation", "pending", "warning"]),
  file: z.string(),
  line: z.number().int().positive(),
  subject: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("module"), path: z.string() }),
    z.object({ kind: z.literal("seam"), from: z.string(), to: z.string() }),
  ]),
  target: z.string().optional(),
  test: z.boolean(),
  message: z.string(),
  fix: z.string(),
});

const ElementStatusSchema = z.enum(["conforming", "pending", "violating"]);

export const ConformanceReportSchema = z.object({
  verdict: ElementStatusSchema,
  modules: z.array(z.object({ path: z.string(), action: PlannedModuleSchema.shape.action, status: ElementStatusSchema })),
  seams: z.array(z.object({ from: z.string(), to: z.string(), action: SeamSchema.shape.action, status: ElementStatusSchema, imports: z.number().int() })),
  findings: z.array(FindingSchema),
  counts: z.object({ violations: z.number().int(), pending: z.number().int(), warnings: z.number().int() }),
});

export const ConformanceResultSchema = ConformanceReportSchema.extend({
  planId: z.string(),
  planRevision: z.number().int(),
  planStatus: z.enum(["draft", "locked"]),
  phase: z.enum(["progress", "final"]),
  worktree: z.string(),
  baseCommit: z.string(),
  snapshotTree: z.string(),
  checkedAt: z.iso.datetime(),
});

export type FindingRule = z.infer<typeof FindingRuleSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type FindingSeverity = Finding["severity"];
export type ElementStatus = z.infer<typeof ElementStatusSchema>;
export type ConformancePhase = ConformanceResult["phase"];
export type ConformanceReport = z.infer<typeof ConformanceReportSchema>;
export type ConformanceResult = z.infer<typeof ConformanceResultSchema>;
