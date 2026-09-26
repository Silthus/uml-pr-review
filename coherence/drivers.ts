import type { FileCount } from "./contract.ts";

export const driverLimit = 10;

export function topFiles(counts: Iterable<[string, number]>): FileCount[] {
  return [...counts]
    .filter(([, count]) => count > 0)
    .sort(([fileA, a], [fileB, b]) => b - a || compare(fileA, fileB))
    .slice(0, driverLimit)
    .map(([file, count]) => ({ file, count }));
}

export function tally<T>(items: T[], keyOf: (item: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => compare(a, b)));
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
