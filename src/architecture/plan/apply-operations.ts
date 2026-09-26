import type { Actor, ArchitecturePlan, PlanOperation } from "../contracts/index.ts";
import type { ArchitectureModel } from "../model/index.ts";
import * as feedback from "./feedback.ts";
import { closestModules } from "./suggestions.ts";

export type OperationContext = { base: ArchitectureModel; actor: Actor; at: string; revision: number };

export type BatchResult = { plan: ArchitecturePlan; errors: { index: number; operation: PlanOperation; error: string }[]; warnings: string[] };

type Operation<Op extends PlanOperation["op"]> = Extract<PlanOperation, { op: Op }>;
type Problems = { errors: string[]; warnings: string[] };

const commentOperations = new Set<PlanOperation["op"]>(["add_comment", "resolve_comment"]);

export function changesContent(operation: PlanOperation): boolean {
  return !commentOperations.has(operation.op);
}

export function isSetBaseCommit(operation: PlanOperation): operation is Operation<"set_base_commit"> {
  return operation.op === "set_base_commit";
}

export function applyOperations(plan: ArchitecturePlan, operations: PlanOperation[], context: OperationContext): BatchResult {
  const working = structuredClone(plan);
  const errors: BatchResult["errors"] = [];
  const warnings = new Set<string>();
  operations.forEach((operation, index) => {
    const problems = applyOperation(working, operation, context);
    problems.errors.forEach((error) => errors.push({ index, operation, error }));
    problems.warnings.forEach((warning) => warnings.add(warning));
  });
  return { plan: working, errors, warnings: [...warnings] };
}

function applyOperation(plan: ArchitecturePlan, operation: PlanOperation, context: OperationContext): Problems {
  switch (operation.op) {
    case "set_summary":
      return setSummary(plan, operation);
    case "set_base_commit":
      plan.baseCommit = operation.commit;
      return accepted();
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

function setSummary(plan: ArchitecturePlan, { title, goal }: Operation<"set_summary">): Problems {
  plan.title = title ?? plan.title;
  plan.goal = goal ?? plan.goal;
  return accepted();
}

function upsertModule(plan: ArchitecturePlan, { path, action, responsibility }: Operation<"upsert_module">, context: OperationContext): Problems {
  const error = moduleActionError(path, action, context.base);
  if (error) return rejected([error]);
  const existing = plan.modules.find((module) => module.path === path);
  plan.modules = [...plan.modules.filter((module) => module !== existing), { path, action, responsibility, origin: existing?.origin ?? context.actor }];
  return accepted();
}

function moduleActionError(path: string, action: Operation<"upsert_module">["action"], base: ArchitectureModel): string | undefined {
  const existsAtBase = base.module(path) !== undefined;
  if (action === "create") return existsAtBase ? feedback.moduleAlreadyExists(path, base7Of(base)) : undefined;
  return existsAtBase ? undefined : unknownModuleError(path, base);
}

function dropModule(plan: ArchitecturePlan, { path }: Operation<"drop_module">): Problems {
  if (!plan.modules.some((module) => module.path === path)) return rejected([feedback.missingModule(path, plan)]);
  plan.modules = plan.modules.filter((module) => module.path !== path);
  return accepted();
}

function upsertSeam(plan: ArchitecturePlan, operation: Operation<"upsert_seam">, context: OperationContext): Problems {
  const { from, to, action, interface: seamInterface, rationale } = operation;
  const problems = seamProblems(plan, operation, context.base);
  if (problems.errors.length > 0) return problems;
  const existing = plan.seams.find((seam) => seam.from === from && seam.to === to);
  plan.seams = [...plan.seams.filter((seam) => seam !== existing), { from, to, action, interface: seamInterface, rationale, origin: existing?.origin ?? context.actor }];
  return problems;
}

function seamProblems(plan: ArchitecturePlan, { from, to, action, interface: seamInterface }: Operation<"upsert_seam">, base: ArchitectureModel): Problems {
  const endpointErrors = [...new Set([from, to])].flatMap((endpoint) => (isKnownEndpoint(plan, endpoint, base) ? [] : [unknownModuleError(endpoint, base)]));
  const files = seamInterface?.files ?? [];
  return {
    errors: [...endpointErrors, ...containmentErrors(from, to), ...files.filter((file) => !isWithin(file, to)).map((file) => feedback.interfaceFileOutside(file, to))],
    warnings: [
      ...files.filter((file) => isWithin(file, to) && !base.hasFile(file)).map((file) => feedback.interfaceFileMissing(file, base7Of(base))),
      ...(action !== "add" && base.evidence(from, to, { limit: 1 }).length === 0 ? [feedback.seamWithoutDependency(from, to, base7Of(base), action)] : []),
    ],
  };
}

function isKnownEndpoint(plan: ArchitecturePlan, path: string, base: ArchitectureModel): boolean {
  return base.module(path) !== undefined || plan.modules.some((module) => module.action === "create" && (module.path === path || isWithin(path, module.path)));
}

function containmentErrors(from: string, to: string): string[] {
  if (from === to || isWithin(to, from)) return [feedback.seamWithinItself(from, to)];
  if (isWithin(from, to)) return [feedback.seamWithinItself(to, from)];
  return [];
}

function dropSeam(plan: ArchitecturePlan, { from, to }: Operation<"drop_seam">): Problems {
  if (!plan.seams.some((seam) => seam.from === from && seam.to === to)) return rejected([feedback.missingSeam(from, to, plan)]);
  plan.seams = plan.seams.filter((seam) => seam.from !== from || seam.to !== to);
  return accepted();
}

function addComment(plan: ArchitecturePlan, { target, body }: Operation<"add_comment">, context: OperationContext): Problems {
  plan.comments = [...plan.comments, { id: `c${plan.comments.length + 1}`, target, author: context.actor, body, at: context.at, revision: context.revision }];
  return accepted();
}

function resolveComment(plan: ArchitecturePlan, { commentId, reply }: Operation<"resolve_comment">, context: OperationContext): Problems {
  const comment = plan.comments.find(({ id }) => id === commentId);
  if (!comment) return rejected([feedback.missingComment(commentId, plan)]);
  if (comment.resolution) return rejected([feedback.commentAlreadyResolved(commentId, plan)]);
  comment.resolution = { by: context.actor, reply, at: context.at, revision: context.revision };
  return accepted();
}

function unknownModuleError(path: string, base: ArchitectureModel): string {
  return feedback.unknownModule(path, base7Of(base), closestModules(base, path));
}

function base7Of(base: ArchitectureModel): string {
  return feedback.shortCommit(base.payload.commit ?? "");
}

function isWithin(path: string, module: string): boolean {
  return module === "." || path.startsWith(`${module}/`);
}

function accepted(): Problems {
  return { errors: [], warnings: [] };
}

function rejected(errors: string[]): Problems {
  return { errors, warnings: [] };
}
