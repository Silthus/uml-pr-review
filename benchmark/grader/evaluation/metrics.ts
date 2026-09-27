import { subtypes, type Subtype } from "../../corrections/labels.ts";
import { isProductionSource } from "../change.ts";
import type { DetectorName } from "../violations.ts";
import type { StoredGrade, StoredViolation } from "./store.ts";

export type ScoredCase = { id: string; subtype: Subtype; path: string; line: number | null; verified: boolean | undefined; reviewed: StoredGrade; fixed: StoredGrade };
export type Rate = { hits: number; total: number };
type CaseOutcome = { flagged: Set<DetectorName>; near: Set<DetectorName>; fixed: Set<DetectorName>; addedLines: number };

const nearLines = 20;

export function outcomeOf(scored: ScoredCase, detectors: readonly DetectorName[]): CaseOutcome {
  const flagged = new Set<DetectorName>();
  const near = new Set<DetectorName>();
  const fixed = new Set<DetectorName>();
  for (const detector of detectors) {
    const introduced = (scored.reviewed.detectors[detector]?.introduced ?? []).filter(({ file }) => file === scored.path);
    if (introduced.length > 0) flagged.add(detector);
    if (scored.line !== null && introduced.some(({ line }) => line !== null && Math.abs(line - scored.line!) <= nearLines)) near.add(detector);
    if ((scored.fixed.detectors[detector]?.removed ?? []).some(({ file }) => file === scored.path)) fixed.add(detector);
  }
  return { flagged, near, fixed, addedLines: scored.reviewed.files.find(({ path }) => path === scored.path)?.addedLines ?? 0 };
}

export function rate(items: boolean[]): Rate {
  return { hits: items.filter(Boolean).length, total: items.length };
}

export function percent({ hits, total }: Rate): string {
  return total === 0 ? "n/a" : `${((100 * hits) / total).toFixed(1)}%`;
}

export function bySubtype<T>(cases: ScoredCase[], measure: (scored: ScoredCase) => T): Record<Subtype | "all", T[]> {
  const grouped = Object.fromEntries([...subtypes, "all"].map((subtype) => [subtype, [] as T[]])) as Record<Subtype | "all", T[]>;
  for (const scored of cases) {
    const value = measure(scored);
    grouped[scored.subtype].push(value);
    grouped.all.push(value);
  }
  return grouped;
}

type FileFlags = { flagged: boolean[]; addedLines: number[] };

export function productionFileFlags(grades: StoredGrade[], detectors: readonly DetectorName[]): FileFlags {
  const flags: FileFlags = { flagged: [], addedLines: [] };
  for (const grade of grades) {
    const flaggedFiles = new Set(detectors.flatMap((detector) => (grade.detectors[detector]?.introduced ?? []).map(({ file }) => file)));
    for (const { path, addedLines } of grade.files.filter(({ path }) => isProductionSource(path))) {
      flags.flagged.push(flaggedFiles.has(path));
      flags.addedLines.push(addedLines);
    }
  }
  return flags;
}

export function matchedLineThreshold(addedLines: number[], flagRate: number): number {
  const sorted = [...addedLines].sort((a, b) => b - a);
  const flaggedCount = Math.floor(flagRate * sorted.length);
  return flaggedCount >= sorted.length ? 0 : sorted[flaggedCount]!;
}

export function introducedIn(grade: StoredGrade, detectors: readonly DetectorName[]): StoredViolation[] {
  return detectors.flatMap((detector) => grade.detectors[detector]?.introduced ?? []);
}

export function quantile(sorted: number[], q: number): number {
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}
