import type { ArchitecturePayload, ArchitecturePlan, ConformanceResult, PlanSummary } from "../../architecture/contracts/index.ts";
import type { PlansSnapshot, RepositoryState } from "../api.ts";

export type PlanChoice = string | null | undefined;

export function acceptArchitecture(state: RepositoryState, payload: ArchitecturePayload): RepositoryState {
  return payload.tree === state.payload.tree ? state : { ...state, payload };
}

export function acceptPlans(state: RepositoryState, loaded: PlansSnapshot, choice: PlanChoice): RepositoryState {
  const merged = { ...state, plans: mergeSummaries(state.plans, loaded.plans) };
  if (!loaded.plan) return choice === null ? { ...merged, plan: null, conformance: null } : merged;
  const withPlan = acceptPlan(merged, loaded.plan, choice);
  return loaded.conformance ? acceptStoredCheck(withPlan, loaded.conformance) : withPlan;
}

export function acceptPlan(state: RepositoryState, plan: ArchitecturePlan, choice: PlanChoice): RepositoryState {
  const plans = mergeSummaries(state.plans, [summaryOf(plan)]);
  if (!opensPlan(state, plan, choice)) return { ...state, plans };
  const conformance = state.plan?.id === plan.id ? state.conformance : null;
  return { ...state, plans, plan, conformance };
}

export function acceptStoredCheck(state: RepositoryState, result: ConformanceResult): RepositoryState {
  return isForOpenPlan(state, result) && outranks(result, state.conformance, state.payload.repository.root) ? { ...state, conformance: result } : state;
}

export function acceptLiveCheck(state: RepositoryState, result: ConformanceResult): RepositoryState {
  return result.worktree === state.payload.repository.root ? acceptStoredCheck(state, result) : state;
}

function opensPlan(state: RepositoryState, plan: ArchitecturePlan, choice: PlanChoice): boolean {
  if (state.plan?.id === plan.id) return plan.revision >= state.plan.revision;
  return choice === plan.id || (choice === undefined && state.plan === null);
}

function isForOpenPlan(state: RepositoryState, result: ConformanceResult): boolean {
  return state.plan !== null && result.planId === state.plan.id;
}

function outranks(next: ConformanceResult, current: ConformanceResult | null, root: string): boolean {
  if (!current) return true;
  if ((next.worktree === root) !== (current.worktree === root)) return next.worktree === root;
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
