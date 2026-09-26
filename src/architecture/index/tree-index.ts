import { isTestPath } from "../../analyzer/extract.ts";
import { languageOf } from "../../analyzer/parser.ts";
import type { ArchitecturePayload, ImportKind } from "../contracts/index.ts";
import type { BlobToExtract } from "./extract-worker.ts";
import type { ExtractionStore, Extracted } from "./extraction-store.ts";
import { isSymbolicLink, listBlobs, readBlobs, type TreeEntry } from "./git.ts";
import { compareCodeUnits } from "./order.ts";
import { buildModuleTree, languageOfSource, type ModuleTree } from "./module-tree.ts";
import { isResolved } from "./resolution.ts";
import { createImportResolver, type ImportResolver } from "./resolver.ts";

export type TreeIndex = Pick<ArchitecturePayload, "modules" | "files" | "imports" | "unresolved" | "stats">;

type FileImport = { kind: ImportKind; line: number; names: Set<string> };
type SourceFile = TreeEntry & { index: number };
type ParseableFile = SourceFile & BlobToExtract;

const kindStrength: ImportKind[] = ["static", "reexport", "require", "dynamic", "lazy", "type"];

export async function buildTreeIndex(cwd: string, tree: string, store: ExtractionStore, workers: number): Promise<TreeIndex> {
  const started = performance.now();
  const entries = await listBlobs(cwd, tree);
  const sources = sourceFilesOf(entries);
  const moduleTree = buildModuleTree(sources.map(({ path }) => path), new Set(entries.map(({ path }) => path)));
  const parseable = parseableFilesOf(sources);
  const [extraction, resolve] = await Promise.all([store.extract(cwd, parseable, workers), importResolverFor(cwd, entries)]);
  const resolved = resolveImports(parseable, extraction.refsOf, resolve, new Map(sources.map(({ path, index }) => [path, index])));
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
    .sort((a, b) => compareCodeUnits(a.path, b.path))
    .map((entry, index) => ({ ...entry, index }));
}

function fileTuples(sources: SourceFile[], moduleTree: ModuleTree): TreeIndex["files"] {
  return sources.map(({ path }) => {
    const module = moduleTree.moduleOfFile(path);
    const test = isTestPath(path) || moduleTree.modules[module]!.withinTests;
    return [path, module, languageOfSource(path)!, test ? "test" : "production"];
  });
}

function parseableFilesOf(sources: SourceFile[]): ParseableFile[] {
  return sources.flatMap((source) => {
    const language = languageOf(source.path);
    return language ? [{ ...source, language }] : [];
  });
}

function importResolverFor(cwd: string, entries: TreeEntry[]): Promise<ImportResolver> {
  const shaOf = new Map(entries.map(({ path, sha }) => [path, sha]));
  const readTexts = async (paths: string[]) => {
    const texts = await readBlobs(cwd, paths.flatMap((path) => shaOf.get(path) ?? []));
    return new Map(paths.flatMap((path) => textEntry(path, texts.get(shaOf.get(path) ?? ""))));
  };
  return createImportResolver([...shaOf.keys()], readTexts);
}

function textEntry(path: string, text: string | undefined): [string, string][] {
  return text === undefined ? [] : [[path, text]];
}

function resolveImports(sources: ParseableFile[], refsOf: (blob: BlobToExtract) => Extracted, resolve: ImportResolver, fileIndex: Map<string, number>) {
  const imports = new Map<number, FileImport>();
  const unresolved = new Map<string, TreeIndex["unresolved"][number]>();
  let count = 0;
  for (const source of sources) {
    for (const ref of refsOf(source) ?? []) {
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
    .map(([key, { kind, line, names }]) => [Math.floor(key / fileCount), key % fileCount, kind, line, [...names].sort(compareCodeUnits)]);
}

function compareUnresolved([fileA, lineA, specifierA]: TreeIndex["unresolved"][number], [fileB, lineB, specifierB]: TreeIndex["unresolved"][number]): number {
  return fileA - fileB || lineA - lineB || compareCodeUnits(specifierA, specifierB);
}
