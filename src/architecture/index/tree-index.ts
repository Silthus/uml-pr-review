import { isTestPath } from "../../analyzer/extract.ts";
import { languageOf } from "../../analyzer/parser.ts";
import type { ArchitecturePayload, ImportKind } from "../contracts/index.ts";
import type { ExtractionStore, Extracted } from "./extraction-store.ts";
import { isSymbolicLink, listBlobs, readBlobs, type TreeEntry } from "./git.ts";
import { buildModuleTree, languageOfSource, type ModuleTree } from "./module-tree.ts";
import { isResolved } from "./resolution.ts";
import { createImportResolver, type ImportResolver } from "./resolver.ts";

export type TreeIndex = Pick<ArchitecturePayload, "modules" | "files" | "imports" | "unresolved" | "stats">;

type FileImport = { kind: ImportKind; line: number; names: Set<string> };
type SourceFile = TreeEntry & { index: number };

const kindStrength: ImportKind[] = ["static", "reexport", "require", "dynamic", "lazy", "type"];
const configurationFile = /(^|\/)(tsconfig[^/]*|package)\.json$/;

export async function buildTreeIndex(cwd: string, tree: string, store: ExtractionStore, workers: number): Promise<TreeIndex> {
  const started = performance.now();
  const entries = await listBlobs(cwd, tree);
  const sources = sourceFilesOf(entries);
  const moduleTree = buildModuleTree(sources.map(({ path }) => path), new Set(entries.map(({ path }) => path)));
  const parseable = sources.filter(({ path }) => languageOf(path) !== null);
  const [extraction, resolve] = await Promise.all([store.extract(cwd, parseable, workers), importResolverFor(cwd, entries)]);
  const resolved = resolveImports(parseable, extraction.bySha, resolve, new Map(sources.map(({ path, index }) => [path, index])));
  return {
    modules: moduleTree.modules.map(({ path, label, parent, kind, directFiles, totalFiles }) => [path, label, parent, kind, directFiles, totalFiles]),
    files: fileTuples(sources, moduleTree),
    imports: resolved.imports,
    unresolved: resolved.unresolved,
    stats: { files: sources.length, imports: resolved.count, ...extraction.counts, milliseconds: Math.round(performance.now() - started) },
  };
}

function sourceFilesOf(entries: TreeEntry[]): SourceFile[] {
  return entries
    .filter((entry) => !isSymbolicLink(entry) && languageOfSource(entry.path) !== null)
    .sort((a, b) => compare(a.path, b.path))
    .map((entry, index) => ({ ...entry, index }));
}

function fileTuples(sources: SourceFile[], moduleTree: ModuleTree): TreeIndex["files"] {
  return sources.map(({ path }) => {
    const module = moduleTree.moduleOfFile(path);
    const test = isTestPath(path) || moduleTree.modules[module]!.withinTests;
    return [path, module, languageOfSource(path)!, test ? "test" : "production"];
  });
}

async function importResolverFor(cwd: string, entries: TreeEntry[]): Promise<ImportResolver> {
  const configurations = entries.filter(({ path }) => configurationFile.test(path) && !path.includes("node_modules/"));
  const texts = await readBlobs(cwd, configurations.map(({ sha }) => sha));
  const shaOf = new Map(configurations.map(({ path, sha }) => [path, sha]));
  return createImportResolver(
    entries.map(({ path }) => path),
    (path) => texts.get(shaOf.get(path) ?? ""),
  );
}

function resolveImports(sources: SourceFile[], extracted: Map<string, Extracted>, resolve: ImportResolver, fileIndex: Map<string, number>) {
  const imports = new Map<number, FileImport>();
  const unresolved = new Map<string, TreeIndex["unresolved"][number]>();
  let count = 0;
  for (const source of sources) {
    for (const ref of extracted.get(source.sha) ?? []) {
      const resolution = resolve(source.path, ref);
      if (isResolved(resolution)) count++;
      if (resolution.outcome === "unresolved") unresolved.set(`${source.index}:${ref.line}:${ref.specifier}`, [source.index, ref.line, ref.specifier]);
      if (resolution.outcome !== "internal") continue;
      for (const target of resolution.targets) {
        const to = fileIndex.get(target.file);
        if (to !== undefined && to !== source.index) merge(imports, source.index * fileIndex.size + to, { kind: ref.kind, line: ref.line, names: new Set(target.names) });
      }
    }
  }
  return { imports: importTuples(imports, fileIndex.size), unresolved: [...unresolved.values()].sort(compareUnresolved), count };
}

function merge(imports: Map<number, FileImport>, key: number, next: FileImport) {
  const current = imports.get(key);
  if (!current) {
    imports.set(key, next);
    return;
  }
  if (kindStrength.indexOf(next.kind) < kindStrength.indexOf(current.kind)) current.kind = next.kind;
  current.line = Math.min(current.line, next.line);
  for (const name of next.names) current.names.add(name);
}

function importTuples(imports: Map<number, FileImport>, fileCount: number): TreeIndex["imports"] {
  return [...imports]
    .sort(([a], [b]) => a - b)
    .map(([key, { kind, line, names }]) => [Math.floor(key / fileCount), key % fileCount, kind, line, [...names].sort(compare)]);
}

function compareUnresolved([fileA, lineA, specifierA]: TreeIndex["unresolved"][number], [fileB, lineB, specifierB]: TreeIndex["unresolved"][number]): number {
  return fileA - fileB || lineA - lineB || compare(specifierA, specifierB);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
