import { basename } from "node:path";
import { scoreKeys, type BackfillManifest, type Scores, type ScopeSeries } from "../backfill.ts";
import { roundTo } from "../score.ts";
import { differenceInDifferences, type DifferenceInDifferences } from "./difference-in-differences.ts";
import type { ModuleBreakdown } from "./modules.ts";

export type Dimension = Exclude<keyof Scores, "composite">;
export const dimensions = ["architecture", "complexity", "smells", "tests"] as const satisfies readonly Dimension[];

export type ScopeView = ScopeSeries & { scope: string; label: string; slot: number; latest: Scores; change: Scores; steps: number; stepsBeyondBand: number };
export type MoverView = ScopeSeries["movers"][number] & { scope: string; label: string; timesBand: number | null; dimension: Dimension };
export type Intervention = { date: string; results: Record<keyof Scores, DifferenceInDifferences> };
export type ReportModel = {
  repository: string;
  ref: string;
  head: string;
  built: string;
  weeks: string[];
  runtime: BackfillManifest["runtime"];
  github: string | null;
  scopes: ScopeView[];
  movers: MoverView[];
  modules: ModuleBreakdown | null;
  intervention: Intervention | null;
};

const moverLimit = 10;

export function buildModel(manifest: BackfillManifest, options: { github?: string; modules: ModuleBreakdown | null; intervention?: string; built: Date }): ReportModel {
  const scopes = Object.entries(manifest.scopes).map(([scope, series], index) => scopeView(scope, series, index + 1));
  return {
    repository: manifest.repository,
    ref: manifest.ref,
    head: manifest.head,
    built: options.built.toISOString().slice(0, 10),
    weeks: [...new Set(scopes.flatMap(({ points }) => points.map(({ week }) => week)))].sort(),
    runtime: manifest.runtime,
    github: options.github ?? null,
    scopes,
    movers: topMovers(scopes),
    modules: options.modules,
    intervention: options.intervention === undefined ? null : intervention(scopes, options.intervention),
  };
}

export function labelOf(scope: string): string {
  return basename(scope);
}

function scopeView(scope: string, series: ScopeSeries, slot: number): ScopeView {
  const first = series.points[0]?.scores ?? zeroScores();
  const latest = series.points.at(-1)?.scores ?? zeroScores();
  const steps = series.points.slice(1).map((point, index) => Math.abs(point.scores.composite - series.points[index]!.scores.composite));
  return {
    ...series,
    scope,
    label: labelOf(scope),
    slot,
    latest,
    change: Object.fromEntries(scoreKeys.map((key) => [key, roundTo(latest[key] - first[key], 1)])) as Scores,
    steps: steps.length,
    stepsBeyondBand: steps.filter((step) => step > series.noise.band.composite).length,
  };
}

function topMovers(scopes: ScopeView[]): MoverView[] {
  return scopes
    .flatMap(({ scope, label, movers, noise }) =>
      movers.map((mover) => ({
        ...mover,
        scope,
        label,
        timesBand: noise.band.composite === 0 ? null : roundTo(Math.abs(mover.delta.composite) / noise.band.composite, 1),
        dimension: dimensions.reduce((best, dimension) => (Math.abs(mover.delta[dimension]) > Math.abs(mover.delta[best]) ? dimension : best)),
      })),
    )
    .filter(({ delta }) => delta.composite !== 0)
    .sort((a, b) => Math.abs(b.delta.composite) - Math.abs(a.delta.composite) || a.date.localeCompare(b.date))
    .slice(0, moverLimit);
}

function intervention(scopes: ScopeView[], date: string): Intervention {
  const [treated, ...controls] = scopes;
  if (treated === undefined) throw new Error("An intervention needs at least one scope.");
  const series = (scope: ScopeView, key: keyof Scores) => scope.points.map(({ week, scores }) => ({ week, value: scores[key] }));
  const results = Object.fromEntries(scoreKeys.map((key) => [key, differenceInDifferences({ treated: series(treated, key), controls: controls.map((control) => series(control, key)), intervention: date })]));
  return { date, results: results as Intervention["results"] };
}

function zeroScores(): Scores {
  return { composite: 0, architecture: 0, complexity: 0, smells: 0, tests: 0 };
}
