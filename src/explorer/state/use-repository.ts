import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArchitecturePlan, ConformanceResult, PlanOperation } from "../../architecture/contracts/index.ts";
import { ArchitectureModel } from "../../architecture/model/index.ts";
import { createExplorerApi, StalePlanError, type ExplorerApi, type RepositoryState } from "../api.ts";
import type { MutationOutcome } from "../inspector/plan-actions.ts";
import { rememberRepository } from "./recent-repositories.ts";
import { acceptConformance, acceptPlan, reconcileLoaded, type PlanChoice } from "./reconcile.ts";

export type LoadState = "idle" | "loading" | "ready" | "error";

export type { PlanChoice };

export type Repository = {
  path: string | null;
  planId: PlanChoice;
  api: ExplorerApi | null;
  state: RepositoryState | null;
  model: ArchitectureModel | null;
  loadState: LoadState;
  error: string | null;
  open(path: string, planId: PlanChoice): void;
  choosePlan(planId: string | null): void;
  leave(): void;
  resync(): void;
  acceptPlan(plan: ArchitecturePlan): boolean;
  acceptConformance(result: ConformanceResult): boolean;
  applyOperations(operations: PlanOperation[], note: string): Promise<MutationOutcome>;
  setLock(locked: boolean): Promise<MutationOutcome>;
  check(final: boolean): Promise<MutationOutcome>;
};

export function useRepository(initialPath: string | null, initialPlanId: PlanChoice): Repository {
  const [path, setPath] = useState(initialPath);
  const [choice, setChoice] = useState<PlanChoice>(initialPlanId);
  const [state, setState] = useState<RepositoryState | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(initialPath ? "loading" : "idle");
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const choiceRef = useRef(choice);
  const generation = useRef(0);
  const api = useMemo(() => (path ? createExplorerApi(path) : null), [path]);
  const model = useMemo(() => (state ? new ArchitectureModel(state.payload) : null), [state?.payload]);

  const commit = useCallback((next: RepositoryState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const select = useCallback((nextPath: string | null, nextChoice: PlanChoice) => {
    generation.current += 1;
    choiceRef.current = nextChoice;
    setPath(nextPath);
    setChoice(nextChoice);
  }, []);

  const fetchInto = useCallback(
    (silent: boolean) => {
      if (!api || !path) return;
      const requested = generation.current;
      if (!silent) setLoadState("loading");
      setError(null);
      api
        .load(stateRef.current?.plan?.id ?? choiceRef.current)
        .then((loaded) => {
          if (requested !== generation.current) return;
          rememberRepository(path);
          commit(reconcileLoaded(stateRef.current, loaded, choiceRef.current));
          setLoadState("ready");
        })
        .catch((caught: unknown) => {
          if (requested !== generation.current) return;
          setLoadState("error");
          setError(messageOf(caught));
        });
    },
    [api, path, commit],
  );

  useEffect(() => {
    fetchInto(false);
  }, [api, choice]);

  const accept = useCallback(
    (reconcile: (current: RepositoryState) => RepositoryState): boolean => {
      const current = stateRef.current;
      if (!current) return false;
      const next = reconcile(current);
      if (next === current) return false;
      commit(next);
      return true;
    },
    [commit],
  );

  const acceptPlanNow = useCallback((plan: ArchitecturePlan) => accept((current) => acceptPlan(current, plan, choiceRef.current)), [accept]);
  const acceptConformanceNow = useCallback((result: ConformanceResult) => accept((current) => acceptConformance(current, result)), [accept]);

  const mutate = useCallback(
    async <T>(request: (client: ExplorerApi, plan: ArchitecturePlan) => Promise<T>, apply: (value: T) => void): Promise<MutationOutcome> => {
      const plan = stateRef.current?.plan;
      if (!api || !plan) return { ok: false, message: "No plan is open." };
      const requested = generation.current;
      try {
        const value = await request(api, plan);
        if (requested === generation.current) apply(value);
        return { ok: true };
      } catch (caught) {
        if (requested !== generation.current || !(caught instanceof StalePlanError)) return { ok: false, message: messageOf(caught) };
        if (caught.plan) acceptPlanNow(caught.plan);
        return { ok: false, message: staleMessage(caught.plan) };
      }
    },
    [api, acceptPlanNow],
  );

  return {
    path,
    planId: state?.plan?.id ?? choice,
    api,
    state,
    model,
    loadState,
    error,
    open: useCallback((nextPath: string, nextPlanId: PlanChoice) => {
      commit(null);
      select(nextPath, nextPlanId);
    }, [commit, select]),
    choosePlan: useCallback((nextPlanId: string | null) => select(path, nextPlanId), [path, select]),
    leave: useCallback(() => {
      commit(null);
      select(null, undefined);
      setLoadState("idle");
    }, [commit, select]),
    resync: useCallback(() => fetchInto(true), [fetchInto]),
    acceptPlan: acceptPlanNow,
    acceptConformance: acceptConformanceNow,
    applyOperations: useCallback((operations, note) => mutate((client, plan) => client.applyOperations(plan.id, plan.revision, operations, note), acceptPlanNow), [mutate, acceptPlanNow]),
    setLock: useCallback((locked) => mutate((client, plan) => client.setLock(plan.id, plan.revision, locked), acceptPlanNow), [mutate, acceptPlanNow]),
    check: useCallback((final) => mutate((client, plan) => client.check(plan.id, final), acceptConformanceNow), [mutate, acceptConformanceNow]),
  };
}

function staleMessage(plan: ArchitecturePlan | undefined): string {
  const revision = plan ? `revision ${plan.revision}` : "a newer revision";
  return `Not saved: the plan moved to ${revision} meanwhile. Your input is kept. Check the new revision, then submit again.`;
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
