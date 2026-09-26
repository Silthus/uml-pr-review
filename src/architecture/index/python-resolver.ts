import { posix } from "node:path";
import type { ImportRef } from "./imports.ts";
import { external, unresolved, type RepositoryFiles, type Resolution, type ResolvedTarget } from "./resolution.ts";

type SourceRoot = { directory: string; project: string };
type PythonModule = { file: string | undefined };

const root = ".";
const wildcard = "*";

export class PythonResolver {
  private readonly rootsByTopLevelName: Map<string, SourceRoot[]>;

  constructor(
    private readonly repository: RepositoryFiles,
    paths: string[],
  ) {
    const pythonPaths = paths.filter((path) => /\.pyi?$/.test(path));
    this.rootsByTopLevelName = rootsByTopLevelName(pythonPaths, sourceRoots(paths, repository.directories));
  }

  resolve(fromPath: string, ref: ImportRef): Resolution {
    const dots = /^\.*/.exec(ref.specifier)![0].length;
    const segments = ref.specifier.slice(dots).split(".").filter(Boolean);
    const bases = dots > 0 ? [posix.join(posix.dirname(fromPath), ...Array<string>(dots - 1).fill(".."))] : this.basesFor(fromPath, segments[0] ?? "");
    if (bases.length === 0) return external;
    for (const base of bases) {
      const targets = this.targetsOf(posix.join(base, ...segments), ref.names);
      if (targets) return { outcome: "internal", targets };
    }
    return unresolved;
  }

  private basesFor(fromPath: string, topLevelName: string): string[] {
    const candidates = this.rootsByTopLevelName.get(topLevelName) ?? [];
    const owns = (candidate: SourceRoot) => candidate.project === root || fromPath.startsWith(`${candidate.project}/`);
    const ordered = [
      ...candidates.filter((candidate) => owns(candidate) && candidate.directory !== root),
      ...candidates.filter((candidate) => candidate.directory === root),
      ...candidates.filter((candidate) => !owns(candidate)),
    ];
    return [...new Set(ordered.map(({ directory }) => directory))];
  }

  private targetsOf(modulePath: string, names: string[]): ResolvedTarget[] | undefined {
    const submodules = names.filter((name) => name !== wildcard).flatMap((name) => {
      const submodule = this.moduleAt(posix.join(modulePath, name));
      return submodule ? [{ name, submodule }] : [];
    });
    const remainingNames = names.filter((name) => !submodules.some((found) => found.name === name));
    const module = remainingNames.length > 0 || submodules.length === 0 ? this.moduleAt(modulePath) : undefined;
    if (submodules.length === 0 && !module) return undefined;
    return [
      ...submodules.flatMap(({ submodule }) => fileTarget(submodule, [])),
      ...(module ? fileTarget(module, remainingNames) : []),
    ];
  }

  private moduleAt(modulePath: string): PythonModule | undefined {
    const prefix = modulePath === root ? "" : `${modulePath}/`;
    const candidates = modulePath === root ? [] : [`${modulePath}.py`, `${modulePath}.pyi`];
    const file = [...candidates, `${prefix}__init__.py`, `${prefix}__init__.pyi`].find((candidate) => this.repository.files.has(candidate));
    if (file) return { file };
    return this.repository.directories.has(modulePath) ? { file: undefined } : undefined;
  }
}

function fileTarget(module: PythonModule, names: string[]): ResolvedTarget[] {
  return module.file ? [{ file: module.file, names }] : [];
}

function sourceRoots(paths: string[], directories: ReadonlySet<string>): SourceRoot[] {
  const projects = new Set([root, ...paths.filter((path) => /(^|\/)(pyproject\.toml|setup\.py)$/.test(path)).map((path) => posix.dirname(path))]);
  const roots = [...projects].flatMap((project) => {
    const source = posix.join(project, "src");
    return directories.has(source) ? [{ directory: source, project }, { directory: project, project }] : [{ directory: project, project }];
  });
  return roots.sort((a, b) => b.directory.length - a.directory.length);
}

function rootsByTopLevelName(pythonPaths: string[], roots: SourceRoot[]): Map<string, SourceRoot[]> {
  const byName = new Map<string, Set<SourceRoot>>();
  for (const path of pythonPaths) {
    for (const candidate of roots) {
      if (candidate.directory !== root && !path.startsWith(`${candidate.directory}/`)) continue;
      const relative = candidate.directory === root ? path : path.slice(candidate.directory.length + 1);
      const name = relative.split("/")[0]!.replace(/\.pyi?$/, "");
      byName.set(name, (byName.get(name) ?? new Set()).add(candidate));
    }
  }
  return new Map([...byName].map(([name, set]) => [name, [...set]]));
}
