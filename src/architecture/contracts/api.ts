import { z } from "zod";
import { ConformanceResultSchema } from "./conformance.ts";
import { ArchitecturePlanSchema, CommentSchema, PlanOperationSchema, PlanSummarySchema, RevisionSchema } from "./plan.ts";

export const PlanListResponseSchema = z.array(PlanSummarySchema);

export const CreatePlanRequestSchema = ArchitecturePlanSchema.pick({ title: true, goal: true });

export const PlanDetailResponseSchema = z.object({
  plan: ArchitecturePlanSchema,
  conformance: ConformanceResultSchema.nullable(),
});

export const ApplyOperationsRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  operations: z.array(PlanOperationSchema).min(1).max(50),
  note: RevisionSchema.shape.note,
});

export const ApplyOperationsResponseSchema = z.object({ plan: ArchitecturePlanSchema, warnings: z.array(z.string()) });

export const SetLockRequestSchema = z.object({ locked: z.boolean(), expectedRevision: z.number().int().positive() });

export const SetLockResponseSchema = z.object({ plan: ArchitecturePlanSchema });

export const CheckPlanRequestSchema = z.object({ final: z.boolean().optional() });

export const ErrorResponseSchema = z.object({ error: z.string(), plan: ArchitecturePlanSchema.optional() });

export const PlanContextSchema = z.object({
  pendingHumanComments: z.array(CommentSchema),
  humanChanges: z.array(RevisionSchema),
  explorerUrl: z.string(),
});

export type PlanListResponse = z.infer<typeof PlanListResponseSchema>;
export type CreatePlanRequest = z.infer<typeof CreatePlanRequestSchema>;
export type PlanDetailResponse = z.infer<typeof PlanDetailResponseSchema>;
export type ApplyOperationsRequest = z.infer<typeof ApplyOperationsRequestSchema>;
export type ApplyOperationsResponse = z.infer<typeof ApplyOperationsResponseSchema>;
export type SetLockRequest = z.infer<typeof SetLockRequestSchema>;
export type SetLockResponse = z.infer<typeof SetLockResponseSchema>;
export type CheckPlanRequest = z.infer<typeof CheckPlanRequestSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type PlanContext = z.infer<typeof PlanContextSchema>;
