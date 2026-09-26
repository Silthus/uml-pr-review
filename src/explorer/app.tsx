import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArchitecturePlan, CommentTarget, PlanOperation, SelectionTarget } from "../architecture/contracts/index.ts";
import { StalePlanError } from "./api.ts";
import { ArchitectureCanvas } from "./canvas/architecture-canvas.tsx";
import { CanvasActionsContext } from "./canvas/canvas-actions.ts";
import { buildVisibleGraph, type VisibleGraph } from "./graph/visible-graph.ts";
import { Inspector } from "./inspector/inspector.tsx";
import type { PlanActions } from "./inspector/plan-actions.ts";
import { ActivityFeed } from "./shell/activity-feed.tsx";
import { Header } from "./shell/header.tsx";
import { RepositoryPicker } from "./shell/repository-picker.tsx";
import { initialTheme, rememberTheme, type Theme } from "./state/theme.ts";
import { readUrlState, writeUrlState } from "./state/url-state.ts";
import { useLayout } from "./state/use-layout.ts";
import { useLiveEvents } from "./state/use-live-events.ts";
import { useRepository } from "./state/use-repository.ts";
import { useViewState } from "./state/use-view-state.ts";

const emptyGraph: VisibleGraph = { nodes: [], edges: [] };

function planPaths(plan: ArchitecturePlan): string[] {
  return [...plan.modules.map((module) => module.path), ...plan.seams.flatMap((seam) => [seam.from, seam.to])];
}

export function ExplorerApp() {
  const [url] = useState(readUrlState);
  const [theme, setTheme] = useState<Theme>(() => initialTheme(url.theme));
  const repository = useRepository(url.path, url.plan);
  const view = useViewState(url.focus, url.expanded);
  const plan = repository.state?.plan ?? null;
  const conformance = repository.state?.conformance ?? null;
  const overlay = view.planVisible ? plan : null;

  const live = useLiveEvents(repository.api, plan, {
    applyPlan: (patched) => {
      if (repository.planId && patched.id !== repository.planId) return;
      repository.replacePlan(patched);
      if (view.followAgent) view.resetFor(planPaths(patched));
    },
    applyConformance: (result) => {
      if (repository.planId && result.planId !== repository.planId) return;
      repository.replaceConformance(result);
    },
    focus: (target: SelectionTarget) => {
      if (!view.followAgent) return;
      if (target.kind === "module") view.selectModule(target.path);
      else view.selectSeam(target.from, target.to);
    },
    reindex: (tree) => {
      if (repository.state && repository.state.payload.tree !== tree) repository.reload();
    },
  });

  const graph = useMemo(
    () => (repository.model ? buildVisibleGraph(repository.model, { expanded: view.expanded, showAll: view.showAll, selection: view.selection, includeTests: view.includeTests, plan: overlay, conformance: overlay ? conformance : null }) : emptyGraph),
    [repository.model, view.expanded, view.showAll, view.selection, view.includeTests, overlay, conformance],
  );
  const layout = useLayout(graph);

  useEffect(() => {
    if (plan) view.resetFor(planPaths(plan));
  }, [plan?.id]);

  useEffect(() => {
    writeUrlState({ path: repository.path, plan: repository.planId, selection: view.selection, expanded: view.expanded });
  }, [repository.path, repository.planId, view.selection, view.expanded]);

  useEffect(() => {
    rememberTheme(theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const applyOperations = useCallback(
    async (operations: PlanOperation[], note: string) => {
      if (!repository.api || !plan) return;
      try {
        repository.replacePlan(await repository.api.applyOperations(plan.id, plan.revision, operations, note));
      } catch (caught) {
        if (caught instanceof StalePlanError) {
          if (caught.plan) repository.replacePlan(caught.plan);
          live.note({ tone: "error", text: `Your edit was rejected: the plan changed to revision ${caught.plan?.revision ?? "?"} meanwhile. Reloaded the plan, please try again.` });
          return;
        }
        live.note({ tone: "error", text: caught instanceof Error ? caught.message : String(caught) });
      }
    },
    [repository.api, plan, live.note],
  );

  const actions: PlanActions = useMemo(
    () => ({
      addComment: (target: CommentTarget, body: string) => applyOperations([{ op: "add_comment", target, body }], "Comment from the explorer"),
      upsertModule: (entry) => applyOperations([{ op: "upsert_module", ...entry }], `Explorer: ${entry.action} ${entry.path}`),
      dropModule: (path) => applyOperations([{ op: "drop_module", path }], `Explorer: dropped ${path}`),
      upsertSeam: (seam) => applyOperations([{ op: "upsert_seam", ...seam }], `Explorer: ${seam.action} seam ${seam.from} → ${seam.to}`),
      dropSeam: (from, to) => applyOperations([{ op: "drop_seam", from, to }], `Explorer: dropped seam ${from} → ${to}`),
      setLocked: async (locked) => {
        if (!repository.api || !plan) return;
        try {
          repository.replacePlan(await repository.api.setLock(plan.id, plan.revision, locked));
        } catch (caught) {
          if (caught instanceof StalePlanError && caught.plan) repository.replacePlan(caught.plan);
          live.note({ tone: "error", text: caught instanceof Error ? caught.message : String(caught) });
        }
      },
      check: async (final) => {
        if (!repository.api || !plan) return;
        try {
          repository.replaceConformance(await repository.api.check(plan.id, final));
          view.setPlanVisible(true);
          view.resetFor(planPaths(plan));
        } catch (caught) {
          live.note({ tone: "error", text: caught instanceof Error ? caught.message : String(caught) });
        }
      },
    }),
    [applyOperations, repository.api, plan, live.note, view.setPlanVisible],
  );

  const canvasActions = useMemo(
    () => ({ selectModule: view.selectModule, selectSeam: view.selectSeam, toggleExpanded: view.toggleExpanded, showAllChildren: view.showAllChildren }),
    [view.selectModule, view.selectSeam, view.toggleExpanded, view.showAllChildren],
  );

  if (!repository.path) return <RepositoryPicker onOpen={(path) => repository.open(path, null)} />;

  return (
    <div className={`explorer theme-${theme}`}>
      <Header
        path={repository.path}
        repositoryName={repository.state?.payload.repository.name ?? "Loading…"}
        model={repository.model}
        plans={repository.state?.plans ?? []}
        planId={repository.planId}
        planVisible={view.planVisible}
        eventStatus={live.status}
        includeTests={view.includeTests}
        followAgent={view.followAgent}
        theme={theme}
        onChoosePlan={repository.choosePlan}
        onPlanVisible={view.setPlanVisible}
        onIncludeTests={view.setIncludeTests}
        onFollowAgent={view.setFollowAgent}
        onTheme={setTheme}
        onSearch={view.selectModule}
        onLeave={repository.leave}
      />
      {repository.loadState === "error" ? <div role="alert" className="banner-error">{repository.error}</div> : null}
      <div className="workspace">
        <CanvasActionsContext.Provider value={canvasActions}>
          <div className="canvas-column">
            <ArchitectureCanvas scene={layout.scene} fresh={live.fresh} focus={view.focus} pending={layout.pending} error={layout.error} loading={repository.loadState === "loading"} theme={theme} onClearSelection={view.clearSelection} />
            <ActivityFeed activity={live.activity} />
          </div>
        </CanvasActionsContext.Provider>
        {repository.model ? (
          <Inspector model={repository.model} selection={view.selection} plan={overlay} conformance={overlay ? conformance : null} includeTests={view.includeTests} actions={actions} onSelectModule={view.selectModule} onSelectSeam={view.selectSeam} />
        ) : (
          <aside className="inspector" aria-label="Inspector"><section className="panel"><p className="muted">{repository.loadState === "loading" ? "Indexing the repository. A cold PostHog index takes a few seconds." : "Nothing loaded."}</p></section></aside>
        )}
      </div>
    </div>
  );
}
