import { roundTo } from "../score.ts";

export type Series = { week: string; value: number }[];
export type Slopes = { before: number; after: number; change: number };
export type DifferenceInDifferences = { treated: Slopes; controls: Slopes; effect: number; points: { before: number; after: number } };

const weekMs = 7 * 24 * 60 * 60 * 1000;

export function differenceInDifferences({ treated, controls, intervention }: { treated: Series; controls: Series[]; intervention: string }): DifferenceInDifferences {
  if (controls.length === 0) throw new Error("Difference in differences needs at least one control series.");
  const treatedSlopes = slopesAround(treated, intervention);
  const controlSlopes = controls.map((control) => slopesAround(control, intervention));
  const controlsMean: Slopes = {
    before: mean(controlSlopes.map(({ before }) => before)),
    after: mean(controlSlopes.map(({ after }) => after)),
    change: mean(controlSlopes.map(({ change }) => change)),
  };
  const [before, after] = split(treated, intervention);
  return { treated: treatedSlopes, controls: controlsMean, effect: roundTo(treatedSlopes.change - controlsMean.change, 4), points: { before: before.length, after: after.length } };
}

function slopesAround(series: Series, intervention: string): Slopes {
  const [before, after] = split(series, intervention);
  if (before.length < 2 || after.length < 2) throw new Error(`An intervention needs at least two points on each side; ${intervention} leaves ${before.length} before and ${after.length} after.`);
  const slopes = { before: slopePerWeek(before), after: slopePerWeek(after) };
  return { ...slopes, change: roundTo(slopes.after - slopes.before, 4) };
}

function split(series: Series, intervention: string): [Series, Series] {
  return [series.filter(({ week }) => week < intervention), series.filter(({ week }) => week >= intervention)];
}

function slopePerWeek(series: Series): number {
  const origin = Date.parse(series[0]!.week);
  const points = series.map(({ week, value }) => ({ x: (Date.parse(week) - origin) / weekMs, y: value }));
  const meanX = mean(points.map(({ x }) => x));
  const meanY = mean(points.map(({ y }) => y));
  const covariance = points.reduce((total, { x, y }) => total + (x - meanX) * (y - meanY), 0);
  const variance = points.reduce((total, { x }) => total + (x - meanX) ** 2, 0);
  return roundTo(covariance / variance, 4);
}

function mean(values: number[]): number {
  return roundTo(values.reduce((total, value) => total + value, 0) / values.length, 4);
}
