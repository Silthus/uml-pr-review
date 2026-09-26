import type { Selection } from "../graph/visible-graph.ts";

export type UrlState = { path: string | null; plan: string | null | undefined; focus: string | null; expanded: string[]; theme: string | null };

const noPlan = "none";

export function readUrlState(): UrlState {
  const params = new URLSearchParams(location.search);
  return {
    path: params.get("path"),
    plan: readPlan(params.get("plan")),
    focus: params.get("focus"),
    expanded: (params.get("expanded") ?? "").split(",").filter(Boolean),
    theme: params.get("theme"),
  };
}

export function writeUrlState(state: { path: string | null; plan: string | null | undefined; selection: Selection | null; expanded: ReadonlySet<string> }) {
  const params = new URLSearchParams();
  if (state.path) params.set("path", state.path);
  if (state.plan !== undefined) params.set("plan", state.plan ?? noPlan);
  if (state.selection?.kind === "module") params.set("focus", state.selection.path);
  if (state.expanded.size > 0) params.set("expanded", [...state.expanded].sort().join(","));
  const query = params.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

function readPlan(value: string | null): string | null | undefined {
  if (value === null) return undefined;
  return value === noPlan ? null : value;
}
