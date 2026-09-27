import type { ArchitecturePayload, ImportKind } from "../../src/architecture/contracts/index.ts";

export type Import = { from: string; to: string; kind: ImportKind; line: number; fromTest: boolean };

export type ImportGraph = { imports: Import[]; importsFrom(path: string): Import[]; componentOf(path: string): number | undefined; componentSize(component: number): number };

const eagerKinds = new Set<ImportKind>(["static", "reexport", "require"]);

export function importGraphOf(payload: ArchitecturePayload): ImportGraph {
  const paths = payload.files.map(([path]) => path);
  const tests = new Set(payload.files.flatMap(([path, , , role]) => (role === "test" ? [path] : [])));
  const imports = payload.imports.map(([from, to, kind, line]): Import => ({ from: paths[from]!, to: paths[to]!, kind, line, fromTest: tests.has(paths[from]!) }));
  const byFile = Map.groupBy(imports, ({ from }) => from);
  const components = stronglyConnected(imports.filter(({ kind, fromTest }) => eagerKinds.has(kind) && !fromTest));
  return {
    imports,
    importsFrom: (path) => byFile.get(path) ?? [],
    componentOf: (path) => components.componentOf.get(path),
    componentSize: (component) => components.sizes[component] ?? 0,
  };
}

export function isOnCycle(graph: ImportGraph, { from, to, kind, fromTest }: Import): boolean {
  if (!eagerKinds.has(kind) || fromTest) return false;
  const component = graph.componentOf(from);
  return component !== undefined && component === graph.componentOf(to) && graph.componentSize(component) > 1;
}

function stronglyConnected(edges: Pick<Import, "from" | "to">[]): { componentOf: Map<string, number>; sizes: number[] } {
  const successors = new Map<string, string[]>();
  for (const { from, to } of edges) successors.set(from, [...(successors.get(from) ?? []), to]);
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const componentOf = new Map<string, number>();
  const sizes: number[] = [];
  let counter = 0;
  for (const root of successors.keys()) {
    if (order.has(root)) continue;
    const frames: { node: string; next: number }[] = [{ node: root, next: 0 }];
    order.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (frames.length > 0) {
      const frame = frames.at(-1)!;
      const next = (successors.get(frame.node) ?? [])[frame.next++];
      if (next !== undefined) {
        if (!order.has(next)) {
          order.set(next, counter);
          low.set(next, counter++);
          stack.push(next);
          onStack.add(next);
          frames.push({ node: next, next: 0 });
        } else if (onStack.has(next)) low.set(frame.node, Math.min(low.get(frame.node)!, order.get(next)!));
        continue;
      }
      frames.pop();
      const parent = frames.at(-1);
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) !== order.get(frame.node)) continue;
      const component = sizes.length;
      let size = 0;
      for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
        onStack.delete(member);
        componentOf.set(member, component);
        size++;
        if (member === frame.node) break;
      }
      sizes.push(size);
    }
  }
  return { componentOf, sizes };
}
