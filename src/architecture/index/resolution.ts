import { posix } from "node:path";

export type ResolvedTarget = { file: string; names: string[] };

export type Resolution =
  | { outcome: "internal"; targets: ResolvedTarget[] }
  | { outcome: "asset" }
  | { outcome: "external" }
  | { outcome: "unresolved" };

export type RepositoryFiles = {
  files: ReadonlySet<string>;
  directories: ReadonlySet<string>;
  readText: (path: string) => string | undefined;
};

export const external: Resolution = { outcome: "external" };
export const unresolved: Resolution = { outcome: "unresolved" };

export function repositoryFiles(paths: string[], readText: (path: string) => string | undefined): RepositoryFiles {
  const directories = new Set<string>();
  for (const path of paths) {
    for (let directory = posix.dirname(path); directory !== "." && !directories.has(directory); directory = posix.dirname(directory)) directories.add(directory);
  }
  return { files: new Set(paths), directories, readText };
}

export function isResolved(resolution: Resolution): boolean {
  return resolution.outcome === "internal" || resolution.outcome === "asset";
}
