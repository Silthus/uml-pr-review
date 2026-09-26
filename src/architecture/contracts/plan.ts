import { z } from "zod";

const ModulePathSchema = z.string().regex(/^(\.|[^/](.*[^/])?)$/);
const CommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
const TimestampSchema = z.iso.datetime();
export const ActorSchema = z.enum(["agent", "human"]);

export const InterfaceSchema = z.object({
  files: z.array(z.string()).min(1).max(20),
  symbols: z.array(z.string()).max(50).default([]),
});

export const PlannedModuleSchema = z.object({
  path: ModulePathSchema,
  action: z.enum(["create", "modify", "remove"]),
  responsibility: z.string().min(1).max(280),
  origin: ActorSchema,
});

export const SeamSchema = z.object({
  from: ModulePathSchema,
  to: ModulePathSchema,
  action: z.enum(["add", "remove", "keep"]),
  interface: InterfaceSchema.optional(),
  rationale: z.string().max(280).optional(),
  origin: ActorSchema,
});

export const CommentTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan") }),
  z.object({ kind: z.literal("module"), path: ModulePathSchema }),
  z.object({ kind: z.literal("seam"), from: ModulePathSchema, to: ModulePathSchema }),
]);

export const CommentSchema = z.object({
  id: z.string().regex(/^c\d+$/),
  target: CommentTargetSchema,
  author: ActorSchema,
  body: z.string().min(1).max(2000),
  at: TimestampSchema,
  revision: z.number().int().positive(),
  resolution: z.object({ by: ActorSchema, reply: z.string().max(2000).optional(), at: TimestampSchema, revision: z.number().int().positive() }).optional(),
});

export const PlanOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_summary"), title: z.string().min(1).max(120).optional(), goal: z.string().min(1).max(2000).optional() }),
  z.object({ op: z.literal("set_base_commit"), commit: CommitSchema }),
  z.object({ op: z.literal("upsert_module"), path: ModulePathSchema, action: PlannedModuleSchema.shape.action, responsibility: PlannedModuleSchema.shape.responsibility }),
  z.object({ op: z.literal("drop_module"), path: ModulePathSchema }),
  z.object({ op: z.literal("upsert_seam"), from: ModulePathSchema, to: ModulePathSchema, action: SeamSchema.shape.action, interface: InterfaceSchema.optional(), rationale: z.string().max(280).optional() }),
  z.object({ op: z.literal("drop_seam"), from: ModulePathSchema, to: ModulePathSchema }),
  z.object({ op: z.literal("add_comment"), target: CommentTargetSchema, body: CommentSchema.shape.body }),
  z.object({ op: z.literal("resolve_comment"), commentId: CommentSchema.shape.id, reply: z.string().max(2000).optional() }),
]);

export const RevisionSchema = z.object({
  number: z.number().int().positive(),
  at: TimestampSchema,
  actor: ActorSchema,
  client: z.string().optional(),
  kind: z.enum(["create", "edit", "lock", "unlock"]),
  note: z.string().max(2000).optional(),
  operations: z.array(PlanOperationSchema),
});

export const ArchitecturePlanSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(64),
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(2000),
  baseCommit: CommitSchema,
  status: z.enum(["draft", "locked"]),
  revision: z.number().int().positive(),
  modules: z.array(PlannedModuleSchema),
  seams: z.array(SeamSchema),
  comments: z.array(CommentSchema),
  revisions: z.array(RevisionSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const PlanSummarySchema = ArchitecturePlanSchema.pick({ id: true, title: true, status: true, revision: true, baseCommit: true, updatedAt: true }).extend({ pendingHumanComments: z.number().int() });

export const PlanViewSchema = ArchitecturePlanSchema.omit({ revisions: true });

export type Actor = z.infer<typeof ActorSchema>;
export type Interface = z.infer<typeof InterfaceSchema>;
export type PlannedModule = z.infer<typeof PlannedModuleSchema>;
export type Seam = z.infer<typeof SeamSchema>;
export type CommentTarget = z.infer<typeof CommentTargetSchema>;
export type PlanComment = z.infer<typeof CommentSchema>;
export type PlanOperation = z.infer<typeof PlanOperationSchema>;
export type Revision = z.infer<typeof RevisionSchema>;
export type ArchitecturePlan = z.infer<typeof ArchitecturePlanSchema>;
export type PlanSummary = z.infer<typeof PlanSummarySchema>;
export type PlanView = z.infer<typeof PlanViewSchema>;
