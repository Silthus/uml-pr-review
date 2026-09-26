import type { ArchitecturePayload } from "../../src/architecture/contracts/index.ts";
import { createRepositoryIndexer } from "../../src/architecture/index/index.ts";
import { measureArchitecture } from "../architecture.ts";
import { BlobCache } from "../blob-cache.ts";
import { measureComplexity } from "../complexity.ts";
import type { Architecture, Complexity } from "../contract.ts";
import { compare } from "../drivers.ts";
import { readScope, type Scope, type ScopeFile } from "../scope.ts";
import { measureTests } from "../tests.ts";
import { withToolbox } from "../tools.ts";

export type Crossing = Architecture["facade"]["bypasses"][number];

export type ModuleState = {
  path: string;
  files: string[];
  lines: number;
  complexity: Complexity;
  testedFiles: string[];
  untestedFiles: string[];
  uncoveredFacadeFunctions: string[];
  inboundBypasses: Crossing[];
  outboundBypasses: Crossing[];
  cycleFiles: string[];
};

export type ScopeModules = { root: string; commit: string; tree: string; scope: string; modules: ModuleState[]; moduleOf(path: string): string | undefined };

export async function measureModules(repository: string, scopePath: string, commit: string): Promise<ScopeModules> {
  const payload = await createRepositoryIndexer().index(repository, { commit });
  const scope = await readScope(payload.repository.root, payload, scopePath);
  const moduleOfFile = new Map(payload.files.map(([path, module]) => [path, payload.modules[module]![0]]));
  const owned = Map.groupBy(scope.production, ({ path }) => moduleOfFile.get(path)!);
  const architecture = measureArchitecture(payload, scope, null);
  const uncoveredFacadeFunctions = measureTests(payload, scope).facadeCoverage.uncovered;
  const tested = testedFiles(payload);
  const complexities = await complexityPerModule(repository, payload, scope, owned);
  const modules = [...owned].map(([path, files]): ModuleState => {
    const paths = files.map(({ path: file }) => file);
    const holds = (file: string) => paths.includes(file);
    return {
      path,
      files: paths,
      lines: files.reduce((total, { lines }) => total + lines, 0),
      complexity: complexities.get(path)!,
      testedFiles: paths.filter((file) => tested.has(file)),
      untestedFiles: paths.filter((file) => !tested.has(file)),
      uncoveredFacadeFunctions: uncoveredFacadeFunctions.filter((entry) => holds(entry.slice(0, entry.lastIndexOf(":")))),
      inboundBypasses: architecture.facade.bypasses.filter(({ to, direction }) => direction === "inbound" && holds(to)),
      outboundBypasses: architecture.facade.bypasses.filter(({ from, direction }) => direction === "outbound" && holds(from)),
      cycleFiles: architecture.cycles.files.filter(holds),
    };
  });
  const byDepth = modules.map(({ path }) => path).sort((a, b) => b.length - a.length || compare(a, b));
  return {
    root: payload.repository.root,
    commit: payload.commit ?? commit,
    tree: payload.tree,
    scope: scope.path,
    modules: modules.sort((a, b) => compare(a.path, b.path)),
    moduleOf: (file) => byDepth.find((module) => file === module || file.startsWith(`${module}/`)),
  };
}

function testedFiles(payload: ArchitecturePayload): Set<string> {
  return new Set(payload.imports.filter(([from]) => payload.files[from]![3] === "test").map(([, to]) => payload.files[to]![0]));
}

async function complexityPerModule(repository: string, payload: ArchitecturePayload, scope: Scope, owned: Map<string, ScopeFile[]>): Promise<Map<string, Complexity>> {
  const cache = new BlobCache(payload.repository.commonDir);
  try {
    return await withToolbox(repository, scope.production, async (toolbox) => {
      await measureComplexity(scope.production, toolbox, cache);
      const measured = new Map<string, Complexity>();
      for (const [module, files] of owned) measured.set(module, await measureComplexity(files, toolbox, cache));
      return measured;
    });
  } finally {
    cache.close();
  }
}
