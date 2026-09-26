import { posix } from "node:path";
import type { ImportRef } from "./imports.ts";
import { external, unresolved, type RepositoryFiles, type Resolution } from "./resolution.ts";

type PathAlias = { pattern: string; targets: string[] };
type TsConfig = { extends?: string | string[]; compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
type PackageManifest = { name?: string; main?: string; module?: string; types?: string; exports?: unknown };
type WorkspacePackage = { directory: string; manifest: PackageManifest };

const scriptExtensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs", ".d.ts"];
const candidateSuffixes = ["", ...scriptExtensions, ...scriptExtensions.map((extension) => `/index${extension}`)];
const exportConditions = ["source", "development", "import", "default", "require", "types"];
const sourceFilePattern = /\.(pyi?|[mc]?[jt]sx?)$/;
const buildOutputPattern = /^(\.\/)?(dist|lib|build)\//;
const catchAllPattern = "*";

export class ScriptResolver {
  private readonly aliasesByDirectory: Map<string, PathAlias[] | null>;
  private readonly packagesByName: Map<string, WorkspacePackage>;

  constructor(
    private readonly repository: RepositoryFiles,
    paths: string[],
  ) {
    const manifests = paths.filter((path) => !path.includes("node_modules/"));
    this.aliasesByDirectory = loadPathAliases(manifests.filter((path) => /^tsconfig[^/]*\.json$/.test(posix.basename(path))), repository.readText);
    this.packagesByName = loadWorkspacePackages(manifests.filter((path) => posix.basename(path) === "package.json"), repository.readText);
  }

  resolve(fromPath: string, ref: ImportRef): Resolution {
    const specifier = ref.specifier.replace(/[?#].*$/, "").replace(/^[a-z-]+!/, "");
    if (specifier.startsWith(".")) return this.fileAt(posix.join(posix.dirname(fromPath), specifier), ref.names);
    return this.resolveAlias(fromPath, specifier, ref.names) ?? this.resolveWorkspacePackage(specifier, ref.names) ?? this.resolveAbsolute(specifier, ref.names);
  }

  private resolveAlias(fromPath: string, specifier: string, names: string[]): Resolution | undefined {
    for (const alias of this.aliasesFor(fromPath)) {
      const match = matchAlias(alias.pattern, specifier);
      if (match === undefined) continue;
      if (alias.targets.every((target) => target.includes("node_modules/"))) return external;
      const resolved = alias.targets.map((target) => this.fileAt(target.replace(catchAllPattern, match), names)).find((resolution) => resolution.outcome !== "unresolved");
      if (resolved) return resolved;
      if (alias.pattern !== catchAllPattern) return unresolved;
    }
    return undefined;
  }

  private resolveWorkspacePackage(specifier: string, names: string[]): Resolution | undefined {
    const segments = specifier.split("/");
    const nameLength = specifier.startsWith("@") ? 2 : 1;
    const workspacePackage = this.packagesByName.get(segments.slice(0, nameLength).join("/"));
    if (!workspacePackage) return undefined;
    for (const entry of packageEntries(workspacePackage.manifest, segments.slice(nameLength).join("/"))) {
      for (const candidate of [entry, entry.replace(buildOutputPattern, "src/")]) {
        const resolution = this.fileAt(posix.join(workspacePackage.directory, candidate), names);
        if (resolution.outcome !== "unresolved") return resolution;
      }
    }
    return unresolved;
  }

  private resolveAbsolute(specifier: string, names: string[]): Resolution {
    return specifier.startsWith("/") ? this.fileAt(specifier.slice(1), names) : external;
  }

  private fileAt(target: string, names: string[]): Resolution {
    const normalized = posix.normalize(target).replace(/^\.\//, "");
    const withoutScriptExtension = normalized.replace(/\.[mc]?js$/, "");
    const file =
      candidateSuffixes.map((suffix) => withoutScriptExtension + suffix).find((candidate) => this.repository.files.has(candidate)) ??
      (this.repository.files.has(normalized) ? normalized : undefined);
    if (!file) return unresolved;
    return sourceFilePattern.test(file) && !file.endsWith(".d.ts") ? { outcome: "internal", targets: [{ file, names }] } : { outcome: "asset" };
  }

  private aliasesFor(fromPath: string): PathAlias[] {
    for (let directory = posix.dirname(fromPath); ; directory = posix.dirname(directory)) {
      const aliases = this.aliasesByDirectory.get(directory);
      if (aliases) return aliases;
      if (directory === ".") return [];
    }
  }
}

function matchAlias(pattern: string, specifier: string): string | undefined {
  const star = pattern.indexOf(catchAllPattern);
  if (star === -1) return pattern === specifier ? "" : undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  const matches = specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix);
  return matches ? specifier.slice(prefix.length, specifier.length - suffix.length) : undefined;
}

function packageEntries(manifest: PackageManifest, subpath: string): string[] {
  const entries = subpath
    ? [exportTarget(manifest.exports, `./${subpath}`), subpath, `src/${subpath}`]
    : [exportTarget(manifest.exports, "."), manifest.module, manifest.main, "src/index", "index", manifest.types];
  return entries.filter((entry): entry is string => typeof entry === "string");
}

function exportTarget(exports: unknown, key: string): string | undefined {
  if (typeof exports === "string") return key === "." ? exports : undefined;
  if (!isRecord(exports)) return undefined;
  return conditionTarget(exports[key]);
}

function conditionTarget(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (!isRecord(entry)) return undefined;
  return exportConditions.map((condition) => conditionTarget(entry[condition])).find((target) => target !== undefined);
}

function loadPathAliases(tsconfigPaths: string[], readText: RepositoryFiles["readText"]): Map<string, PathAlias[] | null> {
  const configs = new Map(tsconfigPaths.flatMap((path) => parsed<TsConfig>(readText(path), Bun.JSONC.parse).map((config) => [path, config] as const)));
  const effectiveAliases = (path: string, seen: Set<string>): PathAlias[] | null => {
    const config = configs.get(path);
    if (!config || seen.has(path)) return null;
    seen.add(path);
    const directory = posix.dirname(path);
    const paths = config.compilerOptions?.paths;
    if (paths) return aliasesOf(posix.join(directory, config.compilerOptions?.baseUrl ?? "."), paths);
    const parents = [config.extends ?? []].flat().filter((parent) => parent.startsWith("."));
    for (const parent of parents) {
      const inherited = effectiveAliases(posix.normalize(posix.join(directory, parent.endsWith(".json") ? parent : `${parent}.json`)), seen);
      if (inherited) return inherited;
    }
    return null;
  };
  const nearestConfigs = [...configs.keys()].filter((path) => posix.basename(path) === "tsconfig.json");
  return new Map(nearestConfigs.map((path) => [posix.dirname(path), effectiveAliases(path, new Set())]));
}

function aliasesOf(base: string, paths: Record<string, string[]>): PathAlias[] {
  const aliases = Object.entries(paths).map(([pattern, targets]) => ({ pattern, targets: targets.map((target) => posix.join(base, target)) }));
  return aliases.sort((a, b) => b.pattern.replace(catchAllPattern, "").length - a.pattern.replace(catchAllPattern, "").length);
}

function loadWorkspacePackages(manifestPaths: string[], readText: RepositoryFiles["readText"]): Map<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>();
  for (const path of manifestPaths) {
    for (const manifest of parsed<PackageManifest>(readText(path), JSON.parse)) {
      if (manifest.name && !packages.has(manifest.name)) packages.set(manifest.name, { directory: posix.dirname(path), manifest });
    }
  }
  return packages;
}

function parsed<T>(text: string | undefined, parse: (text: string) => unknown): T[] {
  if (text === undefined) return [];
  try {
    const value = parse(text);
    return isRecord(value) ? [value as T] : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
