import type { ArchitecturePlan, ConformanceResult, RepositoryRef } from "../../architecture/contracts/index.ts";

export type CheckProvenance = { kind: "current" } | { kind: "outdated"; since: string[] };

export type CheckView = { result: ConformanceResult; provenance: CheckProvenance };

export function checkView(result: ConformanceResult | null, plan: ArchitecturePlan | null, repository: RepositoryRef | undefined): CheckView | null {
  if (!result || !plan || !repository) return null;
  return { result, provenance: checkProvenance(result, plan, repository) };
}

export function currentConformance(check: CheckView | null): ConformanceResult | null {
  return check?.provenance.kind === "current" ? check.result : null;
}

function checkProvenance(result: ConformanceResult, plan: ArchitecturePlan, repository: RepositoryRef): CheckProvenance {
  const since = [
    result.planId !== plan.id ? `this is plan ${plan.id}` : null,
    result.planId === plan.id && result.planRevision !== plan.revision ? `the plan moved to revision ${plan.revision}` : null,
    result.worktree !== repository.root ? `this explorer shows ${repository.root}` : null,
    result.baseCommit !== plan.baseCommit ? `the base commit moved to ${plan.baseCommit.slice(0, 7)}` : null,
  ].filter((reason): reason is string => reason !== null);
  return since.length === 0 ? { kind: "current" } : { kind: "outdated", since };
}
