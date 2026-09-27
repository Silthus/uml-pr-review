import type { BlobCache } from "../../coherence/blob-cache.ts";
import { readBlobs, type TreeEntry } from "../../src/architecture/index/git.ts";
import { InvertedTreeIndex } from "./tree-index.ts";

export type DeclaredSymbol = { name: string; line: number };

type Language = { family: string; declaration: RegExp };

const python: Language = { family: "python", declaration: /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/ };
const script: Language = { family: "script", declaration: /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|class|enum)\s+([A-Za-z_$][\w$]*)/ };
const rust: Language = { family: "rust", declaration: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_]\w*)/ };

export function declaredSymbols(path: string, text: string): DeclaredSymbol[] {
  const language = languageOf(path);
  if (!language) return [];
  return text.split("\n").flatMap((line, index) => {
    const name = language.declaration.exec(line)?.[1];
    return name ? [{ name, line: index + 1 }] : [];
  });
}

export function symbolKey(path: string, name: string): string {
  return `${languageOf(path)?.family}:${normalisedName(name)}`;
}

export function normalisedName(name: string): string {
  return name.replaceAll(/[_$-]/g, "").toLowerCase();
}

export function symbolIndex(repository: string, cache: BlobCache): InvertedTreeIndex<string> {
  return new InvertedTreeIndex(repository, async (entries) => {
    const keys = await cache.resolve(entries, ({ sha, path }) => `grader-symbols-v2\0${sha}\0${languageOf(path)?.family ?? ""}`, (misses) => declaredKeys(repository, misses));
    return new Map(entries.map((entry) => [entry.sha, keys.get(entry) ?? []]));
  });
}

async function declaredKeys(repository: string, entries: TreeEntry[]): Promise<Map<TreeEntry, string[]>> {
  const texts = await readBlobs(repository, entries.map(({ sha }) => sha));
  return new Map(entries.map((entry) => [entry, declaredSymbols(entry.path, texts.get(entry.sha) ?? "").map(({ name }) => symbolKey(entry.path, name))]));
}

function languageOf(path: string): Language | undefined {
  if (/\.pyi?$/.test(path)) return python;
  if (/\.[mc]?[jt]sx?$/.test(path)) return script;
  if (path.endsWith(".rs")) return rust;
  return undefined;
}
