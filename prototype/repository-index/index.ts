import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { ModuleResolver } from "../../src/analyzer/modules.ts";
import { languageOf } from "../../src/analyzer/parser.ts";
import { isTestPath } from "../../src/analyzer/extract.ts";
import { liftEdges, siblingEdges, type FileEdge } from "./aggregate.ts";
import { ExtractionCache, extractBlobs, type Extracted } from "./extraction.ts";
import { gitText, listTreeEntries, readBlobsBySha } from "./git-objects.ts";
import type { ImportKind, ImportRef } from "./imports.ts";
import { isTreeSource, ModuleTree, languageOfPath } from "./module-tree.ts";
import { RepositoryResolver, type Resolution } from "./resolver.ts";

const { values: args } = parseArgs({
  options: {
    repo: { type: "string", default: `${process.env.HOME}/dev/posthog` },
    tree: { type: "string", default: "HEAD" },
    mode: { type: "string", default: "imports" },
    workers: { type: "string", default: String(navigator.hardwareConcurrency) },
    cache: { type: "string", default: "none" },
    label: { type: "string", default: "run" },
    analyze: { type: "boolean", default: false },
    out: { type: "string", default: new URL("./out/", import.meta.url).pathname },
  },
});

const outDir = args.out!;
mkdirSync(`${outDir}/runs`, { recursive: true });
const memory = { peakRss: 0 };
const sampler = setInterval(() => (memory.peakRss = Math.max(memory.peakRss, process.memoryUsage().rss)), 25);
const timings: Record<string, number> = {};
const time = async <T>(name: string, work: () => Promise<T> | T): Promise<T> => {
  const start = performance.now();
  const result = await work();
  timings[name] = Math.round(performance.now() - start);
  return result;
};

const repoDir = args.repo!;
const commit = (await gitText(repoDir, ["rev-parse", args.tree!])).trim();
const entries = await time("listTree", () => listTreeEntries(repoDir, commit));
const sourceEntries = entries.filter((entry) => languageOf(entry.path) && entry.mode !== "120000");
const cache = args.cache === "none" ? null : new ExtractionCache(args.cache!, `${args.mode}-v1`);
const { bySha, stats } = await time("extract", () =>
  extractBlobs({ repoDir, files: sourceEntries, mode: args.mode as "imports" | "v1", workers: Number(args.workers), cache }),
);
cache?.close();

const report: Record<string, unknown> = {
  label: args.label,
  commit,
  mode: args.mode,
  workers: Number(args.workers),
  cache: args.cache,
  trackedFiles: entries.length,
  sourceFiles: sourceEntries.length,
  extraction: stats,
};

if (args.analyze) Object.assign(report, await analyze());

clearInterval(sampler);
report.timingsMs = timings;
report.peakRssMb = Math.round(memory.peakRss / 1e6);
writeFileSync(`${outDir}/runs/${args.label}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ label: args.label, timingsMs: timings, peakRssMb: report.peakRssMb, extraction: stats }, null, 2));

async function analyze(): Promise<Record<string, unknown>> {
  const allPaths = entries.map((entry) => entry.path);
  const shaByPath = new Map(entries.map((entry) => [entry.path, entry.sha]));
  const configPaths = allPaths.filter((path) => /(^|\/)(tsconfig\.json|package\.json)$/.test(path) && !path.includes("node_modules/"));
  const configBlobs = await readBlobsBySha(repoDir, configPaths.map((path) => shaByPath.get(path)!));
  const readText = (path: string) => configBlobs.get(shaByPath.get(path) ?? "");

  const resolver = await time("resolverSetup", () => new RepositoryResolver(allPaths, readText));
  const v1Resolver = new ModuleResolver(allPaths);
  const tree = await time("moduleTree", () => new ModuleTree(allPaths));

  const treeFiles = allPaths.filter(isTreeSource);
  const fileIndex = new Map(treeFiles.map((path, index) => [path, index]));
  const fileModules = Int32Array.from(treeFiles, (path) => tree.moduleOf(path));

  const resolution = newResolutionStats();
  const edgeKinds = new Map<number, ImportKind>();
  const moduleTargets = new Map<string, number>();
  await time("resolve", () => {
    for (const entry of sourceEntries) {
      const from = fileIndex.get(entry.path);
      const refs: Extracted | undefined = bySha.get(entry.sha);
      if (from === undefined || !refs) continue;
      for (const ref of refs) {
        const result = resolver.resolve(entry.path, ref);
        record(resolution, entry.path, ref, result, v1Resolver);
        if (result.status !== "internal") continue;
        for (const target of result.targets) {
          const to = fileIndex.get(target);
          if (to === undefined) {
            moduleTargets.set(target, (moduleTargets.get(target) ?? 0) + 1);
            continue;
          }
          if (to === from) continue;
          const key = from * treeFiles.length + to;
          const previous = edgeKinds.get(key);
          if (!previous || kindRank(ref.kind) < kindRank(previous)) edgeKinds.set(key, ref.kind);
        }
      }
    }
  });
  const edges: FileEdge[] = [...edgeKinds].map(([key, kind]) => ({ from: Math.floor(key / treeFiles.length), to: key % treeFiles.length, kind }));

  const topLevel = tree.modules[0]!.children;
  const productsModule = tree.modules.findIndex((module) => module.id === "products");
  const errorTracking = tree.modules.findIndex((module) => module.id === "products/error_tracking");
  const expandedView = new Set([0, productsModule, ...topLevel]);
  const aggregationRuns = Array.from({ length: 20 }, () => {
    const start = performance.now();
    const lifted = liftEdges(tree, fileModules, edges, expandedView);
    return { ms: performance.now() - start, edges: lifted.length };
  });
  const describeModule = (index: number) => {
    const module = tree.modules[index]!;
    return { id: module.id, label: module.label, kind: module.kind, files: module.totalFiles, children: module.children.length };
  };
  const namedEdges = (list: { from: number; to: number; count: number }[], limit: number) =>
    list.slice(0, limit).map((edge) => `${tree.modules[edge.from]!.label} -> ${tree.modules[edge.to]!.label}: ${edge.count}`);

  writeArchitecture(tree, treeFiles, fileModules, edges);
  return {
    resolution: summarize(resolution),
    moduleDirectoryTargets: [...moduleTargets].sort((a, b) => b[1] - a[1]).slice(0, 10),
    graph: {
      treeFiles: treeFiles.length,
      modules: tree.modules.length,
      fileEdges: edges.length,
      edgesFromTestFiles: edges.filter((edge) => isTestPath(treeFiles[edge.from]!)).length,
      edgeKinds: countBy(edges.map((edge) => edge.kind)),
      edgesByLanguage: countBy(edges.map((edge) => `${languageOfPath(treeFiles[edge.from]!)}->${languageOfPath(treeFiles[edge.to]!)}`)),
    },
    tree: {
      kinds: countBy(tree.modules.map((module) => module.kind)),
      depthHistogram: countBy(tree.modules.map((_, index) => String(tree.ancestry(index).length - 1))),
      widestModules: tree.modules
        .map((module, index) => ({ index, width: module.children.length }))
        .sort((a, b) => b.width - a.width)
        .slice(0, 8)
        .map(({ index, width }) => `${tree.modules[index]!.id} (${width} children)`),
      topLevel: topLevel.map((index) => ({ ...describeModule(index), childModules: tree.modules[index]!.children.slice(0, 40).map((child) => `${tree.modules[child]!.label} [${tree.modules[child]!.kind}, ${tree.modules[child]!.totalFiles}]`) })),
      topLevelSiblingEdges: namedEdges(siblingEdges(tree, fileModules, edges, 0), 40),
      productsSiblingEdgeCount: siblingEdges(tree, fileModules, edges, productsModule).length,
      productsSiblingEdgesTop: namedEdges(siblingEdges(tree, fileModules, edges, productsModule), 30),
      errorTracking: {
        ...describeModule(errorTracking),
        children: tree.modules[errorTracking]!.children.map(describeModule),
        siblingEdges: namedEdges(siblingEdges(tree, fileModules, edges, errorTracking), 40),
        layerSiblingEdges: Object.fromEntries(
          tree.modules[errorTracking]!.children.map((child) => [tree.modules[child]!.label, namedEdges(siblingEdges(tree, fileModules, edges, child), 30)]),
        ),
        outgoingProducts: namedEdges(
          liftEdges(tree, fileModules, edges, new Set([0, productsModule, ...topLevel])).filter((edge) => tree.modules[edge.from]!.id === "products/error_tracking").sort((a, b) => b.count - a.count),
          25,
        ),
        incomingProducts: namedEdges(
          liftEdges(tree, fileModules, edges, new Set([0, productsModule, ...topLevel])).filter((edge) => tree.modules[edge.to]!.id === "products/error_tracking").sort((a, b) => b.count - a.count),
          25,
        ),
        grandchildren: tree.modules[errorTracking]!.children.flatMap((child) =>
          tree.modules[child]!.children.map((grandchild) => `${tree.modules[child]!.label}/${tree.modules[grandchild]!.label} [${tree.modules[grandchild]!.kind}, ${tree.modules[grandchild]!.totalFiles}]`),
        ),
      },
    },
    aggregation: {
      visibleModules: [...expandedView].reduce((sum, index) => sum + tree.modules[index]!.children.length, 0),
      liftedEdges: aggregationRuns[0]!.edges,
      firstMs: round(aggregationRuns[0]!.ms),
      medianMs: round(aggregationRuns.map((run) => run.ms).sort((a, b) => a - b)[10]!),
    },
    tach: await compareWithTach(tree, fileModules, edges, treeFiles),
  };
}

type ResolutionStats = {
  byFamily: Map<string, Record<Resolution["status"], number> & { v1Hit: number }>;
  unresolvedShapes: Map<string, { count: number; example: string }>;
  externalHeads: Map<string, number>;
  v1: { agree: number; disagree: number; resolvedExternal: number; disagreeExamples: string[]; externalExamples: string[] };
};

function newResolutionStats(): ResolutionStats {
  return {
    byFamily: new Map(),
    unresolvedShapes: new Map(),
    externalHeads: new Map(),
    v1: { agree: 0, disagree: 0, resolvedExternal: 0, disagreeExamples: [], externalExamples: [] },
  };
}

function record(stats: ResolutionStats, path: string, ref: ImportRef, result: Resolution, v1: ModuleResolver) {
  const language = languageOf(path)!;
  const family = familyOf(language === "python" ? "python" : "script", ref.specifier);
  const bucket = stats.byFamily.get(family) ?? { internal: 0, asset: 0, external: 0, unresolved: 0, v1Hit: 0 };
  stats.byFamily.set(family, bucket);
  bucket[result.status]++;
  const v1Target = v1.resolve(path, language, ref.specifier);
  if (v1Target) bucket.v1Hit++;
  if (result.status === "external" && v1Target) {
    stats.v1.resolvedExternal++;
    if (stats.v1.externalExamples.length < 8) stats.v1.externalExamples.push(`${path}: ${ref.specifier} -> ${v1Target}`);
  }
  if ((result.status === "internal" || result.status === "asset") && v1Target) {
    if (result.targets.includes(v1Target) || language === "python") stats.v1.agree++;
    else {
      stats.v1.disagree++;
      if (stats.v1.disagreeExamples.length < 8) stats.v1.disagreeExamples.push(`${path}: ${ref.specifier} -> v1 ${v1Target}, new ${result.targets[0]}`);
    }
  }
  if (result.status === "external") {
    const head = language === "python" ? `py ${ref.specifier.split(".")[0]}` : `ts ${ref.specifier.split("/").slice(0, ref.specifier.startsWith("@") ? 2 : 1).join("/")}`;
    stats.externalHeads.set(head, (stats.externalHeads.get(head) ?? 0) + 1);
  }
  if (result.status === "unresolved") {
    const key = `${language === "python" ? "py" : "ts"} ${result.shape}`;
    const shape = stats.unresolvedShapes.get(key) ?? { count: 0, example: `${path}: ${ref.specifier}` };
    shape.count++;
    stats.unresolvedShapes.set(key, shape);
  }
}

function familyOf(language: "python" | "script", specifier: string): string {
  if (language === "python") {
    if (specifier.startsWith(".")) return "py relative";
    const head = specifier.split(".")[0]!;
    return ["posthog", "ee", "products", "common"].includes(head) ? `py ${head}.*` : "py other";
  }
  if (specifier.startsWith(".")) return "ts relative";
  const aliasPrefixes = ["scenes/", "lib/", "~/", "products/", "@posthog/", "@common/", "queries/", "layout/", "storybook/", "public/"];
  const prefix = aliasPrefixes.find((candidate) => specifier.startsWith(candidate));
  return prefix ? `ts ${prefix}*` : "ts other";
}

function summarize(stats: ResolutionStats) {
  const families = Object.fromEntries(
    [...stats.byFamily].sort().map(([family, bucket]) => {
      const inRepo = bucket.internal + bucket.asset + bucket.unresolved;
      return [family, { ...bucket, resolvedRate: inRepo === 0 ? null : round((bucket.internal + bucket.asset) / inRepo, 4) }];
    }),
  );
  const totals = [...stats.byFamily.values()].reduce(
    (sum, bucket) => ({
      internal: sum.internal + bucket.internal,
      asset: sum.asset + bucket.asset,
      external: sum.external + bucket.external,
      unresolved: sum.unresolved + bucket.unresolved,
    }),
    { internal: 0, asset: 0, external: 0, unresolved: 0 },
  );
  return {
    totals: { ...totals, resolvedRate: round((totals.internal + totals.asset) / (totals.internal + totals.asset + totals.unresolved), 4) },
    families,
    topUnresolvedShapes: [...stats.unresolvedShapes].sort((a, b) => b[1].count - a[1].count).slice(0, 25).map(([shape, value]) => ({ shape, ...value })),
    v1Comparison: stats.v1,
    topExternalHeads: [...stats.externalHeads].sort((a, b) => b[1] - a[1]).slice(0, 60),
  };
}

async function compareWithTach(tree: ModuleTree, fileModules: Int32Array, edges: FileEdge[], treeFiles: string[]) {
  const tachSha = (await gitText(repoDir, ["rev-parse", `${commit}:tach.toml`]).catch(() => "")).trim();
  if (!tachSha) return null;
  const tach = Bun.TOML.parse((await readBlobsBySha(repoDir, [tachSha])).get(tachSha)!) as {
    modules: { path: string; utility?: boolean; depends_on?: (string | { path: string })[] }[];
    exclude?: string[];
  };
  const declared = new Map(tach.modules.map((module) => [module.path, new Set((module.depends_on ?? []).map((dependency) => (typeof dependency === "string" ? dependency : dependency.path)))]));
  const utilities = new Set(tach.modules.filter((module) => module.utility).map((module) => module.path));
  const tachModuleOf = (path: string): string | null => {
    const dotted = path.replace(/\.py$/, "").replaceAll("/", ".");
    let best: string | null = null;
    for (const candidate of declared.keys()) {
      if ((dotted === candidate || dotted.startsWith(`${candidate}.`)) && (!best || candidate.length > best.length)) best = candidate;
    }
    return best;
  };
  const isTest = (path: string) => /(^|\/)(tests?|__tests__)\//.test(path) || /(^|\/)(test_[^/]*|conftest|[^/]*_test)\.py$/.test(path);
  const isExcluded = (path: string) => /^products\/[^/]+\/evals\//.test(path) || path.startsWith("products/posthog_ai/eval_harness/");
  const observed = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = treeFiles[edge.from]!;
    const to = treeFiles[edge.to]!;
    if (!from.endsWith(".py") || !to.endsWith(".py") || isTest(from) || isExcluded(from)) continue;
    const source = tachModuleOf(from);
    const target = tachModuleOf(to);
    if (!source || !target || source === target || target === "<root>" || utilities.has(target)) continue;
    const set = observed.get(source) ?? new Set();
    set.add(target);
    observed.set(source, set);
  }
  let declaredPairs = 0;
  let observedPairs = 0;
  let observedAndDeclared = 0;
  const undeclared: string[] = [];
  for (const targets of declared.values()) declaredPairs += targets.size;
  for (const [source, targets] of observed) {
    for (const target of targets) {
      observedPairs++;
      if (declared.get(source)?.has(target)) observedAndDeclared++;
      else undeclared.push(`${source} -> ${target}`);
    }
  }
  void fileModules;
  void tree;
  return {
    tachModules: declared.size,
    declaredPairs,
    observedPairs,
    observedAndDeclared,
    declaredButUnobserved: declaredPairs - observedAndDeclared,
    undeclaredObserved: undeclared.length,
    undeclaredExamples: undeclared.slice(0, 15),
  };
}

function writeArchitecture(tree: ModuleTree, treeFiles: string[], fileModules: Int32Array, edges: FileEdge[]) {
  const kinds: ImportKind[] = ["static", "type", "lazy", "reexport", "dynamic", "require"];
  const architecture = {
    format: "uml-pr-review/architecture@prototype",
    repository: posix.basename(repoDir),
    commit,
    legend: {
      module: ["id", "label", "parent", "kind", "directFiles", "totalFiles"],
      file: ["path", "module", "language"],
      edge: ["fromFile", "toFile", "kind"],
      edgeKinds: kinds,
    },
    modules: tree.modules.map((module) => [module.id, module.label, module.parent, module.kind, module.directFiles, module.totalFiles]),
    files: treeFiles.map((path, index) => [path, fileModules[index], languageOfPath(path)]),
    edges: edges.map((edge) => [edge.from, edge.to, kinds.indexOf(edge.kind as ImportKind)]),
  };
  const json = JSON.stringify(architecture);
  writeFileSync(`${outDir}/posthog-architecture.json`, json);
  timings.architectureJsonBytes = json.length;
}

function kindRank(kind: ImportKind): number {
  return ["static", "reexport", "dynamic", "require", "lazy", "type"].indexOf(kind);
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}
