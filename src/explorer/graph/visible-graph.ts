import type { ArchitectureModel } from "../../architecture/model/index.ts";
import { buildLensGraph } from "./lens-graph.ts";
import { buildMapGraph } from "./map-graph.ts";
import { buildPlanGraph } from "./plan-graph.ts";
import type { ViewState, VisibleGraph } from "./types.ts";

export function buildVisibleGraph(model: ArchitectureModel, view: ViewState): VisibleGraph {
  const subject = view.mode === "lens" && view.selection?.kind === "module" ? model.module(view.selection.path) : undefined;
  if (subject) return buildLensGraph(model, view, subject);
  if (view.plan) return buildPlanGraph(model, view, view.plan);
  return buildMapGraph(model, view);
}

export { childCap } from "./map-graph.ts";
export { compactNumber, edgeId, isProminent, moreNodeId } from "./nodes.ts";
export type { DependencyEdgeData, GraphEdge, GraphMode, GraphNode, MoreNodeData, PackageNodeData, Selection, Tone, ViewState, VisibleGraph } from "./types.ts";
