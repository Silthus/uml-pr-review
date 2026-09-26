import { isFacadeBypass } from "../benchmark/lib/boundary.ts";
import type { ArchitecturePayload } from "../src/architecture/contracts/index.ts";
import { ArchitectureModel } from "../src/architecture/model/index.ts";
import type { Architecture, ModuleCoupling } from "./contract.ts";
import { compare, topFiles } from "./drivers.ts";
import { unmeasuredModules, type Scope } from "./scope.ts";
import { anchors, dimensionScore, measure, ratio, roundTo } from "./score.ts";

type FileImport = { from: string; to: string };
type FileGraph = Map<string, Set<string>>;

const productBackend = /^products\/([^/]+)\/backend\//;

export function measureArchitecture(payload: ArchitecturePayload, scope: Scope): Architecture {
  const imports = productionImports(payload);
  const internal = fileGraph(imports.filter(({ from, to }) => scope.isMeasured(from) && scope.isMeasured(to)));
  const outbound = fileGraph(imports.filter(({ from, to }) => scope.isMeasured(from) && !scope.isWithin(to)));
  const propagationCost = propagationCostOf(scope, internal, outbound);
  const cycles = cyclesOf(scope, internal);
  const facade = facadeOf(imports, scope);
  const measures = {
    propagationCost: measure(propagationCost.value, anchors.propagationCost),
    cycleShare: measure(ratio(cycles.files.length, scope.production.length), anchors.cycleShare),
    facadeShare: measure(facade.share, anchors.facadeShare),
  };
  return { score: dimensionScore(measures), measures, propagationCost, cycles, facade, modules: couplingOf(payload, scope) };
}

function productionImports(payload: ArchitecturePayload): FileImport[] {
  const unmeasured = unmeasuredModules(payload);
  const counted = payload.files.map(([, module, , role]) => role === "production" && unmeasured[module] === 0);
  const seen = new Set<string>();
  return payload.imports.flatMap(([from, to]) => {
    const key = `${from}\0${to}`;
    if (from === to || !counted[from] || !counted[to] || seen.has(key)) return [];
    seen.add(key);
    return [{ from: payload.files[from]![0], to: payload.files[to]![0] }];
  });
}

function fileGraph(imports: FileImport[]): FileGraph {
  const graph: FileGraph = new Map();
  for (const { from, to } of imports) graph.set(from, (graph.get(from) ?? new Set()).add(to));
  return graph;
}

function propagationCostOf(scope: Scope, internal: FileGraph, outbound: FileGraph): Architecture["propagationCost"] {
  const outboundFiles = new Set([...outbound.values()].flatMap((targets) => [...targets]));
  const nodes = scope.production.length + outboundFiles.size;
  const reach = scope.production.map(({ path }): [string, number] => [path, reachableFrom(path, internal, outbound).size]);
  const totalReach = reach.reduce((total, [, reached]) => total + reached, 0);
  const value = nodes <= 1 ? 0 : roundTo(totalReach / scope.production.length / (nodes - 1), 4);
  return { value, files: scope.production.length, outboundFiles: outboundFiles.size, drivers: topFiles(reach) };
}

function reachableFrom(start: string, internal: FileGraph, outbound: FileGraph): Set<string> {
  const reached = new Set<string>();
  const pending = [start];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    for (const target of outbound.get(file) ?? []) reached.add(target);
    for (const target of internal.get(file) ?? []) {
      if (reached.has(target) || target === start) continue;
      reached.add(target);
      pending.push(target);
    }
  }
  return reached;
}

function cyclesOf(scope: Scope, graph: FileGraph): Architecture["cycles"] {
  const components = stronglyConnectedComponents(scope.production.map(({ path }) => path), graph).filter((component) => component.length > 1);
  return { count: components.length, files: components.flat().sort(compare) };
}

function stronglyConnectedComponents(nodes: string[], graph: FileGraph): string[][] {
  const order = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (node: string) => {
    order.set(node, order.size);
    lowLink.set(node, order.get(node)!);
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!order.has(next)) {
        visit(next);
        lowLink.set(node, Math.min(lowLink.get(node)!, lowLink.get(next)!));
      } else if (onStack.has(next)) lowLink.set(node, Math.min(lowLink.get(node)!, order.get(next)!));
    }
    if (lowLink.get(node) !== order.get(node)) return;
    const component: string[] = [];
    for (let member = stack.pop()!; ; member = stack.pop()!) {
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    components.push(component);
  };
  for (const node of nodes) if (!order.has(node)) visit(node);
  return components;
}

function facadeOf(imports: FileImport[], scope: Scope): Architecture["facade"] {
  const crossings = imports.filter(({ from, to }) => scope.isWithin(from) !== scope.isWithin(to) && crossesIntoProductBackend(from, to));
  const bypasses = crossings.filter(isFacadeBypass).sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));
  return { crossings: crossings.length, share: ratio(crossings.length - bypasses.length, crossings.length), bypasses };
}

function crossesIntoProductBackend(from: string, to: string): boolean {
  const product = productBackend.exec(to)?.[1];
  return product !== undefined && !from.startsWith(`products/${product}/`);
}

function couplingOf(payload: ArchitecturePayload, scope: Scope): ModuleCoupling[] {
  const model = new ArchitectureModel(payload);
  const modulePaths = new Set(scope.production.flatMap(({ path }) => modulesHolding(model, path, scope)));
  return [...modulePaths].sort(compare).map((path) => {
    const fanIn = model.dependencies(path, "in").length;
    const fanOut = model.dependencies(path, "out").length;
    return { path, fanIn, fanOut, instability: ratio(fanOut, fanIn + fanOut) };
  });
}

function modulesHolding(model: ArchitectureModel, file: string, scope: Scope): string[] {
  const modules: string[] = [];
  for (let view = model.moduleOfFile(file); view && scope.isWithin(`${view.path}/`); view = view.parent === null ? undefined : model.module(view.parent)) modules.push(view.path);
  return modules;
}
