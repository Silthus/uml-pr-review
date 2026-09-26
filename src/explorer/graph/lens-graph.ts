import type { FarDependency, ModuleView } from "../../architecture/contracts/index.ts";
import type { ArchitectureModel } from "../../architecture/model/index.ts";
import { aggregateEdges, bySizeDescending, compactNumber, contextOf, dependencyEdge, ghostModule, moreNode, moreNodeId, packageNode, planMarks, withTones } from "./nodes.ts";
import { ancestorsOf } from "./paths.ts";
import type { GraphEdge, GraphNode, Tone, ViewState, VisibleGraph } from "./types.ts";

export const lensChildCap = 5;
export const lensFarEndCap = 5;

export function buildLensGraph(model: ArchitectureModel, view: ViewState, subject: ModuleView): VisibleGraph {
  const marks = planMarks(null, null);
  const children = model.children(subject.path).filter((child) => view.includeTests || child.kind !== "tests").sort(bySizeDescending);
  const keptChildren = children.slice(0, lensChildCap);
  const foldedChildren = children.slice(lensChildCap);
  const outgoing = model.dependencies(subject.path, "out", { includeTests: view.includeTests });
  const incoming = model.dependencies(subject.path, "in", { includeTests: view.includeTests });
  const farEnds = farEndSides(outgoing.slice(0, lensFarEndCap), incoming.slice(0, lensFarEndCap));
  const container = keptChildren.length > 0;
  const ownId = container && subject.directFiles > 0 ? `own:${subject.path}` : null;

  const nodes: GraphNode[] = [
    packageNode(subject, { parentId: null, container, expanded: container, hiddenChildren: foldedChildren.length, context: contextOf(subject.path) }, marks),
    ...keptChildren.map((child) => packageNode(child, { parentId: subject.path, container: false, expanded: false, hiddenChildren: child.childCount }, marks)),
    ...(ownId ? [packageNode({ ...ghostModule(subject.path, subject.parent), label: "own files", kind: subject.kind, directFiles: subject.directFiles, totalFiles: subject.directFiles }, { parentId: subject.path, container: false, expanded: false, hiddenChildren: 0 }, marks, ownId)] : []),
    ...(foldedChildren.length > 0 ? [moreNode(moreNodeId(subject.path), subject.path, { parent: subject.path, hidden: foldedChildren.length, label: `+${foldedChildren.length} more`, detail: "smaller modules", expandable: false })] : []),
    ...[...farEnds].map(([path, side]) => packageNode(model.module(path) ?? ghostModule(path, null), { parentId: null, container: false, expanded: false, hiddenChildren: model.module(path)?.childCount ?? 0, context: contextOf(path), layer: side === "in" ? "first" : side === "out" ? "last" : undefined }, marks)),
    ...restNode("more:in", incoming.slice(lensFarEndCap), "dependents", "first"),
    ...restNode("more:out", outgoing.slice(lensFarEndCap), "dependencies", "last"),
  ];

  const inside = new Map<string, string>([[subject.path, ownId ?? subject.path], ...keptChildren.map((child): [string, string] => [child.path, child.path]), ...foldedChildren.map((child): [string, string] => [child.path, moreNodeId(subject.path)])]);
  const outside = (path: string, direction: "in" | "out") => (farEnds.has(path) ? path : path === subject.path || inside.has(path) ? null : direction === "in" ? "more:in" : "more:out");
  const lifted = model.lift(new Set([...ancestorsOf(subject.path), subject.path]), { includeTests: view.includeTests }).dependencies;
  const edges: GraphEdge[] = [];
  const outEdges = aggregateEdges(lifted.flatMap((dependency) => {
    const source = inside.get(dependency.from);
    const target = source ? outside(dependency.to, "out") : null;
    return source && target && nodeExists(nodes, target) ? [{ source, target, imports: dependency.imports }] : [];
  }));
  const inEdges = aggregateEdges(lifted.flatMap((dependency) => {
    const target = inside.get(dependency.to);
    const source = target ? outside(dependency.from, "in") : null;
    return source && target && nodeExists(nodes, source) ? [{ source, target, imports: dependency.imports }] : [];
  }));
  for (const edge of outEdges.values()) edges.push(dependencyEdge(edge, "outgoing"));
  for (const edge of inEdges.values()) edges.push(dependencyEdge(edge, "incoming"));

  const tones = new Map<string, Tone>([[subject.path, "selected"], ...[...farEnds].map(([path, side]): [string, Tone] => [path, side === "both" ? "both" : side === "in" ? "incoming" : "outgoing"])]);
  return { mode: "lens", nodes: withTones(nodes, tones), edges };
}

function farEndSides(outgoing: FarDependency[], incoming: FarDependency[]): Map<string, "in" | "out" | "both"> {
  const sides = new Map<string, "in" | "out" | "both">();
  for (const far of incoming) sides.set(far.module, "in");
  for (const far of outgoing) sides.set(far.module, sides.has(far.module) ? "both" : "out");
  return sides;
}

function restNode(id: string, rest: FarDependency[], noun: string, layer: "first" | "last"): GraphNode[] {
  if (rest.length === 0) return [];
  const imports = rest.reduce((total, far) => total + far.imports, 0);
  return [moreNode(id, null, { parent: null, hidden: rest.length, label: `+${rest.length} more ${noun}`, detail: `${compactNumber(imports)} imports, listed in the inspector`, expandable: false }, layer)];
}

function nodeExists(nodes: GraphNode[], id: string): boolean {
  return nodes.some((node) => node.id === id);
}
