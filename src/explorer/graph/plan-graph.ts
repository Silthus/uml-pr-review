import type { ArchitecturePlan, Seam } from "../../architecture/contracts/index.ts";
import type { ArchitectureModel } from "../../architecture/model/index.ts";
import { aggregateEdges, contextOf, dependencyEdge, edgeId, ghostModule, packageNode, planMarks, withTones } from "./nodes.ts";
import { ancestorsOf } from "./paths.ts";
import type { GraphEdge, GraphNode, SeamOverlay, Tone, ViewState, VisibleGraph } from "./types.ts";

const contextFarEndsPerDirection = 2;

type WeightedEdge = { source: string; target: string; imports: number };

export function buildPlanGraph(model: ArchitectureModel, view: ViewState, plan: ArchitecturePlan): VisibleGraph {
  const planned = new Set(plan.modules.map((module) => module.path));
  const seamEnds = new Set(plan.seams.flatMap((seam) => [seam.from, seam.to]));
  const focused = view.selection?.kind === "module" ? view.selection.path : null;
  const context = focused ? contextFarEnds(model, focused, view.includeTests).filter((path) => !planned.has(path) && !seamEnds.has(path) && !isWithinAny(path, planned) && !isAncestorOfAny(path, planned)) : [];
  const drawn = [...new Set([...planned, ...seamEnds, ...context])].filter((path) => path !== ".");
  const marks = planMarks(plan, view.conformance);

  const nodes: GraphNode[] = drawn.map((path) => {
    const module = model.module(path) ?? ghostModule(path, null);
    return packageNode(module, { parentId: null, container: false, expanded: false, hiddenChildren: module.childCount, context: contextOf(path), ghost: !model.module(path) }, marks);
  });

  const drawnSet = new Set(drawn);
  const today = aggregateEdges(dependenciesAmong(model, drawnSet, view.includeTests));
  const seams = new Map(plan.seams.filter((seam) => drawnSet.has(seam.from) && drawnSet.has(seam.to)).map((seam) => [edgeId(seam.from, seam.to), seam]));
  const shown = new Map<string, WeightedEdge>();
  for (const [key, seam] of seams) shown.set(key, today.get(key) ?? { source: seam.from, target: seam.to, imports: 0 });
  for (const [key, edge] of today) if (edge.source === focused || edge.target === focused) shown.set(key, edge);
  const edges = [...shown].map(([key, edge]): GraphEdge => {
    const seam = seams.get(key);
    const overlay = seam ? seamOverlay(seam, view, marks.comments.get(`seam:${key}`) ?? 0) : null;
    const base = dependencyEdge(edge, seam ? "neutral" : "quiet");
    return { ...base, label: overlay ? seamLabel(overlay) : base.label, data: { ...base.data, seam: overlay } };
  });

  return { mode: "plan", nodes: withTones(nodes, planTones(edges, view)), edges: withSelection(edges, view) };
}

function contextFarEnds(model: ArchitectureModel, path: string, includeTests: boolean): string[] {
  if (!model.module(path)) return [];
  return (["out", "in"] as const).flatMap((direction) => model.dependencies(path, direction, { includeTests }).slice(0, contextFarEndsPerDirection).map((far) => far.module));
}

function dependenciesAmong(model: ArchitectureModel, drawn: ReadonlySet<string>, includeTests: boolean): WeightedEdge[] {
  const nearestDrawn = (path: string): string | null => [path, ...ancestorsOf(path).reverse()].find((candidate) => drawn.has(candidate)) ?? null;
  return model.lift(new Set([...drawn].flatMap(ancestorsOf)), { includeTests }).dependencies.flatMap((dependency) => {
    const source = nearestDrawn(dependency.from);
    const target = nearestDrawn(dependency.to);
    return source && target && source !== target ? [{ source, target, imports: dependency.imports }] : [];
  });
}

function isWithinAny(path: string, roots: ReadonlySet<string>): boolean {
  return [...roots].some((root) => path.startsWith(`${root}/`));
}

function isAncestorOfAny(path: string, roots: ReadonlySet<string>): boolean {
  return [...roots].some((root) => root.startsWith(`${path}/`));
}

function seamOverlay(seam: Seam, view: ViewState, comments: number): SeamOverlay {
  const checked = view.conformance?.seams.find((entry) => entry.from === seam.from && entry.to === seam.to);
  return { action: seam.action, status: checked?.status ?? null, interfaceFile: seam.interface?.files[0] ?? null, comments };
}

function seamLabel(seam: SeamOverlay): string {
  const via = seam.interfaceFile ? `\nvia ${seam.interfaceFile.slice(seam.interfaceFile.lastIndexOf("/") + 1)}` : "";
  return `${seam.action} seam${via}`;
}

function planTones(edges: GraphEdge[], view: ViewState): Map<string, Tone> {
  const tones = new Map<string, Tone>();
  const { selection } = view;
  if (!selection) return tones;
  if (selection.kind === "seam") {
    tones.set(selection.from, "selected");
    tones.set(selection.to, "selected");
    return tones;
  }
  tones.set(selection.path, "selected");
  for (const edge of edges) {
    if (edge.source === selection.path) tones.set(edge.target, tones.get(edge.target) === "incoming" ? "both" : "outgoing");
    if (edge.target === selection.path) tones.set(edge.source, tones.get(edge.source) === "outgoing" ? "both" : "incoming");
  }
  return tones;
}

function withSelection(edges: GraphEdge[], view: ViewState): GraphEdge[] {
  const { selection } = view;
  if (!selection) return edges;
  if (selection.kind === "seam") {
    const id = edgeId(selection.from, selection.to);
    return edges.map((edge) => ({ ...edge, data: { ...edge.data, selected: edge.id === id } }));
  }
  return edges.map((edge) => ({ ...edge, data: { ...edge.data, tone: edge.source === selection.path ? "outgoing" : edge.target === selection.path ? "incoming" : edge.data.tone } }));
}
