import type { BlobCache } from "../../coherence/blob-cache.ts";
import { readBlobs, type TreeEntry } from "../../src/architecture/index/git.ts";
import { InvertedTreeIndex } from "./tree-index.ts";

export type DeclaredSymbol = { name: string; line: number };

const scriptDeclaration = /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|class|enum)\s+([A-Za-z_$][\w$]*)/;
const pythonDeclaration = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/;
const rustDeclaration = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_]\w*)/;

export function declaredSymbols(path: string, text: string): DeclaredSymbol[] {
  const pattern = declarationPattern(path);
  if (!pattern) return [];
  return text.split("\n").flatMap((line, index) => {
    const name = pattern.exec(line)?.[1];
    return name ? [{ name, line: index + 1 }] : [];
  });
}

export function normalisedName(name: string): string {
  return name.replaceAll(/[_$-]/g, "").toLowerCase();
}

export function symbolIndex(repository: string, cache: BlobCache): InvertedTreeIndex<string> {
  return new InvertedTreeIndex(repository, async (entries) => {
    const names = await cache.resolve(entries, ({ sha, path }) => `grader-symbols-v1\0${sha}\0${declarationPattern(path)?.source ?? ""}`, (misses) => declaredNames(repository, misses));
    return new Map(entries.map((entry) => [entry.sha, names.get(entry) ?? []]));
  });
}

async function declaredNames(repository: string, entries: TreeEntry[]): Promise<Map<TreeEntry, string[]>> {
  const texts = await readBlobs(repository, entries.map(({ sha }) => sha));
  return new Map(entries.map((entry) => [entry, declaredSymbols(entry.path, texts.get(entry.sha) ?? "").map(({ name }) => normalisedName(name))]));
}

function declarationPattern(path: string): RegExp | undefined {
  if (/\.pyi?$/.test(path)) return pythonDeclaration;
  if (/\.[mc]?[jt]sx?$/.test(path)) return scriptDeclaration;
  if (path.endsWith(".rs")) return rustDeclaration;
  return undefined;
}
