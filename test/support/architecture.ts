import { isTestPath } from "../../src/analyzer/extract.ts";
import {
  ArchitecturePayloadSchema,
  type ArchitecturePayload,
  type ImportKind,
  type Language,
} from "../../src/architecture/contracts/index.ts";

export type ImportSpec =
  | string
  | { to: string; line?: number; kind?: ImportKind; names?: string[] }
  | { unresolved: string; line?: number };

export type ArchitectureSource = Record<string, ImportSpec[]>;

type Resolved = { to: string; line: number; kind: ImportKind; names: string[] };
type Unresolved = { specifier: string; line: number };

const languages: Record<string, Language> = {
  py: "python",
  pyi: "python",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
};

export function architectureOf(source: ArchitectureSource, overrides: Partial<Pick<ArchitecturePayload, "repository" | "commit" | "tree">> = {}): ArchitecturePayload {
  const specs = Object.entries(source).map(([path, imports]) => ({ path, ...splitImports(imports) }));
  const filePaths = [...new Set(specs.flatMap(({ path, resolved }) => [path, ...resolved.map(({ to }) => to)]))].sort();
  const modulePaths = moduleTreeOf(filePaths);
  const moduleIndex = new Map(modulePaths.map((path, index) => [path, index]));
  const fileIndex = new Map(filePaths.map((path, index) => [path, index]));
  const moduleOf = (file: string) => moduleIndex.get(parentOf(file))!;

  return ArchitecturePayloadSchema.parse({
    version: 1,
    repository: overrides.repository ?? { id: "/repo/.git", root: "/repo", commonDir: "/repo/.git", name: "repo" },
    commit: overrides.commit === undefined ? "0".repeat(40) : overrides.commit,
    tree: overrides.tree ?? "f".repeat(40),
    modules: modulePaths.map((path) => [
      path,
      path === "." ? "." : basename(path),
      path === "." ? -1 : moduleIndex.get(parentOf(path))!,
      kindOf(path),
      filePaths.filter((file) => parentOf(file) === path).length,
      filePaths.filter((file) => isWithin(file, path)).length,
    ]),
    files: filePaths.map((path) => [path, moduleOf(path), languageOf(path), isTestFile(path) ? "test" : "production"]),
    imports: importTuples(specs, fileIndex),
    unresolved: specs
      .flatMap(({ path, unresolved }) => unresolved.map(({ specifier, line }) => [fileIndex.get(path)!, line, specifier] as const))
      .sort(([fileA, lineA, specA], [fileB, lineB, specB]) => fileA - fileB || lineA - lineB || compare(specA, specB)),
    stats: { files: filePaths.length, imports: specs.reduce((sum, { resolved }) => sum + resolved.length, 0), parsed: specs.length, cacheHits: 0, failed: 0, milliseconds: 0 },
  });
}

function splitImports(imports: ImportSpec[]): { resolved: Resolved[]; unresolved: Unresolved[] } {
  const resolved: Resolved[] = [];
  const unresolved: Unresolved[] = [];
  imports.forEach((spec, position) => {
    const line = typeof spec === "string" ? position + 1 : (spec.line ?? position + 1);
    if (typeof spec === "string") resolved.push({ to: spec, line, kind: "static", names: [] });
    else if ("unresolved" in spec) unresolved.push({ specifier: spec.unresolved, line });
    else resolved.push({ to: spec.to, line, kind: spec.kind ?? "static", names: [...new Set(spec.names)].sort(compare) });
  });
  return { resolved, unresolved };
}

function importTuples(specs: { path: string; resolved: Resolved[] }[], fileIndex: Map<string, number>) {
  const tuples = specs.flatMap(({ path, resolved }) =>
    resolved.map(({ to, line, kind, names }) => [fileIndex.get(path)!, fileIndex.get(to)!, kind, line, names] as const),
  );
  const pairs = new Set(tuples.map(([from, to]) => `${from}>${to}`));
  if (pairs.size !== tuples.length) throw new Error("architectureOf takes one import per ordered file pair.");
  return tuples.sort(([fromA, toA], [fromB, toB]) => fromA - fromB || toA - toB);
}

function moduleTreeOf(files: string[]): string[] {
  const folders = new Set<string>(["."]);
  for (const file of files) {
    for (let folder = parentOf(file); folder !== "."; folder = parentOf(folder)) folders.add(folder);
  }
  return [...folders].sort((a, b) => (a === "." ? -1 : b === "." ? 1 : compare(a, b)));
}

function kindOf(path: string) {
  if (path === ".") return "root" as const;
  return isTestFolderName(basename(path)) ? ("tests" as const) : ("directory" as const);
}

function isTestFile(path: string): boolean {
  return isTestPath(path) || path.split("/").slice(0, -1).some(isTestFolderName);
}

function isTestFolderName(name: string): boolean {
  return /^(tests?|__tests__|e2e|__snapshots__|__mocks__)$/.test(name);
}

function languageOf(path: string): Language {
  const language = languages[path.slice(path.lastIndexOf(".") + 1)];
  if (!language) throw new Error(`architectureOf cannot tell the language of ${path}.`);
  return language;
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "." : path.slice(0, slash);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isWithin(file: string, module: string): boolean {
  return module === "." || file.startsWith(`${module}/`);
}
