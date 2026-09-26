import type { Actor, ArchitecturePlan, PlannedModule, PlanOperation } from "../contracts/index.ts";
import * as feedback from "./feedback.ts";
import { seamLabel } from "./paths.ts";

export type OperationContext = { actor: Actor; at: string; revision: number };

export type Problem = { index: number; line: string };

export type AppliedBatch = { plan: ArchitecturePlan; errors: Problem[]; upsertedBy: Map<string, number>; droppedModules: PlannedModule[] };

type Operation<Op extends PlanOperation["op"]> = Extract<PlanOperation, { op: Op }>;

const commentOperations = new Set<PlanOperation["op"]>(["add_comment", "resolve_comment"]);

export function changesContent(operation: PlanOperation): boolean {
  return !commentOperations.has(operation.op);
}

export function isSetBaseCommit(operation: PlanOperation): operation is Operation<"set_base_commit"> {
  return operation.op === "set_base_commit";
}

export function moduleKey(path: string): string {
  return `module ${path}`;
}

export function seamKey(seam: { from: string; to: string }): string {
  return `seam ${seamLabel(seam)}`;
}

export function applyOperations(plan: ArchitecturePlan, operations: PlanOperation[], context: OperationContext): AppliedBatch {
  const working = structuredClone(plan);
  const errors: Problem[] = [];
  const upsertedBy = new Map<string, number>();
  const droppedModules = new Array<PlannedModule>();
  operations.forEach((operation, index) => {
    if (operation.op === "drop_module") droppedModules.push(...working.modules.filter((module) => module.path === operation.path));
    const error = applyOperation(working, operation, context);
    if (error) errors.push({ index, line: feedback.operationProblem(index, operation.op, error) });
    if (operation.op === "upsert_module") upsertedBy.set(moduleKey(operation.path), index);
    if (operation.op === "upsert_seam") upsertedBy.set(seamKey(operation), index);
  });
  return { plan: working, errors, upsertedBy, droppedModules };
}

function applyOperation(plan: ArchitecturePlan, operation: PlanOperation, context: OperationContext): string | undefined {
  switch (operation.op) {
    case "set_summary":
      return setSummary(plan, operation);
    case "set_base_commit":
      plan.baseCommit = operation.commit;
      return undefined;
    case "upsert_module":
      return upsertModule(plan, operation, context);
    case "drop_module":
      return dropModule(plan, operation);
    case "upsert_seam":
      return upsertSeam(plan, operation, context);
    case "drop_seam":
      return dropSeam(plan, operation);
    case "add_comment":
      return addComment(plan, operation, context);
    case "resolve_comment":
      return resolveComment(plan, operation, context);
  }
}

function setSummary(plan: ArchitecturePlan, { title, goal }: Operation<"set_summary">): undefined {
  plan.title = title ?? plan.title;
  plan.goal = goal ?? plan.goal;
}

function upsertModule(plan: ArchitecturePlan, { path, action, responsibility }: Operation<"upsert_module">, context: OperationContext): undefined {
  const existing = plan.modules.find((module) => module.path === path);
  plan.modules = [...plan.modules.filter((module) => module !== existing), { path, action, responsibility, origin: existing?.origin ?? context.actor }];
}

function dropModule(plan: ArchitecturePlan, { path }: Operation<"drop_module">): string | undefined {
  if (!plan.modules.some((module) => module.path === path)) return feedback.missingModule(path, plan);
  plan.modules = plan.modules.filter((module) => module.path !== path);
}

function upsertSeam(plan: ArchitecturePlan, { from, to, action, interface: seamInterface, rationale }: Operation<"upsert_seam">, context: OperationContext): undefined {
  const existing = plan.seams.find((seam) => seam.from === from && seam.to === to);
  plan.seams = [...plan.seams.filter((seam) => seam !== existing), { from, to, action, interface: seamInterface, rationale, origin: existing?.origin ?? context.actor }];
}

function dropSeam(plan: ArchitecturePlan, { from, to }: Operation<"drop_seam">): string | undefined {
  if (!plan.seams.some((seam) => seam.from === from && seam.to === to)) return feedback.missingSeam(from, to, plan);
  plan.seams = plan.seams.filter((seam) => seam.from !== from || seam.to !== to);
}

function addComment(plan: ArchitecturePlan, { target, body }: Operation<"add_comment">, context: OperationContext): undefined {
  plan.comments = [...plan.comments, { id: `c${plan.comments.length + 1}`, target, author: context.actor, body, at: context.at, revision: context.revision }];
}

function resolveComment(plan: ArchitecturePlan, { commentId, reply }: Operation<"resolve_comment">, context: OperationContext): string | undefined {
  const comment = plan.comments.find(({ id }) => id === commentId);
  if (!comment) return feedback.missingComment(commentId, plan);
  if (comment.resolution) return feedback.commentAlreadyResolved(commentId, plan);
  comment.resolution = { by: context.actor, reply, at: context.at, revision: context.revision };
}
