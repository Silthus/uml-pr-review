import { posix } from "node:path";
import type { ImportRef } from "./imports.ts";

export type Resolution =
  | { status: "internal"; targets: string[] }
  | { status: "asset"; targets: string[] }
  | { status: "external" }
  | { status: "unresolved"; shape: string };

type PythonRoot = { dir: string; project: string };
type PathAlias = { pattern: string; targets: string[] };
type TsConfig = { dir: string; aliases: PathAlias[] | null };
type WorkspacePackage = { name: string; dir: string; manifest: PackageManifest };
type PackageManifest = { name?: string; main?: string; module?: string; types?: string; exports?: unknown };

const scriptExtensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs", ".d.ts"];
const scriptSuffixes = ["", ...scriptExtensions, ...scriptExtensions.map((extension) => `/index${extension}`)];
const sourceFile = /\.(pyi?|[mc]?[jt]sx?)$/;

export class RepositoryResolver {
  private readonly files: Set<string>;
  private readonly directories = new Set<string>();
  private readonly tsconfigs = new Map<string, TsConfig>();
  private readonly packagesByName = new Map<string, WorkspacePackage>();
  private readonly pythonRoots: PythonRoot[];
  private readonly pythonRootsByTopLevel = new Map<string, PythonRoot[]>();

  constructor(paths: string[], readText: (path: string) => string | undefined) {
    this.files = new Set(paths);
    for (const path of paths) {
      for (let dir = posix.dirname(path); dir !== "." && !this.directories.has(dir); dir = posix.dirname(dir)) this.directories.add(dir);
    }
    this.pythonRoots = this.discoverPythonRoots(paths);
    for (const path of paths.filter((path) => path.endsWith(".py"))) {
      for (const root of this.pythonRoots.filter((candidate) => candidate.dir === "." || path.startsWith(`${candidate.dir}/`))) {
        const topLevel = (root.dir === "." ? path : path.slice(root.dir.length + 1)).split("/")[0]!.replace(/\.py$/, "");
        const roots = this.pythonRootsByTopLevel.get(topLevel) ?? [];
        if (!roots.includes(root)) this.pythonRootsByTopLevel.set(topLevel, [...roots, root]);
      }
    }
    this.loadTsConfigs(paths, readText);
    this.loadWorkspacePackages(paths, readText);
  }

  resolve(fromPath: string, ref: ImportRef): Resolution {
    return fromPath.endsWith(".py") || fromPath.endsWith(".pyi") ? this.resolvePython(fromPath, ref) : this.resolveScript(fromPath, ref.specifier);
  }

  private discoverPythonRoots(paths: string[]): PythonRoot[] {
    const projects = paths.filter((path) => /(^|\/)(pyproject\.toml|setup\.py)$/.test(path)).map((path) => posix.dirname(path));
    const roots = [...new Set([".", ...projects])].flatMap((project) =>
      this.directories.has(posix.join(project, "src")) ? [{ dir: posix.join(project, "src"), project }, { dir: project, project }] : [{ dir: project, project }],
    );
    return roots.sort((a, b) => b.dir.length - a.dir.length);
  }

  private pythonBasesFor(fromPath: string, topLevel: string): string[] {
    const candidates = this.pythonRootsByTopLevel.get(topLevel) ?? [];
    const owns = (root: PythonRoot) => root.project === "." || fromPath.startsWith(`${root.project}/`);
    const ordered = [...candidates.filter((root) => owns(root) && root.dir !== "."), ...candidates.filter((root) => root.dir === "."), ...candidates.filter((root) => !owns(root))];
    return [...new Set(ordered.map((root) => root.dir))];
  }

  private resolvePython(fromPath: string, ref: ImportRef): Resolution {
    const dots = /^\.*/.exec(ref.specifier)![0].length;
    const dotted = ref.specifier.slice(dots).split(".").filter(Boolean);
    const bases = dots > 0 ? [posix.join(posix.dirname(fromPath), ...Array<string>(dots - 1).fill(".."))] : this.pythonBasesFor(fromPath, dotted[0] ?? "");
    if (bases.length === 0) return { status: "external" };
    for (const base of bases) {
      const modulePath = posix.join(base, ...dotted);
      const submodules = (ref.names ?? [])
        .filter((name) => name !== "*")
        .map((name) => this.pythonModuleFile(posix.join(modulePath, name)))
        .filter((path): path is string => path !== null);
      const moduleFile = this.pythonModuleFile(modulePath);
      const unresolvedNames = (ref.names ?? []).length > submodules.length;
      const targets = [...submodules, ...(moduleFile && (unresolvedNames || submodules.length === 0) ? [moduleFile] : [])];
      if (targets.length > 0) return { status: "internal", targets: [...new Set(targets)] };
    }
    return { status: "unresolved", shape: dots > 0 ? `${".".repeat(dots)}relative` : `${dotted.slice(0, 2).join(".")}.*` };
  }

  private pythonModuleFile(modulePath: string): string | null {
    const normalized = modulePath === "" ? "." : modulePath;
    const candidates = [`${normalized}.py`, `${normalized}/__init__.py`, `${normalized}.pyi`, `${normalized}/__init__.pyi`];
    const file = candidates.find((candidate) => this.files.has(candidate.replace(/^\.\//, "")));
    if (file) return file.replace(/^\.\//, "");
    return this.directories.has(normalized) ? `${normalized}/` : null;
  }

  private resolveScript(fromPath: string, specifier: string): Resolution {
    const cleaned = specifier.replace(/[?#].*$/, "").replace(/^[a-z-]+!/, "");
    if (cleaned.startsWith(".")) return this.fileResolution(posix.join(posix.dirname(fromPath), cleaned), `relative${extensionShape(cleaned)}`);
    for (const alias of this.aliasesFor(fromPath)) {
      const match = matchAlias(alias.pattern, cleaned);
      if (match === null) continue;
      if (alias.targets.every((target) => target.includes("node_modules/"))) return { status: "external" };
      for (const target of alias.targets) {
        const resolution = this.fileResolution(target.replace("*", match), "");
        if (resolution.status !== "unresolved") return resolution;
      }
      if (alias.pattern !== "*") return { status: "unresolved", shape: `alias ${alias.pattern}` };
    }
    const workspace = this.resolveWorkspacePackage(cleaned);
    if (workspace) return workspace;
    if (cleaned.startsWith("/")) return this.fileResolution(cleaned.slice(1), "absolute /");
    return { status: "external" };
  }

  private fileResolution(target: string, shape: string): Resolution {
    const normalized = posix.normalize(target).replace(/^\.\//, "");
    const withoutJs = normalized.replace(/\.[mc]?js$/, "");
    const script = scriptSuffixes.map((suffix) => withoutJs + suffix).find((candidate) => this.files.has(candidate));
    if (script) return { status: sourceFile.test(script) && !script.endsWith(".d.ts") ? "internal" : "asset", targets: [script] };
    if (this.files.has(normalized)) return { status: sourceFile.test(normalized) ? "internal" : "asset", targets: [normalized] };
    return { status: "unresolved", shape };
  }

  private aliasesFor(fromPath: string): PathAlias[] {
    for (let dir = posix.dirname(fromPath); ; dir = posix.dirname(dir)) {
      const config = this.tsconfigs.get(dir);
      if (config?.aliases) return config.aliases;
      if (dir === ".") return [];
    }
  }

  private loadTsConfigs(paths: string[], readText: (path: string) => string | undefined) {
    const raw = new Map<string, { extends?: string | string[]; compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }>();
    for (const path of paths.filter((path) => posix.basename(path) === "tsconfig.json" && !path.includes("node_modules/"))) {
      const text = readText(path);
      if (text === undefined) continue;
      try {
        raw.set(path, Bun.JSONC.parse(text) as never);
      } catch {}
    }
    const effective = (path: string, seen: Set<string>): PathAlias[] | null => {
      const config = raw.get(path);
      if (!config || seen.has(path)) return null;
      seen.add(path);
      const dir = posix.dirname(path);
      const options = config.compilerOptions;
      if (options?.paths) {
        const base = posix.join(dir, options.baseUrl ?? ".");
        return Object.entries(options.paths).map(([pattern, targets]) => ({
          pattern,
          targets: targets.map((target) => posix.join(base, target)),
        }));
      }
      const parents = [config.extends ?? []].flat().filter((parent) => parent.startsWith("."));
      for (const parent of parents) {
        const parentPath = posix.normalize(posix.join(dir, parent.endsWith(".json") ? parent : `${parent}.json`));
        const inherited = effective(parentPath, seen);
        if (inherited) return inherited;
      }
      return null;
    };
    for (const path of raw.keys()) {
      const aliases = effective(path, new Set());
      this.tsconfigs.set(posix.dirname(path), {
        dir: posix.dirname(path),
        aliases: aliases?.sort((a, b) => b.pattern.replace("*", "").length - a.pattern.replace("*", "").length) ?? null,
      });
    }
  }

  private loadWorkspacePackages(paths: string[], readText: (path: string) => string | undefined) {
    for (const path of paths.filter((path) => posix.basename(path) === "package.json" && !path.includes("node_modules/"))) {
      try {
        const manifest = JSON.parse(readText(path) ?? "") as PackageManifest;
        if (manifest.name && !this.packagesByName.has(manifest.name)) {
          this.packagesByName.set(manifest.name, { name: manifest.name, dir: posix.dirname(path), manifest });
        }
      } catch {}
    }
  }

  private resolveWorkspacePackage(specifier: string): Resolution | null {
    const segments = specifier.split("/");
    const nameLength = specifier.startsWith("@") ? 2 : 1;
    const pkg = this.packagesByName.get(segments.slice(0, nameLength).join("/"));
    if (!pkg) return null;
    const subpath = segments.slice(nameLength).join("/");
    const entries = subpath
      ? [exportTarget(pkg.manifest.exports, `./${subpath}`), subpath, `src/${subpath}`]
      : [exportTarget(pkg.manifest.exports, "."), pkg.manifest.module, pkg.manifest.main, "src/index", "index", pkg.manifest.types];
    for (const entry of entries.filter((entry): entry is string => typeof entry === "string")) {
      const resolution = this.fileResolution(posix.join(pkg.dir, entry), "");
      if (resolution.status !== "unresolved") return resolution;
      const sourceGuess = this.fileResolution(posix.join(pkg.dir, entry.replace(/^(\.\/)?(dist|lib|build)\//, "src/")), "");
      if (sourceGuess.status !== "unresolved") return sourceGuess;
    }
    return { status: "unresolved", shape: `workspace ${pkg.name}${subpath ? "/*" : ""}` };
  }
}

function matchAlias(pattern: string, specifier: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) return null;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function exportTarget(exports: unknown, key: string): string | undefined {
  if (typeof exports === "string") return key === "." ? exports : undefined;
  if (!exports || typeof exports !== "object") return undefined;
  const entry = (exports as Record<string, unknown>)[key];
  return conditionTarget(entry);
}

function conditionTarget(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return undefined;
  for (const condition of ["source", "development", "import", "default", "require", "types"]) {
    const target = conditionTarget((entry as Record<string, unknown>)[condition]);
    if (target) return target;
  }
  return undefined;
}

function extensionShape(specifier: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(specifier)?.[1];
  return extension ? ` .${extension}` : "";
}
