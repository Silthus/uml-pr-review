import { posix } from "node:path";
import type { ImportRef } from "./imports.ts";
import { external, unresolved, type RepositoryFiles, type Resolution } from "./resolution.ts";
import type { PackageManifest, PathAlias, ScriptConfiguration } from "./script-configuration.ts";

const scriptExtensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs", ".d.ts"];
const candidateSuffixes = ["", ...scriptExtensions, ...scriptExtensions.map((extension) => `/index${extension}`)];
const exportConditions = ["source", "development", "import", "default", "require", "types"];
const sourceFilePattern = /\.(pyi?|[mc]?[jt]sx?)$/;
const buildOutputPattern = /^(\.\/)?(dist|lib|build)\//;
const catchAllPattern = "*";
const rootExport = ".";

export class ScriptResolver {
  constructor(
    private readonly repository: RepositoryFiles,
    private readonly configuration: ScriptConfiguration,
  ) {}

  resolve(fromPath: string, ref: ImportRef): Resolution {
    const specifier = ref.specifier.replace(/[?#].*$/, "").replace(/^[a-z-]+!/, "");
    if (specifier.startsWith(".")) return this.fileAt(posix.join(posix.dirname(fromPath), specifier), ref.names);
    return this.resolveAlias(fromPath, specifier, ref.names) ?? this.resolveWorkspacePackage(specifier, ref.names) ?? this.resolveAbsolute(specifier, ref.names);
  }

  private resolveAlias(fromPath: string, specifier: string, names: string[]): Resolution | undefined {
    for (const alias of this.aliasesFor(fromPath)) {
      const match = matchAlias(alias.pattern, specifier);
      if (match === undefined) continue;
      if (alias.targets.length > 0 && alias.targets.every((target) => target.includes("node_modules/"))) return external;
      const resolved = alias.targets.map((target) => this.fileAt(target.replace(catchAllPattern, match), names)).find((resolution) => resolution.outcome !== "unresolved");
      if (resolved) return resolved;
      if (alias.pattern !== catchAllPattern) return unresolved;
    }
    return undefined;
  }

  private resolveWorkspacePackage(specifier: string, names: string[]): Resolution | undefined {
    const segments = specifier.split("/");
    const nameLength = specifier.startsWith("@") ? 2 : 1;
    const workspacePackage = this.configuration.packagesByName.get(segments.slice(0, nameLength).join("/"));
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
      const aliases = this.configuration.aliasesByDirectory.get(directory);
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
    : [exportTarget(manifest.exports, rootExport), manifest.module, manifest.main, "src/index", "index", manifest.types];
  return entries.filter((entry): entry is string => typeof entry === "string");
}

function exportTarget(exports: unknown, subpath: string): string | undefined {
  if (isSubpathMap(exports)) return conditionTarget(exports[subpath]);
  return subpath === rootExport ? conditionTarget(exports) : undefined;
}

function isSubpathMap(exports: unknown): exports is Record<string, unknown> {
  return isRecord(exports) && Object.keys(exports).some((key) => key.startsWith("."));
}

function conditionTarget(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (!isRecord(entry)) return undefined;
  return exportConditions.map((condition) => conditionTarget(entry[condition])).find((target) => target !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
