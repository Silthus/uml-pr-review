import type { ArchitecturePlan, ConformanceResult, PlanSummary } from "../../architecture/contracts/index.ts";
import type { RepositoryState } from "../api.ts";

export type PlanChoice = string | null | undefined;

export function reconcileLoaded(current: RepositoryState | null, loaded: RepositoryState, choice: PlanChoice): RepositoryState {
  if (!current) return loaded;
  const payload = loaded.payload.tree === current.payload.tree ? current.payload : loaded.payload;
  const merged = { ...current, payload, plans: mergeSummaries(current.plans, loaded.plans) };
  if (!loaded.plan) return choice === null ? { ...merged, plan: null, conformance: null } : merged;
  const withPlan = acceptPlan(merged, loaded.plan, choice);
  return loaded.conformance ? acceptConformance(withPlan, loaded.conformance) : withPlan;
}

export function acceptPlan(state: RepositoryState, plan: ArchitecturePlan, choice: PlanChoice): RepositoryState {
  const plans = mergeSummaries(state.plans, [summaryOf(plan)]);
  if (!opensPlan(state, plan, choice)) return { ...state, plans };
  const conformance = state.plan?.id === plan.id ? state.conformance : null;
  return { ...state, plans, plan, conformance };
}

export function acceptConformance(state: RepositoryState, result: ConformanceResult): RepositoryState {
  const root = state.payload.repository.root;
  if (!state.plan || result.planId !== state.plan.id || result.worktree !== root) return state;
  if (state.conformance && state.conformance.worktree === root && !isNewerCheck(result, state.conformance)) return state;
  return { ...state, conformance: result };
}

function opensPlan(state: RepositoryState, plan: ArchitecturePlan, choice: PlanChoice): boolean {
  if (state.plan?.id === plan.id) return plan.revision >= state.plan.revision;
  return choice === plan.id || (choice === undefined && state.plan === null);
}

function isNewerCheck(next: ConformanceResult, current: ConformanceResult): boolean {
  if (next.planRevision !== current.planRevision) return next.planRevision > current.planRevision;
  return next.checkedAt > current.checkedAt;
}

function mergeSummaries(current: PlanSummary[], incoming: PlanSummary[]): PlanSummary[] {
  const merged = new Map(incoming.map((summary) => [summary.id, summary]));
  for (const summary of current) {
    const candidate = merged.get(summary.id);
    if (!candidate || candidate.revision < summary.revision) merged.set(summary.id, summary);
  }
  return [...merged.values()];
}

function summaryOf(plan: ArchitecturePlan): PlanSummary {
  const pendingHumanComments = plan.comments.filter((comment) => comment.author === "human" && !comment.resolution).length;
  return { id: plan.id, title: plan.title, status: plan.status, revision: plan.revision, baseCommit: plan.baseCommit, updatedAt: plan.updatedAt, pendingHumanComments };
}
