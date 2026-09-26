import type { ArchitecturePlan, PlannedModule, Seam } from "../contracts/index.ts";
import type { ArchitectureModel } from "../model/index.ts";
import { moduleKey, seamKey, type AppliedBatch, type Problem } from "./apply-operations.ts";
import * as feedback from "./feedback.ts";
import { isWithin, seamLabel, shortCommit } from "./paths.ts";
import { closestModules } from "./suggestions.ts";

export type PlanCheck = { errors: Problem[]; warnings: string[] };

type Batch = AppliedBatch & { previous: ArchitecturePlan; base: ArchitectureModel };
type PlanElement = { key: string; label: string; upsert: "upsert_module" | "upsert_seam" };

const unattributed = Number.POSITIVE_INFINITY;

export function validatePlan(batch: Batch): PlanCheck {
  const { plan, previous, upsertedBy } = batch;
  const baseChanged = plan.baseCommit !== previous.baseCommit;
  const warnedSeams = plan.seams.filter((seam) => baseChanged || upsertedBy.has(seamKey(seam)));
  return {
    errors: [
      ...plan.modules.flatMap((module) => attributed(batch, moduleElement(module), moduleErrors(module, batch))),
      ...plan.seams.flatMap((seam) => attributed(batch, seamElement(seam), seamErrors(seam, batch))),
    ],
    warnings: [...new Set(warnedSeams.flatMap((seam) => seamWarnings(seam, batch.base)))],
  };
}

function moduleElement({ path }: PlannedModule): PlanElement {
  return { key: moduleKey(path), label: `Module \`${path}\``, upsert: "upsert_module" };
}

function seamElement(seam: Seam): PlanElement {
  return { key: seamKey(seam), label: `Seam \`${seamLabel(seam)}\``, upsert: "upsert_seam" };
}

function attributed({ upsertedBy }: Batch, { key, label, upsert }: PlanElement, errors: string[]): Problem[] {
  const index = upsertedBy.get(key);
  if (index === undefined) return errors.map((error) => ({ index: unattributed, line: `${label}: ${error}` }));
  return errors.map((error) => ({ index, line: feedback.operationProblem(index, upsert, error) }));
}

function moduleErrors({ path, action }: PlannedModule, { base }: Batch): string[] {
  const base7 = base7Of(base);
  if (path === "." && action === "remove") return [feedback.rootRemoval()];
  if (action !== "create") return base.module(path) ? [] : [unknownModule(path, base)];
  if (base.module(path)) return [feedback.moduleAlreadyExists(path, base7)];
  if (base.hasFile(path)) return [feedback.fileIsNotModule(path, base7)];
  return [];
}

function seamErrors(seam: Seam, batch: Batch): string[] {
  return [...endpointErrors(seam, batch), ...containmentErrors(seam), ...interfaceErrors(seam)];
}

function endpointErrors({ from, to }: Seam, { plan, droppedModules, base }: Batch): string[] {
  return [...new Set([from, to])].flatMap((endpoint) => {
    if (base.module(endpoint) || isWithinCreatedModule(plan.modules, endpoint)) return [];
    return [isWithinCreatedModule(droppedModules, endpoint) ? feedback.noLongerCreated(endpoint) : unknownModule(endpoint, base)];
  });
}

function isWithinCreatedModule(modules: PlannedModule[], path: string): boolean {
  return modules.some((module) => module.action === "create" && (module.path === path || isWithin(path, module.path)));
}

function containmentErrors({ from, to }: Seam): string[] {
  if (from === to || isWithin(to, from)) return [feedback.seamWithinItself(from, to)];
  if (isWithin(from, to)) return [feedback.seamWithinItself(to, from)];
  return [];
}

function interfaceErrors({ to, interface: seamInterface }: Seam): string[] {
  return (seamInterface?.files ?? []).filter((file) => !isWithin(file, to)).map((file) => feedback.interfaceFileOutside(file, to));
}

function seamWarnings(seam: Seam, base: ArchitectureModel): string[] {
  return [...missingInterfaceFiles(seam, base), ...missingDependency(seam, base)];
}

function missingInterfaceFiles({ to, interface: seamInterface }: Seam, base: ArchitectureModel): string[] {
  const planned = (seamInterface?.files ?? []).filter((file) => isWithin(file, to) && !base.hasFile(file));
  return planned.map((file) => feedback.interfaceFileMissing(file, base7Of(base)));
}

function missingDependency({ from, to, action }: Seam, base: ArchitectureModel): string[] {
  if (action === "add" || base.evidence(from, to, { limit: 1 }).length > 0) return [];
  return [feedback.seamWithoutDependency(from, to, base7Of(base), action)];
}

function unknownModule(path: string, base: ArchitectureModel): string {
  return feedback.unknownModule(path, base7Of(base), closestModules(base, path));
}

function base7Of(base: ArchitectureModel): string {
  return shortCommit(base.payload.commit ?? "");
}
