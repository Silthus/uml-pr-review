import { useEffect, useRef, useState } from "react";
import type { ArchitectureEvent, ArchitecturePlan, ConformanceResult, SelectionTarget } from "../../architecture/contracts/index.ts";
import type { EventStatus, ExplorerApi } from "../api.ts";
import { edgeId } from "../graph/nodes.ts";

export type Activity = { id: string; at: string; tone: "agent" | "human" | "system" | "error"; text: string };

export type LiveHandlers = {
  applyPlan(plan: ArchitecturePlan): boolean;
  applyConformance(result: ConformanceResult): boolean;
  focus(target: SelectionTarget): void;
  reindex(tree: string): void;
  resync(): void;
};

export type LiveState = { status: EventStatus; activity: Activity[]; fresh: ReadonlySet<string>; note(entry: Omit<Activity, "id" | "at">): void };

const activityLimit = 40;
const freshMilliseconds = 2600;

export function useLiveEvents(api: ExplorerApi | null, currentPlan: ArchitecturePlan | null, handlers: LiveHandlers): LiveState {
  const [status, setStatus] = useState<EventStatus>("offline");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const planRef = useRef(currentPlan);
  const handlersRef = useRef(handlers);
  planRef.current = currentPlan;
  handlersRef.current = handlers;

  const note = (entry: Omit<Activity, "id" | "at">) => setActivity((current) => [{ ...entry, id: crypto.randomUUID(), at: new Date().toISOString() }, ...current].slice(0, activityLimit));

  useEffect(() => {
    if (!api) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stop = api.events((event) => {
      const entry = describe(event);
      if (entry) setActivity((current) => [entry, ...current].slice(0, activityLimit));
      if (event.type === "plan_patch") {
        const changed = changedElements(planRef.current, event.plan);
        if (handlersRef.current.applyPlan(event.plan)) {
          setFresh(changed);
          timers.push(setTimeout(() => setFresh(new Set()), freshMilliseconds));
        }
      }
      if (event.type === "conformance_result") handlersRef.current.applyConformance(event.result);
      if (event.type === "selection_hint") handlersRef.current.focus(event.target);
      if (event.type === "index_ready") handlersRef.current.reindex(event.tree);
    }, (next) => {
      setStatus(next);
      if (next === "live") handlersRef.current.resync();
    });
    return () => {
      stop();
      for (const timer of timers) clearTimeout(timer);
    };
  }, [api]);

  return { status, activity, fresh, note };
}

function describe(event: ArchitectureEvent): Activity | null {
  const base = { id: `event-${event.seq}`, at: event.at };
  switch (event.type) {
    case "agent_activity":
      return { ...base, tone: event.status === "ok" ? "agent" : "error", text: `${event.client} · ${event.summary}` };
    case "plan_patch":
      return { ...base, tone: event.revision.actor === "human" ? "human" : "agent", text: `${event.revision.actor} ${describeRevision(event)}` };
    case "conformance_result":
      return { ...base, tone: event.result.verdict === "violating" ? "error" : "system", text: `Check: ${event.result.verdict} (${event.result.counts.violations} violations, ${event.result.counts.pending} pending)` };
    case "selection_hint":
      return { ...base, tone: "agent", text: `${event.client} is looking at ${event.target.kind === "module" ? event.target.path : `${event.target.from} → ${event.target.to}`}` };
    case "index_ready":
      return { ...base, tone: "system", text: `Index ready: ${event.stats.files.toLocaleString()} files, ${event.stats.imports.toLocaleString()} imports` };
  }
}

function describeRevision(event: Extract<ArchitectureEvent, { type: "plan_patch" }>): string {
  const { revision } = event;
  if (revision.kind === "lock") return `locked the plan (revision ${revision.number})`;
  if (revision.kind === "unlock") return `unlocked the plan (revision ${revision.number})`;
  if (revision.kind === "create") return `created the plan "${event.plan.title}"`;
  const summary = revision.operations.map(describeOperation).join(", ");
  return `revision ${revision.number}: ${summary || revision.note || "edited the plan"}`;
}

function describeOperation(operation: ArchitecturePlan["revisions"][number]["operations"][number]): string {
  switch (operation.op) {
    case "upsert_module":
      return `${operation.action} ${operation.path}`;
    case "drop_module":
      return `dropped ${operation.path}`;
    case "upsert_seam":
      return `${operation.action} seam ${operation.from} → ${operation.to}`;
    case "drop_seam":
      return `dropped seam ${operation.from} → ${operation.to}`;
    case "add_comment":
      return "commented";
    case "resolve_comment":
      return operation.reply ? "replied to a comment" : "resolved a comment";
    case "set_summary":
      return "changed the summary";
    case "set_base_commit":
      return "moved the base commit";
  }
}

function changedElements(previous: ArchitecturePlan | null, next: ArchitecturePlan): Set<string> {
  const changed = new Set<string>();
  const previousModules = new Map(previous?.modules.map((module) => [module.path, JSON.stringify(module)]) ?? []);
  const previousSeams = new Map(previous?.seams.map((seam) => [edgeId(seam.from, seam.to), JSON.stringify(seam)]) ?? []);
  for (const module of next.modules) if (previousModules.get(module.path) !== JSON.stringify(module)) changed.add(module.path);
  for (const seam of next.seams) if (previousSeams.get(edgeId(seam.from, seam.to)) !== JSON.stringify(seam)) changed.add(edgeId(seam.from, seam.to));
  return changed;
}
