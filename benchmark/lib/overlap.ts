import { mean, round } from "./metric-scores.ts";

export type Overlap = { modules: number; files: number };

const moduleDepth = 3;

export function overlap(a: string[], b: string[]): Overlap {
  return { modules: jaccard(new Set(a.map(moduleOf)), new Set(b.map(moduleOf))), files: jaccard(new Set(a), new Set(b)) };
}

export function consistency(runs: string[][]): Overlap | null {
  const pairs = runs.flatMap((first, index) => runs.slice(index + 1).map((second) => overlap(first, second)));
  if (pairs.length === 0) return null;
  return { modules: round(mean(pairs.map(({ modules }) => modules)), 2), files: round(mean(pairs.map(({ files }) => files)), 2) };
}

export function moduleOf(path: string): string {
  return path.split("/").slice(0, -1).slice(0, moduleDepth).join("/") || ".";
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  return round([...a].filter((item) => b.has(item)).length / union.size, 2);
}
