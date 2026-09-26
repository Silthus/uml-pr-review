import { z } from "zod";
import { ArchitecturePayloadSchema } from "./architecture.ts";
import { ConformanceResultSchema } from "./conformance.ts";
import { ArchitecturePlanSchema, RevisionSchema } from "./plan.ts";

const EventBaseSchema = z.object({ seq: z.number().int(), at: z.iso.datetime(), repositoryId: z.string() });
const SelectionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("module"), path: z.string() }),
  z.object({ kind: z.literal("seam"), from: z.string(), to: z.string() }),
]);

export const ArchitectureEventSchema = z.discriminatedUnion("type", [
  EventBaseSchema.extend({ type: z.literal("agent_activity"), id: z.string(), client: z.string(), tool: z.string(), status: z.enum(["ok", "error"]), summary: z.string(), planId: z.string().optional(), durationMs: z.number().int() }),
  EventBaseSchema.extend({ type: z.literal("plan_patch"), planId: z.string(), revision: RevisionSchema, plan: ArchitecturePlanSchema }),
  EventBaseSchema.extend({ type: z.literal("conformance_result"), planId: z.string(), result: ConformanceResultSchema }),
  EventBaseSchema.extend({ type: z.literal("selection_hint"), client: z.string(), tool: z.string(), target: SelectionTargetSchema, planId: z.string().optional() }),
  EventBaseSchema.extend({ type: z.literal("index_ready"), root: z.string(), commit: z.string().nullable(), tree: z.string(), stats: ArchitecturePayloadSchema.shape.stats }),
]);

export type ArchitectureEvent = z.infer<typeof ArchitectureEventSchema>;
export type ArchitectureEventType = ArchitectureEvent["type"];
export type SelectionTarget = z.infer<typeof SelectionTargetSchema>;
