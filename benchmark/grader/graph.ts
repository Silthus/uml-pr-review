import type { ArchitecturePayload, ImportKind } from "../../src/architecture/contracts/index.ts";

export type Import = { from: string; to: string; kind: ImportKind; line: number; fromTest: boolean };

export type ImportGraph = { imports: Import[]; importsFrom(path: string): Import[]; cycleThrough(entry: Import, maxLength: number): string[] | undefined };

const dependencyKinds = new Set<ImportKind>(["static", "reexport", "require"]);

export function importGraphOf(payload: ArchitecturePayload): ImportGraph {
  const paths = payload.files.map(([path]) => path);
  const tests = new Set(payload.files.flatMap(([path, , , role]) => (role === "test" ? [path] : [])));
  const imports = payload.imports.map(([from, to, kind, line]): Import => ({ from: paths[from]!, to: paths[to]!, kind, line, fromTest: tests.has(paths[from]!) }));
  const byFile = Map.groupBy(imports, ({ from }) => from);
  const successors = new Map<string, string[]>();
  for (const entry of imports.filter(isDependency)) {
    const next = successors.get(entry.from);
    if (next) next.push(entry.to);
    else successors.set(entry.from, [entry.to]);
  }
  return {
    imports,
    importsFrom: (path) => byFile.get(path) ?? [],
    cycleThrough: (entry, maxLength) => (isDependency(entry) && entry.from !== entry.to ? shortestPath(successors, entry.to, entry.from, maxLength - 1) : undefined),
  };
}

function isDependency({ kind, fromTest }: Import): boolean {
  return dependencyKinds.has(kind) && !fromTest;
}

function shortestPath(successors: Map<string, string[]>, start: string, goal: string, maxEdges: number): string[] | undefined {
  const previous = new Map<string, string>([[start, start]]);
  let frontier = [start];
  for (let depth = 0; depth < maxEdges && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const successor of successors.get(node) ?? []) {
        if (previous.has(successor)) continue;
        previous.set(successor, node);
        if (successor === goal) return pathTo(previous, start, goal);
        next.push(successor);
      }
    }
    frontier = next;
  }
  return undefined;
}

function pathTo(previous: Map<string, string>, start: string, goal: string): string[] {
  const path = [goal];
  for (let node = goal; node !== start; node = previous.get(node)!) path.unshift(previous.get(node)!);
  return path;
}
