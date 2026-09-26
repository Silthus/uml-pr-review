import type { Call, GraphFile, GraphSymbol, Import, Package } from "../graph.ts";
import type { FileDiff } from "../diff.ts";
import { filesContainingWords, readBlobs } from "../git.ts";
import { CallResolver, commonNames } from "./call-resolver.ts";
import { lineChangesOf, symbolChange, type LineChanges } from "./change.ts";
import { extractSourceFile, isTestPath } from "./extract.ts";
import { ModuleResolver } from "./modules.ts";
import { PackageIndex, packageFor } from "./packages.ts";
import { languageOf, sourcePathspecs } from "./parser.ts";
import { isTestStructure, type ExtractedSymbol, type SourceFile } from "./source-file.ts";

export const MAX_FILES_PER_CALLER_NAME = 120;
export const MAX_CALLER_FILES = 400;

export type AnalysisInput = {
  repoDir: string;
  repoName: string;
  headSha: string;
  paths: string[];
  diffs: FileDiff[];
};

export type Analysis = {
  packages: Package[];
  files: GraphFile[];
  symbols: GraphSymbol[];
  calls: Call[];
  imports: Import[];
  warnings: string[];
};

export async function analyze(input: AnalysisInput): Promise<Analysis> {
  return new PullRequestAnalysis(input).run();
}

class PullRequestAnalysis {
  private readonly sources = new Map<string, SourceFile>();
  private readonly changesByPath = new Map<string, LineChanges>();
  private readonly touchedIds = new Set<string>();
  private readonly warnings: string[] = [];
  private readonly modules: ModuleResolver;
  private readonly packages: PackageIndex;

  constructor(private readonly input: AnalysisInput) {
    this.modules = new ModuleResolver(input.paths);
    this.packages = new PackageIndex(input.paths);
  }

  async run(): Promise<Analysis> {
    const changedSources = this.input.diffs.filter((diff) => diff.status !== "deleted" && languageOf(diff.path));
    for (const diff of this.input.diffs) this.changesByPath.set(diff.path, lineChangesOf(diff.rows, diff.status === "added"));
    await this.load(changedSources.map((diff) => diff.path));
    this.markTouchedSymbols(changedSources.map((diff) => diff.path));

    const resolver = new CallResolver(this.modules, this.sources);
    const [callerFiles, calleeFiles] = await Promise.all([this.findCallerFiles(), this.calleeFilesNeeded(resolver)]);
    await this.load([...callerFiles, ...calleeFiles]);

    const calls = this.resolveCalls(resolver);
    const symbols = this.graphSymbols(calls);
    const files = this.graphFiles(symbols);
    return {
      packages: await this.graphPackages(files),
      files,
      symbols,
      calls,
      imports: this.graphImports(files),
      warnings: this.warnings,
    };
  }

  private async load(paths: string[]): Promise<void> {
    const pending = paths.filter((path) => !this.sources.has(path));
    const blobs = await readBlobs(this.input.repoDir, this.input.headSha, pending);
    for (const path of pending) {
      const source = blobs.get(path);
      const extracted = source === undefined ? null : await extractSourceFile(path, source);
      if (extracted) this.sources.set(path, extracted);
      else this.warnings.push(`Could not parse ${path}.`);
    }
  }

  private markTouchedSymbols(paths: string[]): void {
    for (const path of paths) {
      const source = this.sources.get(path);
      const changes = this.changesByPath.get(path);
      if (!source || !changes) continue;
      for (const symbol of source.symbols) {
        if (this.changeOf(source, symbol).change !== "unchanged") this.touchedIds.add(symbol.id);
      }
    }
  }

  private changeOf(source: SourceFile, symbol: ExtractedSymbol): Pick<GraphSymbol, "change" | "signatureChanged"> {
    const changes = this.changesByPath.get(source.path);
    if (!changes) return { change: "unchanged", signatureChanged: false };
    const members = source.symbols.filter((member) => member.parentId === symbol.id);
    return symbolChange(symbol, members, changes);
  }

  private touchedSymbols(): ExtractedSymbol[] {
    return [...this.sources.values()].flatMap((source) => source.symbols.filter((symbol) => this.touchedIds.has(symbol.id)));
  }

  private callerNames(): string[] {
    const names = new Set(
      this.touchedSymbols()
        .filter((symbol) => !isTestStructure(symbol.kind))
        .map((symbol) => symbol.name)
        .filter((name) => name.length >= 3 && !name.startsWith("__") && !commonNames.has(name)),
    );
    return [...names].sort();
  }

  private async findCallerFiles(): Promise<string[]> {
    const filesByName = await filesContainingWords(this.input.repoDir, this.input.headSha, this.callerNames(), sourcePathspecs);
    const files = new Set<string>();
    for (const [name, paths] of filesByName) {
      if (paths.size > MAX_FILES_PER_CALLER_NAME) {
        this.warnings.push(`Skipped callers of "${name}": the name appears in ${paths.size} files.`);
        continue;
      }
      for (const path of paths) files.add(path);
    }
    const sorted = [...files].sort();
    if (sorted.length > MAX_CALLER_FILES) {
      this.warnings.push(`Scanned the first ${MAX_CALLER_FILES} of ${sorted.length} files that mention touched names.`);
    }
    return sorted.slice(0, MAX_CALLER_FILES);
  }

  private async calleeFilesNeeded(resolver: CallResolver): Promise<string[]> {
    return [...this.sources.values()].flatMap((source) =>
      resolver.filesNeededFor(
        source,
        source.calls.filter((call) => this.touchedIds.has(call.ownerId)),
      ),
    );
  }

  private resolveCalls(resolver: CallResolver): Call[] {
    const touchedNames = new Set(this.touchedSymbols().map((symbol) => symbol.name));
    const sitesByEdge = new Map<string, { from: string; to: string; sites: Set<number> }>();
    for (const source of this.sources.values()) {
      for (const call of source.calls) {
        const ownerTouched = this.touchedIds.has(call.ownerId);
        if (!ownerTouched && !touchedNames.has(call.name)) continue;
        const target = resolver.resolve(source, call);
        if (!target || target.id === call.ownerId) continue;
        if (!ownerTouched && !this.touchedIds.has(target.id)) continue;
        const key = `${call.ownerId}\0${target.id}`;
        const edge = sitesByEdge.get(key) ?? { from: call.ownerId, to: target.id, sites: new Set<number>() };
        edge.sites.add(call.line);
        sitesByEdge.set(key, edge);
      }
    }
    return [...sitesByEdge.values()].map((edge) => ({ from: edge.from, to: edge.to, sites: [...edge.sites] }));
  }

  private graphSymbols(calls: Call[]): GraphSymbol[] {
    const hops = new Map<string, number>([...this.touchedIds].map((id) => [id, 0]));
    for (const call of calls) {
      for (const id of [call.from, call.to]) if (!hops.has(id)) hops.set(id, 1);
    }
    const symbolsById = new Map(
      [...this.sources.values()].flatMap((source) => source.symbols.map((symbol) => [symbol.id, { source, symbol }] as const)),
    );
    for (const [id, hop] of [...hops]) {
      let parentId = symbolsById.get(id)?.symbol.parentId;
      while (parentId) {
        hops.set(parentId, Math.min(hops.get(parentId) ?? hop, hop));
        parentId = symbolsById.get(parentId)?.symbol.parentId;
      }
    }
    return [...hops].flatMap(([id, hop]) => {
      const entry = symbolsById.get(id);
      if (!entry) return [];
      const { source, symbol } = entry;
      return [
        {
          id,
          file: source.path,
          name: symbol.name,
          kind: symbol.kind,
          ...(symbol.parentId ? { parentId: symbol.parentId } : {}),
          range: symbol.range,
          ...this.changeOf(source, symbol),
          hop,
        },
      ];
    });
  }

  private graphFiles(symbols: GraphSymbol[]): GraphFile[] {
    const diffsByPath = new Map(this.input.diffs.map((diff) => [diff.path, diff]));
    const paths = new Set([...diffsByPath.keys(), ...symbols.map((symbol) => symbol.file)]);
    return [...paths].map((path) => {
      const diff = diffsByPath.get(path);
      return {
        path,
        status: diff?.status ?? "unchanged",
        ...(diff?.previousPath ? { previousPath: diff.previousPath } : {}),
        role: isTestPath(path) ? "test" : "production",
        package: this.packages.rootOf(path),
        diff: diff?.rows ?? [],
      };
    });
  }

  private graphImports(files: GraphFile[]): Import[] {
    const inGraph = new Set(files.map((file) => file.path));
    const edges = new Map<string, Import>();
    for (const path of inGraph) {
      const source = this.sources.get(path);
      for (const binding of source?.imports ?? []) {
        const target = this.modules.resolve(path, source!.language, binding.module);
        if (target && target !== path && inGraph.has(target)) edges.set(`${path}\0${target}`, { from: path, to: target });
      }
    }
    return [...edges.values()];
  }

  private async graphPackages(files: GraphFile[]): Promise<Package[]> {
    const roots = [...new Set(files.map((file) => file.package))];
    const manifests = await readBlobs(
      this.input.repoDir,
      this.input.headSha,
      roots.flatMap((root) => this.packages.manifestOf(root) ?? []),
    );
    return roots.map((root) => {
      const manifestPath = this.packages.manifestOf(root);
      return packageFor(root, manifestPath && manifests.get(manifestPath), this.input.repoName);
    });
  }
}
