import type { BoundaryHygiene } from "./boundary.ts";
import type { Focus } from "./focus.ts";

export const weights = { hygiene: 0.4, judge: 0.4, focus: 0.2 } as const;

export const hygienePenalties = {
  facadeBypass: 25,
  newCycle: 25,
  undeclaredDependency: 25,
  declaredDependency: 10,
  unresolvedImport: 10,
} as const;

export const judgeDimensions = ["seams", "cohesion", "coupling", "fit"] as const;
export type JudgeDimension = (typeof judgeDimensions)[number] | "overall";
export type JudgeVerdict = Record<JudgeDimension, { score: number; justification: string }>;

const focusMetrics = ["modulesTouched", "newCrossModuleEdges", "linesChanged"] as const;
type FocusSample = Record<(typeof focusMetrics)[number], number>;

export function hygieneScore(boundary: BoundaryHygiene): number {
  const dependencies = boundary.newCrossProductDependencies;
  const penalty =
    hygienePenalties.facadeBypass * boundary.facadeBypasses.length +
    hygienePenalties.newCycle * boundary.newCycles.length +
    hygienePenalties.undeclaredDependency * dependencies.filter(({ declared }) => !declared).length +
    hygienePenalties.declaredDependency * dependencies.filter(({ declared }) => declared).length +
    hygienePenalties.unresolvedImport * boundary.newUnresolvedImports.length;
  return Math.max(0, 100 - penalty);
}

export function focusScores(focuses: Record<string, Focus>): Record<string, number> {
  const samples = Object.entries(focuses).map(([name, focus]) => [name, focusSample(focus)] as const);
  const best = Object.fromEntries(focusMetrics.map((metric) => [metric, Math.min(...samples.map(([, sample]) => sample[metric]))])) as FocusSample;
  return Object.fromEntries(samples.map(([name, sample]) => [name, round(100 * mean(focusMetrics.map((metric) => (best[metric] + 1) / (sample[metric] + 1))))]));
}

export function judgeScore(verdict: JudgeVerdict): number {
  return round(10 * mean(judgeDimensions.map((dimension) => verdict[dimension].score)));
}

export function compositeScore(parts: { hygiene: number; judge: number; focus: number }): number {
  return round(weights.hygiene * parts.hygiene + weights.judge * parts.judge + weights.focus * parts.focus);
}

export function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function focusSample(focus: Focus): FocusSample {
  return { modulesTouched: focus.modulesTouched, newCrossModuleEdges: focus.newCrossModuleEdges, linesChanged: focus.linesAdded + focus.linesRemoved };
}
