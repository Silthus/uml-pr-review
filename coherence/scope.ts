import type { ArchitecturePayload, ModuleKind } from "../src/architecture/contracts/index.ts";
import { listBlobs, readBlobs } from "../src/architecture/index/git.ts";

export type ScopeFile = { path: string; sha: string; text: string; lines: number };

export type Scope = {
  path: string;
  production: ScopeFile[];
  tests: ScopeFile[];
  excluded: string[];
  isMeasured(path: string): boolean;
  isWithin(path: string): boolean;
};

const unmeasuredKinds = new Set<ModuleKind>(["migrations", "generated"]);
const measuredSource = /\.(py|tsx?)$/;

export async function readScope(root: string, payload: ArchitecturePayload, path: string): Promise<Scope> {
  const isWithin = (file: string) => path === "." || file.startsWith(`${path}/`);
  const unmeasured = unmeasuredModules(payload);
  const inScope = payload.files.filter(([file]) => isWithin(file) && measuredSource.test(file));
  if (inScope.length === 0) throw new Error(`${path} holds no .py, .ts, or .tsx files at ${payload.commit ?? payload.tree}.`);
  const excluded = inScope.filter(([, module]) => unmeasured[module]).map(([file]) => file);
  const kept = inScope.filter(([, module]) => !unmeasured[module]);
  const shas = new Map((await listBlobs(root, payload.tree)).map(({ path: file, sha }) => [file, sha]));
  const texts = await readBlobs(root, kept.map(([file]) => shas.get(file)!));
  const scopeFile = (file: string): ScopeFile => {
    const sha = shas.get(file)!;
    const text = texts.get(sha) ?? "";
    return { path: file, sha, text, lines: nonBlankLines(text) };
  };
  const production = kept.filter(([, , , role]) => role === "production").map(([file]) => scopeFile(file));
  const measured = new Set(production.map(({ path: file }) => file));
  return {
    path,
    production,
    tests: kept.filter(([, , , role]) => role === "test").map(([file]) => scopeFile(file)),
    excluded,
    isMeasured: (file) => measured.has(file),
    isWithin,
  };
}

export function unmeasuredModules(payload: ArchitecturePayload): Uint8Array {
  const hasUnmeasuredAncestor = (module: number): boolean => {
    for (let ancestor = module; ancestor !== -1; ancestor = payload.modules[ancestor]![2]) if (unmeasuredKinds.has(payload.modules[ancestor]![3])) return true;
    return false;
  };
  return Uint8Array.from(payload.modules, (_, module) => Number(hasUnmeasuredAncestor(module)));
}

export function nonBlankLines(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) if (line.trim() !== "") count++;
  return count;
}

export function totalLines(files: ScopeFile[]): number {
  return files.reduce((total, { lines }) => total + lines, 0);
}
