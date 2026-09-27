import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CoherenceReportSchema, type CoherenceIndex, type Measure } from "../contract.ts";
import { rescore } from "../rescore.ts";
import { dimensions, type Dimension } from "./changes.ts";

export type MeasureRule = (dimension: Dimension, name: string, measure: Measure, index: CoherenceIndex) => number | null;
export type Variant = { name: string; rule: MeasureRule };


export const asScored: MeasureRule = (_, __, { score }) => score;

export function without(dropped: string): MeasureRule {
  return (dimension, name, measure) => (`${dimension}.${name}` === dropped ? null : measure.score);
}

export function compositeUnder(index: CoherenceIndex, rule: MeasureRule): number {
  const scored = dimensions.flatMap((dimension) => {
    const scores = Object.entries(index.dimensions[dimension].measures).flatMap(([name, measure]) => {
      const score = rule(dimension, name, measure, index);
      return score === null ? [] : [score];
    });
    return scores.length === 0 ? [] : [{ weight: index.composite.weights[dimension], score: scores.reduce((sum, score) => sum + score, 0) / scores.length }];
  });
  const weight = scored.reduce((sum, { weight: each }) => sum + each, 0);
  return scored.reduce((sum, { weight: each, score }) => sum + each * score, 0) / weight;
}

export async function readIndex(reports: string, commit: string): Promise<CoherenceIndex> {
  return rescore(CoherenceReportSchema.parse(JSON.parse(await readFile(join(reports, `${commit}.json`), "utf8"))).index);
}
