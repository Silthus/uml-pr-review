import { isFacadeBypass } from "../benchmark/lib/boundary.ts";
import type { TachConfig } from "../benchmark/lib/tach.ts";
import type { ArchitecturePayload } from "../src/architecture/contracts/index.ts";
import { ArchitectureModel } from "../src/architecture/model/index.ts";
import type { Architecture, Measure, ModuleCoupling } from "./contract.ts";
import { compare, topFiles } from "./drivers.ts";
import { moduleChain, totalLines, unmeasuredModules, type Scope } from "./scope.ts";
import { anchors, dimensionScore, measure, ratio, roundTo } from "./score.ts";

type FileImport = { from: string; to: string; typeOnly: boolean };
type FileGraph = Map<string, Set<string>>;
type Direction = "inbound" | "outbound";

const productBackend = /^products\/([^/]+)\/backend\//;

export function measureArchitecture(payload: ArchitecturePayload, scope: Scope, tach: TachConfig | null): Architecture {
  const imports = productionImports(payload);
  const runtime = imports.filter(({ typeOnly }) => !typeOnly);
  const internal = fileGraph(runtime.filter(({ from, to }) => scope.isMeasured(from) && scope.isMeasured(to)));
  const outboundFiles = new Set(runtime.filter(({ from, to }) => scope.isMeasured(from) && !scope.isWithin(to)).map(({ to }) => to));
  const propagationCost = propagationCostOf(scope, internal, outboundFiles.size);
  const cycles = cyclesOf(scope, internal);
  const facade = facadeOf(imports, scope);
  const measures = architectureMeasures({ propagationCost, cycles, facade }, totalLines(scope.production));
  return {
    score: dimensionScore(measures),
    measures,
    propagationCost,
    cycles,
    facade,
    undeclaredDependencies: tach === null ? null : undeclaredDependencies(imports, scope, tach),
    modules: couplingOf(payload, scope),
  };
}

export function architectureMeasures(
  { propagationCost, cycles, facade }: Pick<Architecture, "propagationCost" | "cycles" | "facade">,
  productionLines: number,
): Record<"propagationCost" | "cycleShare" | "facadeBypassesPerKloc", Measure> {
  return {
    propagationCost: measure(propagationCost.value, anchors.propagationCost),
    cycleShare: measure(ratio(cycles.files.length, propagationCost.files), anchors.cycleShare),
    facadeBypassesPerKloc: measure(perKloc(facade.bypasses.length, productionLines), anchors.facadeBypassesPerKloc),
  };
}

function perKloc(count: number, lines: number): number | null {
  return lines === 0 ? null : (1000 * count) / lines;
}

function productionImports(payload: ArchitecturePayload): FileImport[] {
  const unmeasured = unmeasuredModules(payload);
  const counted = payload.files.map(([, module, , role]) => role === "production" && unmeasured[module] === 0);
  const pairs = new Map<string, FileImport>();
  for (const [from, to, kind] of payload.imports) {
    if (from === to || !counted[from] || !counted[to]) continue;
    const key = `${from}\0${to}`;
    const typeOnly = kind === "type" && (pairs.get(key)?.typeOnly ?? true);
    pairs.set(key, { from: payload.files[from]![0], to: payload.files[to]![0], typeOnly });
  }
  return [...pairs.values()];
}

function fileGraph(imports: FileImport[]): FileGraph {
  const graph: FileGraph = new Map();
  for (const { from, to } of imports) graph.set(from, (graph.get(from) ?? new Set()).add(to));
  return graph;
}

function propagationCostOf(scope: Scope, internal: FileGraph, outboundFiles: number): Architecture["propagationCost"] {
  const files = scope.production.length;
  const reach = scope.production.map(({ path }): [string, number] => [path, reachableFrom(path, internal).size]);
  const totalReach = reach.reduce((total, [, reached]) => total + reached, 0);
  const value = files <= 1 ? 0 : roundTo(totalReach / files / (files - 1), 4);
  return { value, files, outboundFiles, drivers: topFiles(reach) };
}

function reachableFrom(start: string, graph: FileGraph): Set<string> {
  const reached = new Set<string>();
  const pending = [start];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    for (const target of graph.get(file) ?? []) {
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
  const popComponent = (root: string) => {
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== root);
    components.push(component);
  };
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
    if (lowLink.get(node) === order.get(node)) popComponent(node);
  };
  for (const node of nodes) if (!order.has(node)) visit(node);
  return components;
}

function facadeOf(imports: FileImport[], scope: Scope): Architecture["facade"] {
  const crossings = imports.filter(({ from, to }) => scope.isWithin(from) !== scope.isWithin(to) && crossesIntoProductBackend(from, to));
  const bypasses = crossings
    .filter(isFacadeBypass)
    .map(({ from, to }) => ({ from, to, direction: (scope.isWithin(from) ? "outbound" : "inbound") as Direction }))
    .sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));
  const countOf = (direction: Direction) => ({
    crossings: crossings.filter(({ from }) => scope.isWithin(from) === (direction === "outbound")).length,
    bypasses: bypasses.filter((bypass) => bypass.direction === direction).length,
  });
  return {
    crossings: crossings.length,
    inbound: countOf("inbound"),
    outbound: countOf("outbound"),
    bypasses,
  };
}

function crossesIntoProductBackend(from: string, to: string): boolean {
  const product = productBackend.exec(to)?.[1];
  return product !== undefined && !from.startsWith(`products/${product}/`);
}

function undeclaredDependencies(imports: FileImport[], scope: Scope, tach: TachConfig): Architecture["undeclaredDependencies"] {
  const pairs = new Map<string, { from: string; to: string }>();
  for (const { from, to } of imports) {
    if (scope.isWithin(from) === scope.isWithin(to) || !from.endsWith(".py") || !to.endsWith(".py")) continue;
    const dependency = { from: tach.moduleOf(from), to: tach.moduleOf(to) };
    if (dependency.from !== dependency.to && !tach.declares(dependency.from, dependency.to)) pairs.set(`${dependency.from}\0${dependency.to}`, dependency);
  }
  return [...pairs.values()].sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));
}

function couplingOf(payload: ArchitecturePayload, scope: Scope): ModuleCoupling[] {
  const model = new ArchitectureModel(payload);
  const moduleOfFile = new Map(payload.files.map(([path, module]) => [path, module]));
  const modulesHolding = (file: string) => moduleChain(payload, moduleOfFile.get(file)!).map((module) => payload.modules[module]![0]);
  const modulePaths = new Set(scope.production.flatMap(({ path }) => modulesHolding(path).filter((module) => scope.isWithin(`${module}/`))));
  return [...modulePaths].sort(compare).map((path) => {
    const fanIn = model.dependencies(path, "in").length;
    const fanOut = model.dependencies(path, "out").length;
    return { path, fanIn, fanOut, instability: ratio(fanOut, fanIn + fanOut) };
  });
}
