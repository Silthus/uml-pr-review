import { architectureMeasures } from "./architecture.ts";
import { complexityMeasures } from "./complexity.ts";
import type { CoherenceIndex, CoherenceReport, Measure } from "./contract.ts";
import { compositeScore, dimensionScore, dimensionWeights } from "./score.ts";
import { smellsMeasures } from "./smells.ts";
import { testsMeasures } from "./tests.ts";

type ScoredDimensions = Pick<CoherenceIndex["dimensions"], "architecture" | "complexity" | "smells" | "tests">;

export function rescoreReport(report: CoherenceReport): CoherenceReport {
  return { ...report, index: rescore(report.index) };
}

export function rescore(index: CoherenceIndex): CoherenceIndex {
  const { architecture, complexity, smells, tests, ladder } = index.dimensions;
  const dimensions = {
    architecture: scored(architecture, architectureMeasures(architecture)),
    complexity: scored(complexity, complexityMeasures(complexity)),
    smells: scored(smells, smellsMeasures(smells)),
    tests: scored(tests, testsMeasures(tests)),
  };
  return { ...index, composite: compositeOf(dimensions), dimensions: { ...dimensions, ladder } };
}

export function compositeOf({ architecture, complexity, smells, tests }: ScoredDimensions): CoherenceIndex["composite"] {
  return { score: compositeScore({ architecture: architecture.score, complexity: complexity.score, smells: smells.score, tests: tests.score }), weights: dimensionWeights };
}

function scored<Dimension extends { score: number | null; measures: Record<string, Measure> }>(dimension: Dimension, measures: Record<string, Measure>): Dimension {
  return { ...dimension, score: dimensionScore(measures), measures };
}
