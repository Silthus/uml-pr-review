import type { ArchitecturePayload } from "../contracts/index.ts";

export type Range = { start: number; end: number };

export function fileIndexOf({ files }: ArchitecturePayload, path: string): number | undefined {
  const index = lowerBound(files.length, (at) => files[at]![0] < path);
  return files[index]?.[0] === path ? index : undefined;
}

export function filesWithin({ files }: ArchitecturePayload, module: string): Range {
  if (module === ".") return { start: 0, end: files.length };
  const prefix = `${module}/`;
  const pastPrefix = `${module}0`;
  return {
    start: lowerBound(files.length, (at) => files[at]![0] < prefix),
    end: lowerBound(files.length, (at) => files[at]![0] < pastPrefix),
  };
}

export function importsFrom({ imports }: ArchitecturePayload, sources: Range): Range {
  return {
    start: lowerBound(imports.length, (at) => imports[at]![0] < sources.start),
    end: lowerBound(imports.length, (at) => imports[at]![0] < sources.end),
  };
}

export function holds(range: Range, index: number): boolean {
  return index >= range.start && index < range.end;
}

function lowerBound(length: number, isBefore: (index: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (isBefore(middle)) low = middle + 1;
    else high = middle;
  }
  return low;
}
