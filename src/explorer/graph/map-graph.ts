import type { ModuleView } from "../../architecture/contracts/index.ts";
import type { ArchitectureModel } from "../../architecture/model/index.ts";
import { bySizeDescending, dependencyEdge, moreNode, moreNodeId, packageNode, planMarks, withTones } from "./nodes.ts";
import { ancestorsOf } from "./paths.ts";
import type { GraphEdge, GraphNode, Selection, Tone, ViewState, VisibleGraph } from "./types.ts";

export const childCap = 12;

export function buildMapGraph(model: ArchitectureModel, view: ViewState): VisibleGraph {
  const pinned = selectionPaths(view.selection);
  const expanded = new Set([...view.expanded, ...pinned.flatMap(ancestorsOf)]);
  const shown = model.lift(expanded, { includeTests: view.includeTests }).modules.filter((module) => module.path !== ".");
  const folded = foldedChildren(shown, expanded, view.showAll, new Set(pinned));
  const visible = shown.filter((module) => !folded.has(module.path));
  const marks = planMarks(null, null);
  const nodes = [
    ...visible.map((module) => packageNode(module, { parentId: module.parent && module.parent !== "." ? module.parent : null, container: visible.some((candidate) => candidate.parent === module.path) || folded.has(module.path, true), expanded: expanded.has(module.path), hiddenChildren: hiddenChildren(model, module, visible, view.includeTests) }, marks)),
    ...moreNodes(folded),
  ];
  const rootIds = new Set(nodes.filter((node) => node.parentId === null).map((node) => node.id));
  const edges = mapEdges(model, view, rootIds);
  return { mode: "map", nodes: withTones(nodes, mapTones(model, nodes, view)), edges };
}

class FoldedChildren extends Map<string, string> {
  has(path: string, asParent = false): boolean {
    return asParent ? [...this.values()].includes(path) : super.has(path);
  }
}

function foldedChildren(shown: ModuleView[], expanded: ReadonlySet<string>, showAll: ReadonlySet<string>, pinned: ReadonlySet<string>): FoldedChildren {
  const folded = new FoldedChildren();
  for (const [parent, children] of Map.groupBy(shown, (module) => module.parent ?? ".")) {
    if (parent === "." || showAll.has(parent) || children.length <= childCap) continue;
    const kept = new Set([...children].sort(bySizeDescending).slice(0, childCap).map((child) => child.path));
    for (const child of children) {
      if (kept.has(child.path) || pinned.has(child.path) || expanded.has(child.path)) continue;
      folded.set(child.path, parent);
    }
  }
  return folded;
}

function moreNodes(folded: FoldedChildren): GraphNode[] {
  const hiddenByParent = new Map<string, number>();
  for (const parent of folded.values()) hiddenByParent.set(parent, (hiddenByParent.get(parent) ?? 0) + 1);
  return [...hiddenByParent].map(([parent, hidden]) => moreNode(moreNodeId(parent), parent, { parent, hidden, label: `+${hidden} more`, detail: "smaller modules, show all", expandable: true }));
}

function hiddenChildren(model: ArchitectureModel, module: ModuleView, visible: ModuleView[], includeTests: boolean): number {
  const visiblePaths = new Set(visible.map((entry) => entry.path));
  return model.children(module.path).filter((child) => !visiblePaths.has(child.path) && (includeTests || child.kind !== "tests")).length;
}

function mapEdges(model: ArchitectureModel, view: ViewState, rootIds: ReadonlySet<string>): GraphEdge[] {
  const topLevel = model.lift(new Set(), { includeTests: view.includeTests }).dependencies.filter((dependency) => rootIds.has(dependency.from) && rootIds.has(dependency.to));
  const selected = view.selection?.kind === "module" ? view.selection.path : null;
  if (selected !== null) {
    if (!rootIds.has(selected)) return [];
    return topLevel.filter((dependency) => dependency.from === selected || dependency.to === selected).map((dependency) => dependencyEdge({ source: dependency.from, target: dependency.to, imports: dependency.imports }, dependency.from === selected ? "outgoing" : "incoming"));
  }
  const drawn = view.allEdges ? topLevel : backbone(topLevel);
  return drawn.map((dependency) => dependencyEdge({ source: dependency.from, target: dependency.to, imports: dependency.imports }));
}

function backbone<T extends { from: string; imports: number }>(dependencies: T[]): T[] {
  const heaviest = new Map<string, T>();
  for (const dependency of dependencies) {
    const current = heaviest.get(dependency.from);
    if (!current || dependency.imports > current.imports) heaviest.set(dependency.from, dependency);
  }
  return [...heaviest.values()];
}

function mapTones(model: ArchitectureModel, nodes: GraphNode[], view: ViewState): Map<string, Tone> {
  const tones = new Map<string, Tone>();
  const { selection } = view;
  if (selection?.kind === "seam") {
    tones.set(selection.from, "selected");
    tones.set(selection.to, "selected");
    return tones;
  }
  if (!selection) return tones;
  for (const far of model.dependencies(selection.path, "out", { includeTests: view.includeTests })) tones.set(far.module, "outgoing");
  for (const far of model.dependencies(selection.path, "in", { includeTests: view.includeTests })) tones.set(far.module, tones.get(far.module) === "outgoing" ? "both" : "incoming");
  const related = new Set([selection.path, ...ancestorsOf(selection.path)]);
  for (const node of nodes) {
    if (node.id === selection.path) tones.set(node.id, "selected");
    else if (node.id.startsWith(`${selection.path}/`)) tones.set(node.id, "neutral");
    else if (!tones.has(node.id) && !related.has(node.id)) tones.set(node.id, "dimmed");
  }
  return tones;
}

function selectionPaths(selection: Selection | null): string[] {
  if (!selection) return [];
  return selection.kind === "module" ? [selection.path] : [selection.from, selection.to];
}
