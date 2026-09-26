import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArchitecturePlan, ConformanceResult, PlanOperation } from "../../architecture/contracts/index.ts";
import { ArchitectureModel } from "../../architecture/model/index.ts";
import { createExplorerApi, StalePlanError, type ExplorerApi, type RepositoryState } from "../api.ts";
import type { MutationOutcome } from "../inspector/plan-actions.ts";
import { rememberRepository } from "./recent-repositories.ts";
import { acceptArchitecture, acceptLiveCheck, acceptPlan, acceptPlans, type PlanChoice } from "./reconcile.ts";

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
  resyncPlans(): void;
  refreshArchitecture(): void;
  acceptPlan(plan: ArchitecturePlan): boolean;
  acceptLiveCheck(result: ConformanceResult): boolean;
  applyOperations(operations: PlanOperation[], note: string): Promise<MutationOutcome>;
  setLock(locked: boolean): Promise<MutationOutcome>;
  check(final: boolean): Promise<MutationOutcome>;
};

type Fetched = "architecture" | "plans";

export function useRepository(initialPath: string | null, initialPlanId: PlanChoice): Repository {
  const [path, setPath] = useState(initialPath);
  const [choice, setChoice] = useState<PlanChoice>(initialPlanId);
  const [state, setState] = useState<RepositoryState | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(initialPath ? "loading" : "idle");
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const choiceRef = useRef(choice);
  const requests = useRef({ next: 0, barrier: 0, applied: { architecture: 0, plans: 0 } });
  const api = useMemo(() => (path ? createExplorerApi(path) : null), [path]);
  const model = useMemo(() => (state ? new ArchitectureModel(state.payload) : null), [state?.payload]);

  const commit = useCallback((next: RepositoryState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const beginRequest = useCallback(() => ++requests.current.next, []);
  const stillWanted = useCallback((request: number) => request > requests.current.barrier, []);
  const appliesFetched = useCallback(
    (kind: Fetched, request: number) => {
      if (!stillWanted(request) || request <= requests.current.applied[kind]) return false;
      requests.current.applied[kind] = request;
      return true;
    },
    [stillWanted],
  );

  const select = useCallback((nextPath: string | null, nextChoice: PlanChoice) => {
    requests.current.barrier = requests.current.next;
    choiceRef.current = nextChoice;
    setPath(nextPath);
    setChoice(nextChoice);
  }, []);

  const fetchPlansInto = useCallback(
    async (client: ExplorerApi, base: () => RepositoryState | null): Promise<boolean> => {
      const request = beginRequest();
      const loaded = await client.loadPlans(choiceRef.current === undefined ? stateRef.current?.plan?.id : choiceRef.current);
      const current = base();
      if (!current || !appliesFetched("plans", request)) return false;
      commit(acceptPlans(current, loaded, choiceRef.current));
      return true;
    },
    [beginRequest, appliesFetched, commit],
  );

  const failWith = useCallback((caught: unknown) => {
    setLoadState("error");
    setError(messageOf(caught));
  }, []);

  const load = useCallback(() => {
    if (!api || !path) return;
    setLoadState("loading");
    setError(null);
    const request = beginRequest();
    const architecture = stateRef.current ? Promise.resolve(stateRef.current.payload) : api.loadArchitecture();
    architecture
      .then((payload) => {
        if (!appliesFetched("architecture", request)) return false;
        rememberRepository(path);
        return fetchPlansInto(api, () => stateRef.current ?? { path, payload, plans: [], plan: null, conformance: null });
      })
      .then((applied) => {
        if (applied) setLoadState("ready");
      })
      .catch((caught: unknown) => {
        if (stillWanted(request)) failWith(caught);
      });
  }, [api, path, beginRequest, appliesFetched, fetchPlansInto, stillWanted, failWith]);

  useEffect(load, [api, choice]);

  const resyncPlans = useCallback(() => {
    if (!api) return;
    fetchPlansInto(api, () => stateRef.current).catch(failWith);
  }, [api, fetchPlansInto, failWith]);

  const refreshArchitecture = useCallback(() => {
    if (!api) return;
    const request = beginRequest();
    api
      .loadArchitecture()
      .then((payload) => {
        const current = stateRef.current;
        if (current && appliesFetched("architecture", request)) commit(acceptArchitecture(current, payload));
      })
      .catch(failWith);
  }, [api, beginRequest, appliesFetched, commit, failWith]);

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
  const acceptLiveCheckNow = useCallback((result: ConformanceResult) => accept((current) => acceptLiveCheck(current, result)), [accept]);

  const mutate = useCallback(
    async <T>(request: (client: ExplorerApi, plan: ArchitecturePlan) => Promise<T>, apply: (value: T) => void): Promise<MutationOutcome> => {
      const plan = stateRef.current?.plan;
      if (!api || !plan) return { ok: false, message: "No plan is open." };
      const started = beginRequest();
      try {
        const value = await request(api, plan);
        if (stillWanted(started)) apply(value);
        return { ok: true };
      } catch (caught) {
        if (!stillWanted(started) || !(caught instanceof StalePlanError)) return { ok: false, message: messageOf(caught) };
        if (caught.plan) acceptPlanNow(caught.plan);
        return { ok: false, message: staleMessage(caught.plan) };
      }
    },
    [api, beginRequest, stillWanted, acceptPlanNow],
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
    resyncPlans,
    refreshArchitecture,
    acceptPlan: acceptPlanNow,
    acceptLiveCheck: acceptLiveCheckNow,
    applyOperations: useCallback((operations, note) => mutate((client, plan) => client.applyOperations(plan.id, plan.revision, operations, note), acceptPlanNow), [mutate, acceptPlanNow]),
    setLock: useCallback((locked) => mutate((client, plan) => client.setLock(plan.id, plan.revision, locked), acceptPlanNow), [mutate, acceptPlanNow]),
    check: useCallback((final) => mutate((client, plan) => client.check(plan.id, final), acceptLiveCheckNow), [mutate, acceptLiveCheckNow]),
  };
}

function staleMessage(plan: ArchitecturePlan | undefined): string {
  const revision = plan ? `revision ${plan.revision}` : "a newer revision";
  return `Not saved: the plan is now at ${revision}. Check it, then submit again.`;
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
