// PROTOTYPE - throwaway. Shared file discovery for both extractors.
// Extra file, not in the issue #5 list. Both extractors must see the same
// file set, or the edge comparison is not a fair one.

import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = ["apps", "packages", "tools"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".dts",
  "coverage",
  ".turbo",
  ".next",
  "playwright-report",
]);

/**
 * Every workspace source file of the checkout, as absolute posix paths, sorted.
 * Sorting matters: the root order decides the program's file order, and that
 * decides every downstream list (see docs/research/typescript-call-graph.md).
 */
export function listWorkspaceFiles(worktree: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (entry.name.endsWith(".d.ts")) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      found.push(full);
    }
  };
  for (const root of ROOTS) {
    const dir = join(worktree, root);
    try {
      if (statSync(dir).isDirectory()) walk(dir);
    } catch {
      // Root absent. Skip it.
    }
  }
  return found.map(toPosix).sort();
}

export function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

export function repoRelative(worktree: string, absolute: string): string {
  return toPosix(relative(worktree, absolute));
}

/** True for a path that holds no reviewable source: dependencies or output. */
export function isExternalPath(p: string): boolean {
  return (
    p.includes("/node_modules/") ||
    p.endsWith(".d.ts") ||
    p.includes("/dist/") ||
    p.includes("/.dts/")
  );
}

/** Lines that a set of 1-based line numbers overlaps a range on. */
export function overlaps(
  lines: readonly number[],
  start: number,
  end: number,
): boolean {
  for (const line of lines) if (line >= start && line <= end) return true;
  return false;
}
