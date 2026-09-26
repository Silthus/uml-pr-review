import type { JevGrade } from "./jev.ts";
import { judgeScore, mean, round, type JudgeVerdict } from "./metric-scores.ts";
import type { Overlap } from "./overlap.ts";
import type { ProcessMetrics } from "./process-metrics.ts";
import type { StaticQuality } from "./static-quality.ts";
import type { TestAngle } from "./test-angle.ts";

export const angleWeights = { architecture: 25, astra: 20, jev: 15, staticQuality: 10, tests: 15, alignment: 10, process: 5 } as const;
export type Angle = keyof typeof angleWeights;
export type Angles = Record<Angle, number | null>;

export const staticPenalties = { complexFunction: 15, meanCcnAboveFive: 5, ruffFinding: 5, duplicatedPercent: 1 } as const;
export const fullTestRatio = 0.5;
export const processTargets = { exploration: 3, reasoning: 2 } as const;

export type AngleInputs = {
  hygiene: number | null;
  focusScore: number | null;
  verdict?: JudgeVerdict;
  jev?: JevGrade;
  staticQuality?: StaticQuality;
  ruffFindings: number | null;
  tests?: TestAngle;
  alignment: Overlap | null;
  process: ProcessMetrics | null;
};

export function anglesOf(inputs: AngleInputs): Angles {
  return {
    architecture: inputs.hygiene === null || inputs.focusScore === null ? null : round((2 * inputs.hygiene + inputs.focusScore) / 3),
    astra: inputs.verdict ? judgeScore(inputs.verdict) : null,
    jev: inputs.jev?.score ?? null,
    staticQuality: staticScore(inputs.staticQuality, inputs.ruffFindings),
    tests: inputs.tests ? testsScore(inputs.tests) : null,
    alignment: inputs.alignment ? round(50 * (inputs.alignment.modules + inputs.alignment.files)) : null,
    process: inputs.process ? processScore(inputs.process) : null,
  };
}

export function compositeOf(angles: Angles): number | null {
  const present = (Object.keys(angleWeights) as Angle[]).filter((angle) => angles[angle] !== null);
  const weight = present.reduce((total, angle) => total + angleWeights[angle], 0);
  if (weight === 0) return null;
  return round(present.reduce((total, angle) => total + angleWeights[angle] * angles[angle]!, 0) / weight);
}

export function staticScore(quality: StaticQuality | undefined, ruffFindings: number | null): number | null {
  const complexity = quality && quality.complexity !== "unavailable" ? quality.complexity : undefined;
  const duplication = quality && quality.duplication !== "unavailable" ? quality.duplication : undefined;
  if (!complexity && !duplication && ruffFindings === null) return null;
  const penalty =
    staticPenalties.complexFunction * (complexity?.overTen ?? 0) +
    staticPenalties.meanCcnAboveFive * Math.max(0, (complexity?.meanCcn ?? 0) - 5) +
    staticPenalties.ruffFinding * (ruffFindings ?? 0) +
    staticPenalties.duplicatedPercent * (duplication?.percentage ?? 0);
  return round(Math.max(0, 100 - penalty));
}

export function testsScore(tests: TestAngle): number | null {
  const parts = [
    tests.testRatio === null ? null : Math.min(1, tests.testRatio / fullTestRatio),
    tests.referenceCoverage,
    tests.dynamic.status === "not run" ? null : tests.dynamic.status === "passed" ? 1 : 0,
  ].filter((part): part is number => part !== null);
  return parts.length > 0 ? round(100 * mean(parts)) : null;
}

export function processScore(process: ProcessMetrics): number {
  const exploration = Math.min(1, process.architectureExplorationBeforeEdit / processTargets.exploration);
  const reasoning = Math.min(1, process.architectureReasoningBeforeEdit / processTargets.reasoning);
  return round(50 * exploration + 50 * reasoning);
}
