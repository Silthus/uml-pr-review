import { pairKey, type FileImport, type IndexView, type UnresolvedImport } from "./index-view.ts";
import type { TachConfig } from "./tach.ts";

export type Crossing = { from: string; to: string };
export type ModuleEdge = { from: string; to: string };
export type NewDependency = ModuleEdge & { declared: boolean };

export type BoundaryHygiene = {
  facadeBypasses: Crossing[];
  testFacadeBypasses: Crossing[];
  newCrossProductDependencies: NewDependency[];
  newCycles: ModuleEdge[];
  newUnresolvedImports: UnresolvedImport[];
};

export function boundaryHygiene(base: IndexView, patched: IndexView, tach: TachConfig, changedFiles: string[], renames: Map<string, string> = new Map()): BoundaryHygiene {
  const bypasses = newImports(base, patched, renames).filter(isFacadeBypass);
  const baseGraph = tachGraph(base, tach);
  const patchedGraph = tachGraph(patched, tach);
  const newEdges = [...patchedGraph.edges.values()].filter((edge) => !baseGraph.edges.has(pairKey(edge.from, edge.to)));
  return {
    facadeBypasses: bypasses.filter(({ fromTest }) => !fromTest).map(crossing),
    testFacadeBypasses: bypasses.filter(({ fromTest }) => fromTest).map(crossing),
    newCrossProductDependencies: newEdges.map((edge) => ({ ...edge, declared: tach.declares(edge.from, edge.to) })),
    newCycles: oneEdgePerCycle(newEdges.filter((edge) => onSharedCycle(edge, patchedGraph) && !onSharedCycle(edge, baseGraph)), patchedGraph),
    newUnresolvedImports: newUnresolved(base, patched, new Set(changedFiles)),
  };
}

export function newImports(base: IndexView, patched: IndexView, renames: Map<string, string> = new Map()): FileImport[] {
  const renamed = (path: string) => renames.get(path) ?? path;
  const existing = new Set(base.imports.map(({ from, to }) => pairKey(renamed(from), renamed(to))));
  return patched.imports.filter(({ from, to }) => !existing.has(pairKey(from, to)));
}

export function isFacadeBypass({ from, to }: { from: string; to: string }): boolean {
  const product = /^products\/([^/]+)\/backend\//.exec(to)?.[1];
  if (!product || from.startsWith(`products/${product}/`)) return false;
  const backend = `products/${product}/backend/`;
  return !to.startsWith(`${backend}facade/`) && to !== `${backend}routes.py`;
}

function crossing({ from, to }: FileImport): Crossing {
  return { from, to };
}

type Graph = { edges: Map<string, ModuleEdge>; successors: Map<string, Set<string>> };

function tachGraph(view: IndexView, tach: TachConfig): Graph {
  const graph: Graph = { edges: new Map(), successors: new Map() };
  for (const { from, to, fromTest } of view.imports) {
    if (fromTest || !isPython(from) || !isPython(to)) continue;
    const edge = { from: tach.moduleOf(from), to: tach.moduleOf(to) };
    if (edge.from === edge.to) continue;
    graph.edges.set(pairKey(edge.from, edge.to), edge);
    graph.successors.set(edge.from, (graph.successors.get(edge.from) ?? new Set()).add(edge.to));
  }
  return graph;
}

function onSharedCycle({ from, to }: ModuleEdge, graph: Graph): boolean {
  return reaches(graph, from, to) && reaches(graph, to, from);
}

function oneEdgePerCycle(edges: ModuleEdge[], graph: Graph): ModuleEdge[] {
  const cycles = new Map<string, ModuleEdge>();
  for (const edge of edges) {
    const cycle = cycleMembers(graph, edge.from).join("\0");
    if (!cycles.has(cycle)) cycles.set(cycle, edge);
  }
  return [...cycles.values()];
}

function cycleMembers(graph: Graph, module: string): string[] {
  const modules = new Set([...graph.successors.keys(), ...[...graph.successors.values()].flatMap((next) => [...next])]);
  return [...modules].filter((other) => reaches(graph, module, other) && reaches(graph, other, module)).sort();
}

function isPython(path: string): boolean {
  return path.endsWith(".py");
}

function reaches(graph: Graph, start: string, goal: string): boolean {
  const seen = new Set([start]);
  const queue = [start];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (next === goal) return true;
    for (const successor of graph.successors.get(next) ?? []) {
      if (!seen.has(successor)) {
        seen.add(successor);
        queue.push(successor);
      }
    }
  }
  return false;
}

function newUnresolved(base: IndexView, patched: IndexView, changed: Set<string>): UnresolvedImport[] {
  const existing = new Set(base.unresolved.map(({ file, specifier }) => pairKey(file, specifier)));
  const seen = new Set<string>();
  return patched.unresolved.filter(({ file, specifier }) => {
    const key = pairKey(file, specifier);
    if (!changed.has(file) || existing.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
