import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArchitecturePlan, ConformanceResult } from "../../architecture/contracts/index.ts";
import { ArchitectureModel } from "../../architecture/model/index.ts";
import { createExplorerApi, type ExplorerApi, type RepositoryState } from "../api.ts";
import { rememberRepository } from "./recent-repositories.ts";

export type LoadState = "idle" | "loading" | "ready" | "error";

export type PlanChoice = string | null | undefined;

export type Repository = {
  path: string | null;
  planId: PlanChoice;
  api: ExplorerApi | null;
  state: RepositoryState | null;
  model: ArchitectureModel | null;
  loadState: LoadState;
  error: string | null;
  open(path: string, planId: PlanChoice): void;
  reload(): void;
  choosePlan(planId: string | null): void;
  replacePlan(plan: ArchitecturePlan): void;
  replaceConformance(conformance: ConformanceResult | null): void;
  leave(): void;
};

export function useRepository(initialPath: string | null, initialPlanId: PlanChoice): Repository {
  const [path, setPath] = useState(initialPath);
  const [planId, setPlanId] = useState<PlanChoice>(initialPlanId);
  const [state, setState] = useState<RepositoryState | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(initialPath ? "loading" : "idle");
  const [error, setError] = useState<string | null>(null);
  const api = useMemo(() => (path ? createExplorerApi(path) : null), [path]);
  const model = useMemo(() => (state ? new ArchitectureModel(state.payload) : null), [state?.payload]);

  useEffect(() => {
    if (!api || !path) return;
    let alive = true;
    setLoadState("loading");
    setError(null);
    api
      .load(planId)
      .then((loaded) => {
        if (!alive) return;
        rememberRepository(path);
        setState(loaded);
        if (loaded.plan) setPlanId(loaded.plan.id);
        setLoadState("ready");
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setLoadState("error");
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      alive = false;
    };
  }, [api, planId]);

  const open = useCallback((nextPath: string, nextPlanId: PlanChoice) => {
    setState(null);
    setPath(nextPath);
    setPlanId(nextPlanId);
  }, []);

  const reload = useCallback(() => {
    setLoadState("loading");
    api?.load(planId).then(setState).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught))).finally(() => setLoadState("ready"));
  }, [api, planId]);

  return {
    path,
    planId,
    api,
    state,
    model,
    loadState,
    error,
    open,
    reload,
    choosePlan: setPlanId,
    replacePlan: useCallback((plan) => setState((current) => (current ? { ...current, plan, plans: withSummary(current.plans, plan) } : current)), []),
    replaceConformance: useCallback((conformance) => setState((current) => (current ? { ...current, conformance } : current)), []),
    leave: useCallback(() => {
      setPath(null);
      setState(null);
      setLoadState("idle");
    }, []),
  };
}

function withSummary(plans: RepositoryState["plans"], plan: ArchitecturePlan): RepositoryState["plans"] {
  const summary = { id: plan.id, title: plan.title, status: plan.status, revision: plan.revision, baseCommit: plan.baseCommit, updatedAt: plan.updatedAt, pendingHumanComments: plan.comments.filter((comment) => comment.author === "human" && !comment.resolution).length };
  return plans.some((entry) => entry.id === plan.id) ? plans.map((entry) => (entry.id === plan.id ? summary : entry)) : [...plans, summary];
}
