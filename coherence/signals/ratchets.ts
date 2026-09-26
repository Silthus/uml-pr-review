import { listBlobs, readBlobs } from "../../src/architecture/index/git.ts";

export type BaselineEntry = { path: string; source: string };

const baselineFile = /(?:^|\/)[^/]*baseline[^/]*\.(?:txt|json|ya?ml)$/i;

export async function readBaselineEntries(root: string, tree: string, scope: string): Promise<BaselineEntry[]> {
  const baselines = (await listBlobs(root, tree)).filter(({ path }) => baselineFile.test(path));
  const texts = await readBlobs(root, baselines.map(({ sha }) => sha));
  const entry = scopeEntry(scope);
  return baselines.flatMap(({ path, sha }) =>
    (texts.get(sha) ?? "").split("\n").flatMap((line, index) => [...line.matchAll(entry)].map(([token]) => ({ path: asPath(token), source: `${path}:${index + 1}` }))),
  );
}

function scopeEntry(scope: string): RegExp {
  const slashed = escape(scope);
  const dotted = escape(scope.replaceAll("/", "."));
  return new RegExp(`(?<![\\w./-])(?:${slashed}(?:/[\\w.-]+)*|${dotted}(?:\\.\\w+)*)(?![\\w-])`, "g");
}

function asPath(token: string): string {
  return token.includes("/") ? token : token.replaceAll(".", "/");
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
