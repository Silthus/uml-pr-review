import type { CoherenceIndex, DimensionWeights, Measure } from "./contract.ts";

export type Anchor = { best: number; worst: number };

export const anchors = {
  propagationCost: { best: 0, worst: 0.4 },
  cycleShare: { best: 0, worst: 0.3 },
  facadeBypassesPerKloc: { best: 0, worst: 10 },
  p90Ccn: { best: 2, worst: 12 },
  shareOverTen: { best: 0, worst: 0.2 },
  shareOverTwenty: { best: 0, worst: 0.05 },
  p90FunctionNloc: { best: 10, worst: 60 },
  p90FileLines: { best: 100, worst: 800 },
  ruffPerKloc: { best: 0, worst: 10 },
  oxlintPerKloc: { best: 0, worst: 5 },
  duplicationPercentage: { best: 0, worst: 10 },
  markersPerKloc: { best: 0, worst: 2 },
  typeEscapesPerKloc: { best: 0, worst: 20 },
  testRatio: { best: 1, worst: 0 },
} as const satisfies Record<string, Anchor>;

export const scoringVersion = 2;

export const dimensionWeights: DimensionWeights = { architecture: 40, complexity: 30, smells: 20, tests: 10 };

export function measure(value: number | null, anchor: Anchor): Measure {
  return { value, score: value === null ? null : anchoredScore(value, anchor), ...anchor };
}

export function anchoredScore(value: number, { best, worst }: Anchor): number {
  const fraction = (worst - value) / (worst - best);
  return 100 * Math.min(1, Math.max(0, fraction));
}

export function dimensionScore(measures: Record<string, Measure>): number | null {
  const scores = Object.values(measures).flatMap(({ score }) => (score === null ? [] : [score]));
  return scores.length === 0 ? null : scores.reduce((total, score) => total + score, 0) / scores.length;
}

export function compositeScore(scores: Record<keyof DimensionWeights, number | null>, weights = dimensionWeights): number {
  const weighted = (Object.keys(weights) as (keyof DimensionWeights)[]).flatMap((dimension) => {
    const score = scores[dimension];
    return score === null ? [] : [{ score, weight: weights[dimension] }];
  });
  const totalWeight = weighted.reduce((total, { weight }) => total + weight, 0);
  return totalWeight === 0 ? 0 : weighted.reduce((total, { score, weight }) => total + score * weight, 0) / totalWeight;
}

export function compositeOf({ architecture, complexity, smells, tests }: Pick<CoherenceIndex["dimensions"], "architecture" | "complexity" | "smells" | "tests">): CoherenceIndex["composite"] {
  return { score: compositeScore({ architecture: architecture.score, complexity: complexity.score, smells: smells.score, tests: tests.score }), weights: dimensionWeights };
}

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : roundTo(numerator / denominator, 4);
}

export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]!;
}
