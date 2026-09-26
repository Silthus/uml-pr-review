import type { Seam } from "../contracts/index.ts";
import { depthOf, isWithin } from "./paths.ts";

type Crossing = { file: string; target: string };

export function matches(seam: Seam, { file, target }: Crossing): boolean {
  return isWithin(file, seam.from) && isWithin(target, seam.to);
}

export function mostSpecificMatch(seams: Seam[], crossing: Crossing): Seam | undefined {
  return mostSpecific(seams.filter((seam) => matches(seam, crossing)));
}

export function mostSpecific(seams: Seam[]): Seam | undefined {
  return seams.reduce<Seam | undefined>((best, seam) => (!best || isMoreSpecific(seam, best) ? seam : best), undefined);
}

export function regionOf({ from, to }: Pick<Seam, "from" | "to">): string {
  const fromSegments = segmentsOf(from);
  const toSegments = segmentsOf(to);
  let common = 0;
  while (common < fromSegments.length && common < toSegments.length && fromSegments[common] === toSegments[common]) common++;
  return toSegments.slice(0, common + 1).join("/");
}

function isMoreSpecific(seam: Seam, other: Seam): boolean {
  const byFrom = depthOf(seam.from) - depthOf(other.from);
  return byFrom > 0 || (byFrom === 0 && depthOf(seam.to) > depthOf(other.to));
}

function segmentsOf(path: string): string[] {
  return path === "." ? [] : path.split("/");
}
