import { git, listBlobs, readBlobs } from "../../src/architecture/index/git.ts";
import { isProductionSource } from "./change.ts";

export type DeclaredSymbol = { name: string; line: number };
export type SharedSymbols = { definitionsOf(name: string): string[] };

const scriptExport = /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|class|enum)\s+([A-Za-z_$][\w$]*)/;
const pythonTopLevel = /^(?:async\s+)?(?:def|class)\s+([A-Za-z]\w*)/;

export function declaredSymbols(path: string, text: string): DeclaredSymbol[] {
  const pattern = path.endsWith(".py") ? pythonTopLevel : /\.[mc]?[jt]sx?$/.test(path) ? scriptExport : undefined;
  if (!pattern) return [];
  return text.split("\n").flatMap((line, index) => {
    const name = pattern.exec(line)?.[1];
    return name ? [{ name, line: index + 1 }] : [];
  });
}

export function normalisedName(name: string): string {
  return name.replaceAll(/[_$-]/g, "").toLowerCase();
}

export function isShared(path: string, roots: string[]): boolean {
  return roots.some((root) => path.startsWith(root));
}

export async function sharedSymbolsAt(repository: string, commit: string, roots: string[]): Promise<SharedSymbols> {
  const tree = (await git(repository, ["rev-parse", `${commit}^{tree}`])).trim();
  const entries = (await listBlobs(repository, tree)).filter(({ path }) => isShared(path, roots) && isProductionSource(path));
  const texts = await readBlobs(repository, entries.map(({ sha }) => sha));
  const definitions = new Map<string, string[]>();
  for (const { path, sha } of entries) {
    for (const { name } of declaredSymbols(path, texts.get(sha) ?? "")) {
      const key = normalisedName(name);
      definitions.set(key, [...(definitions.get(key) ?? []), path]);
    }
  }
  return { definitionsOf: (name) => definitions.get(normalisedName(name)) ?? [] };
}
