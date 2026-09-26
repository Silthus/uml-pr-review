import type { ModuleTree } from "./module-tree.ts";

export type FileEdge = { from: number; to: number; kind: string };

export type ModuleEdge = { from: number; to: number; count: number };

export function visibleModuleOfFile(tree: ModuleTree, fileModules: Int32Array, expanded: Set<number>): Int32Array {
  const visibleByModule = new Int32Array(tree.modules.length).fill(-1);
  const visibleOf = (module: number): number => {
    const cached = visibleByModule[module]!;
    if (cached !== -1) return cached;
    const parent = tree.modules[module]!.parent;
    const visible = parent === null || (expanded.has(parent) && visibleOf(parent) === parent) ? module : visibleOf(parent);
    visibleByModule[module] = visible;
    return visible;
  };
  const result = new Int32Array(fileModules.length);
  for (let file = 0; file < fileModules.length; file++) result[file] = visibleOf(fileModules[file]!);
  return result;
}

export function liftEdges(tree: ModuleTree, fileModules: Int32Array, edges: FileEdge[], expanded: Set<number>): ModuleEdge[] {
  const visible = visibleModuleOfFile(tree, fileModules, expanded);
  const counts = new Map<number, number>();
  const moduleCount = tree.modules.length;
  for (const edge of edges) {
    const from = visible[edge.from]!;
    const to = visible[edge.to]!;
    if (from === to) continue;
    const key = from * moduleCount + to;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => ({ from: Math.floor(key / moduleCount), to: key % moduleCount, count }));
}

export function siblingEdges(tree: ModuleTree, fileModules: Int32Array, edges: FileEdge[], parent: number): ModuleEdge[] {
  const expanded = new Set(tree.ancestry(parent));
  const children = new Set(tree.modules[parent]!.children);
  return liftEdges(tree, fileModules, edges, expanded)
    .filter((edge) => children.has(edge.from) && children.has(edge.to))
    .sort((a, b) => b.count - a.count);
}
