import { isTestPath } from "../../src/analyzer/extract.ts";
import { pairKey, type IndexView } from "./index-view.ts";
import { linesChanged, type PatchedFile } from "./patch.ts";
import type { TachConfig } from "./tach.ts";

export type Focus = {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  modulesTouched: number;
  tachModulesTouched: number;
  newCrossModuleEdges: number;
  testsAdded: number;
};

const testDeclaration = /^\s*(?:async\s+)?def\s+test_|^\s*(?:it|test)(?:\.each\([^)]*\))?\s*\(/;

export function focus(base: IndexView, patched: IndexView, tach: TachConfig, files: PatchedFile[]): Focus {
  const lines = linesChanged(files);
  const linesAdded = files.reduce((total, file) => total + file.added, 0);
  return {
    filesChanged: files.length,
    linesAdded,
    linesRemoved: lines - linesAdded,
    modulesTouched: new Set(files.flatMap((file) => touchedModule(file, base, patched))).size,
    tachModulesTouched: new Set(files.map((file) => tach.moduleOf(file.path))).size,
    newCrossModuleEdges: newModuleEdges(base, patched),
    testsAdded: files.filter((file) => isTestPath(file.path)).reduce((total, file) => total + file.addedLines.filter((line) => testDeclaration.test(line)).length, 0),
  };
}

function touchedModule(file: PatchedFile, base: IndexView, patched: IndexView): string[] {
  const module = file.status === "deleted" ? base.moduleOf(file.path) : patched.moduleOf(file.path);
  return module === undefined ? [] : [module];
}

function newModuleEdges(base: IndexView, patched: IndexView): number {
  const existing = moduleEdges(base);
  return [...moduleEdges(patched)].filter((edge) => !existing.has(edge)).length;
}

function moduleEdges(view: IndexView): Set<string> {
  const edges = new Set<string>();
  for (const { from, to, fromTest } of view.imports) {
    const fromModule = view.moduleOf(from);
    const toModule = view.moduleOf(to);
    if (!fromTest && fromModule !== undefined && toModule !== undefined && fromModule !== toModule) edges.add(pairKey(fromModule, toModule));
  }
  return edges;
}
