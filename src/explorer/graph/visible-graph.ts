import type { ArchitecturePlan, ConformanceResult, Dependency, ElementStatus, ModuleKind, ModuleView, PlannedModule, Seam } from "../../architecture/contracts/index.ts";
import type { ArchitectureModel } from "../../architecture/model/index.ts";
import { ancestorsOf, moduleLabel } from "./paths.ts";

export type Selection = { kind: "module"; path: string } | { kind: "seam"; from: string; to: string };
export type Tone = "neutral" | "selected" | "incoming" | "outgoing" | "both" | "dimmed" | "quiet";

export type ViewState = {
  expanded: ReadonlySet<string>;
  showAll: ReadonlySet<string>;
  selection: Selection | null;
  includeTests: boolean;
  plan: ArchitecturePlan | null;
  conformance: ConformanceResult | null;
};

export type PackageNodeData = {
  path: string;
  label: string;
  kind: ModuleKind;
  directFiles: number;
  totalFiles: number;
  childCount: number;
  hiddenChildren: number;
  expanded: boolean;
  container: boolean;
  ghost: boolean;
  tone: Tone;
  planAction: PlannedModule["action"] | null;
  status: ElementStatus | null;
  comments: number;
};

export type MoreNodeData = { parent: string; hidden: number; tone: Tone };

export type GraphNode = { id: string; parentId: string | null; width: number; height: number } & ({ type: "package"; data: PackageNodeData } | { type: "more"; data: MoreNodeData });

export type SeamOverlay = { action: Seam["action"]; status: ElementStatus | null; interfaceFile: string | null; comments: number };

export type DependencyEdgeData = { imports: number; tone: Tone; seam: SeamOverlay | null; selected: boolean };

export type GraphEdge = { id: string; source: string; target: string; label: string; data: DependencyEdgeData };

export type VisibleGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

export const childCap = 12;
const farEndCap = 8;
const labelledEdgeLimit = 48;
const strongestEdgesPerNode = 2;
const leafHeight = 92;
const moreNodeSize = { width: 168, height: 60 };

export function buildVisibleGraph(model: ArchitectureModel, view: ViewState): VisibleGraph {
  const pinned = pinnedPaths(model, view);
  const expanded = new Set([...view.expanded, ...[...pinned].flatMap(ancestorsOf)]);
  const lifted = model.lift(expanded, { includeTests: view.includeTests });
  const shown = lifted.modules.filter((module) => module.path !== ".");
  const folded = foldedChildren(shown, expanded, view.showAll, pinned);
  const visible = shown.filter((module) => !folded.has(module.path));
  const ghosts = ghostModules(model, view.plan, visible);
  const nodes = [...packageNodes(model, visible, ghosts, expanded, folded, view), ...moreNodes(folded)];
  const edges = withLabels(strongestEdges(withTones(graphEdges(lifted.dependencies, folded, new Set(nodes.map((node) => node.id)), view), view)));
  const tones = nodeTones(nodes, edges, view.selection);
  return { nodes: sortParentsFirst(nodes).map((node) => withTone(node, tones.get(node.id) ?? "neutral")), edges };
}

export function moreNodeId(parent: string): string {
  return `more:${parent}`;
}

export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

function pinnedPaths(model: ArchitectureModel, view: ViewState): Set<string> {
  const pinned = new Set<string>();
  if (view.selection?.kind === "module") {
    pinned.add(view.selection.path);
    for (const direction of ["out", "in"] as const) {
      for (const far of model.dependencies(view.selection.path, direction, { includeTests: view.includeTests }).slice(0, farEndCap)) pinned.add(far.module);
    }
  }
  if (view.selection?.kind === "seam") {
    pinned.add(view.selection.from);
    pinned.add(view.selection.to);
  }
  for (const module of view.plan?.modules ?? []) pinned.add(module.path);
  for (const seam of view.plan?.seams ?? []) {
    pinned.add(seam.from);
    pinned.add(seam.to);
  }
  pinned.delete(".");
  return pinned;
}

function foldedChildren(shown: ModuleView[], expanded: ReadonlySet<string>, showAll: ReadonlySet<string>, pinned: ReadonlySet<string>): Map<string, string> {
  const folded = new Map<string, string>();
  const byParent = Map.groupBy(shown, (module) => module.parent ?? ".");
  for (const [parent, children] of byParent) {
    if (parent === "." || showAll.has(parent) || children.length <= childCap) continue;
    const kept = new Set([...children].sort(bySizeDescending).slice(0, childCap).map((child) => child.path));
    for (const child of children) {
      if (kept.has(child.path) || pinned.has(child.path) || expanded.has(child.path)) continue;
      folded.set(child.path, parent);
    }
  }
  return folded;
}

function ghostModules(model: ArchitectureModel, plan: ArchitecturePlan | null, visible: ModuleView[]): ModuleView[] {
  const visiblePaths = new Set(visible.map((module) => module.path));
  return (plan?.modules ?? [])
    .filter((planned) => !model.module(planned.path))
    .map((planned): ModuleView => ({
      path: planned.path,
      label: moduleLabel(planned.path),
      kind: "package",
      parent: ancestorsOf(planned.path).reverse().find((ancestor) => visiblePaths.has(ancestor)) ?? null,
      childCount: 0,
      directFiles: 0,
      totalFiles: 0,
    }));
}

function packageNodes(model: ArchitectureModel, visible: ModuleView[], ghosts: ModuleView[], expanded: ReadonlySet<string>, folded: Map<string, string>, view: ViewState): GraphNode[] {
  const visiblePaths = new Set([...visible, ...ghosts].map((module) => module.path));
  const planActions = new Map(view.plan?.modules.map((module) => [module.path, module.action]) ?? []);
  const statuses = new Map(view.conformance?.modules.map((module) => [module.path, module.status]) ?? []);
  const comments = commentCounts(view.plan);
  const ghostPaths = new Set(ghosts.map((module) => module.path));
  return [...visible, ...ghosts].map((module): GraphNode => {
    const container = [...visible, ...ghosts].some((candidate) => candidate.parent === module.path) || [...folded.values()].includes(module.path);
    const hiddenChildren = ghostPaths.has(module.path) ? 0 : model.children(module.path).filter((child) => !visiblePaths.has(child.path) && (view.includeTests || child.kind !== "tests")).length;
    return {
      id: module.path,
      type: "package",
      parentId: module.parent && module.parent !== "." ? module.parent : null,
      ...packageSize(module.label, container),
      data: {
        path: module.path,
        label: module.label,
        kind: module.kind,
        directFiles: module.directFiles,
        totalFiles: module.totalFiles,
        childCount: module.childCount,
        hiddenChildren,
        expanded: expanded.has(module.path) && container,
        container,
        ghost: ghostPaths.has(module.path),
        tone: "neutral",
        planAction: planActions.get(module.path) ?? null,
        status: statuses.get(module.path) ?? null,
        comments: comments.get(`module:${module.path}`) ?? 0,
      },
    };
  });
}

function moreNodes(folded: Map<string, string>): GraphNode[] {
  const hiddenByParent = new Map<string, number>();
  for (const parent of folded.values()) hiddenByParent.set(parent, (hiddenByParent.get(parent) ?? 0) + 1);
  return [...hiddenByParent].map(([parent, hidden]): GraphNode => ({ id: moreNodeId(parent), type: "more", parentId: parent, ...moreNodeSize, data: { parent, hidden, tone: "neutral" } }));
}

function graphEdges(dependencies: Dependency[], folded: Map<string, string>, nodeIds: ReadonlySet<string>, view: ViewState): GraphEdge[] {
  const endOf = (path: string) => (folded.has(path) ? moreNodeId(folded.get(path)!) : path);
  const counts = new Map<string, { source: string; target: string; imports: number }>();
  for (const dependency of dependencies) {
    const source = endOf(dependency.from);
    const target = endOf(dependency.to);
    if (source === target || !nodeIds.has(source) || !nodeIds.has(target)) continue;
    const key = edgeId(source, target);
    counts.set(key, { source, target, imports: (counts.get(key)?.imports ?? 0) + dependency.imports });
  }
  const seams = new Map((view.plan?.seams ?? []).filter((seam) => nodeIds.has(seam.from) && nodeIds.has(seam.to)).map((seam) => [edgeId(seam.from, seam.to), seam]));
  for (const [key, seam] of seams) if (!counts.has(key)) counts.set(key, { source: seam.from, target: seam.to, imports: 0 });
  const comments = commentCounts(view.plan);
  return [...counts].map(([id, edge]): GraphEdge => {
    const seam = seams.get(id);
    const overlay = seam ? seamOverlay(seam, view.conformance, comments.get(`seam:${id}`) ?? 0) : null;
    return { id, ...edge, label: edgeLabel(edge.imports, overlay), data: { imports: edge.imports, tone: "neutral", seam: overlay, selected: false } };
  });
}

function seamOverlay(seam: Seam, conformance: ConformanceResult | null, comments: number): SeamOverlay {
  const checked = conformance?.seams.find((entry) => entry.from === seam.from && entry.to === seam.to);
  return { action: seam.action, status: checked?.status ?? null, interfaceFile: seam.interface?.files[0] ?? null, comments };
}

function edgeLabel(imports: number, seam: SeamOverlay | null): string {
  if (!seam) return compactNumber(imports);
  const via = seam.interfaceFile ? ` via ${seam.interfaceFile.slice(seam.interfaceFile.lastIndexOf("/") + 1)}` : "";
  return `${seam.action} seam${via}`;
}

function withTones(edges: GraphEdge[], view: ViewState): GraphEdge[] {
  const { selection } = view;
  if (selection?.kind === "module") {
    return edges.map((edge) => ({ ...edge, data: { ...edge.data, tone: edge.source === selection.path ? "outgoing" : edge.target === selection.path ? "incoming" : "dimmed" } }));
  }
  const selectedId = selection ? edgeId(selection.from, selection.to) : null;
  const planned = new Set([...(view.plan?.modules.map((module) => module.path) ?? []), ...(view.plan?.seams.flatMap((seam) => [seam.from, seam.to]) ?? [])]);
  return edges.map((edge) => {
    const touchesPlan = edge.data.seam !== null || planned.has(edge.source) || planned.has(edge.target);
    return { ...edge, data: { ...edge.data, selected: edge.id === selectedId, tone: view.plan && !touchesPlan ? "quiet" : "neutral" } };
  });
}

function strongestEdges(edges: GraphEdge[]): GraphEdge[] {
  if (edges.length <= labelledEdgeLimit) return edges;
  const kept = new Set<string>();
  for (const side of ["source", "target"] as const) {
    const byNode = Map.groupBy(edges, (edge) => edge[side]);
    for (const group of byNode.values()) {
      for (const edge of [...group].sort((a, b) => b.data.imports - a.data.imports).slice(0, strongestEdgesPerNode)) kept.add(edge.id);
    }
  }
  return edges.filter((edge) => kept.has(edge.id) || isProminent(edge));
}

function withLabels(edges: GraphEdge[]): GraphEdge[] {
  if (edges.length <= labelledEdgeLimit) return edges;
  return edges.map((edge) => (isProminent(edge) ? edge : { ...edge, label: "" }));
}

export function isProminent(edge: GraphEdge): boolean {
  return edge.data.seam !== null || edge.data.selected || edge.data.tone === "incoming" || edge.data.tone === "outgoing";
}

function nodeTones(nodes: GraphNode[], edges: GraphEdge[], selection: Selection | null): Map<string, Tone> {
  const tones = new Map<string, Tone>();
  if (selection?.kind === "seam") {
    tones.set(selection.from, "selected");
    tones.set(selection.to, "selected");
    return tones;
  }
  if (!selection) return tones;
  const related = new Set<string>([selection.path, ...ancestorsOf(selection.path)]);
  for (const edge of edges) {
    if (edge.data.tone === "outgoing") tones.set(edge.target, tones.get(edge.target) === "incoming" ? "both" : "outgoing");
    if (edge.data.tone === "incoming") tones.set(edge.source, tones.get(edge.source) === "outgoing" ? "both" : "incoming");
  }
  for (const node of nodes) {
    if (node.id === selection.path) tones.set(node.id, "selected");
    else if (!tones.has(node.id) && !related.has(node.id)) tones.set(node.id, "dimmed");
  }
  return tones;
}

function withTone(node: GraphNode, tone: Tone): GraphNode {
  return node.type === "package" ? { ...node, data: { ...node.data, tone } } : { ...node, data: { ...node.data, tone } };
}

function commentCounts(plan: ArchitecturePlan | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const comment of plan?.comments ?? []) {
    const key = comment.target.kind === "module" ? `module:${comment.target.path}` : comment.target.kind === "seam" ? `seam:${edgeId(comment.target.from, comment.target.to)}` : "plan";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function packageSize(label: string, container: boolean): { width: number; height: number } {
  const width = Math.max(216, Math.min(420, label.length * 8.2 + 96));
  return { width, height: container ? 120 : leafHeight };
}

function sortParentsFirst(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => depthOf(a.id) - depthOf(b.id) || a.id.localeCompare(b.id));
}

function depthOf(id: string): number {
  return id.split("/").length;
}

function bySizeDescending(a: ModuleView, b: ModuleView): number {
  return b.totalFiles - a.totalFiles || a.path.localeCompare(b.path);
}

export function compactNumber(value: number): string {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
