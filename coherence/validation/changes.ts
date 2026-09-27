import type { CoherenceIndex } from "../contract.ts";
import { roundTo } from "../score.ts";

export const dimensions = ["architecture", "complexity", "smells", "tests"] as const;
export type Dimension = (typeof dimensions)[number];
export type Scores = Record<"composite" | Dimension, number>;

export type Changes = {
  delta: Scores;
  measures: Record<string, { before: number | null; after: number | null; scoreDelta: number }>;
  complexity: { entered: string[]; left: string[]; functions: number; overTen: number; overTwenty: number };
  cycles: { entered: string[]; left: string[] };
  bypasses: { added: string[]; removed: string[] };
  crossings: { inbound: number; outbound: number };
  lint: Record<string, number>;
  duplication: { percentage: number; clones: number; lines: number };
  markers: number;
  typeEscapes: number;
  tests: { testLines: number; productionLines: number; facadeFunctions: number; facadeCovered: number };
  files: { production: number; p90Lines: [number, number] };
  outsideDriven: boolean;
};

export function scoresOf(index: CoherenceIndex): Scores {
  const score = (dimension: Dimension) => index.dimensions[dimension].score ?? 0;
  return { composite: index.composite.score, architecture: score("architecture"), complexity: score("complexity"), smells: score("smells"), tests: score("tests") };
}

export function changesBetween(before: CoherenceIndex, after: CoherenceIndex): Changes {
  const [was, now] = [before.dimensions, after.dimensions];
  const [scoresBefore, scoresAfter] = [scoresOf(before), scoresOf(after)];
  const inbound = now.architecture.facade.inbound.crossings - was.architecture.facade.inbound.crossings;
  const inboundBypasses = now.architecture.facade.inbound.bypasses - was.architecture.facade.inbound.bypasses;
  return {
    delta: Object.fromEntries(Object.keys(scoresAfter).map((key) => [key, difference(scoresBefore[key as keyof Scores], scoresAfter[key as keyof Scores])])) as Scores,
    measures: measureChanges(before, after),
    complexity: {
      ...setChange(was.complexity.drivers.map(complexFunction), now.complexity.drivers.map(complexFunction), "entered", "left"),
      functions: now.complexity.functions.count - was.complexity.functions.count,
      overTen: now.complexity.functions.overTen - was.complexity.functions.overTen,
      overTwenty: now.complexity.functions.overTwenty - was.complexity.functions.overTwenty,
    },
    cycles: setChange(was.architecture.cycles.files, now.architecture.cycles.files, "entered", "left"),
    bypasses: setChange(was.architecture.facade.bypasses.map(bypass), now.architecture.facade.bypasses.map(bypass), "added", "removed"),
    crossings: { inbound, outbound: now.architecture.facade.outbound.crossings - was.architecture.facade.outbound.crossings },
    lint: countChanges({ ...prefixed("ruff", was.smells.ruff.rules), ...prefixed("oxlint", was.smells.oxlint.rules) }, { ...prefixed("ruff", now.smells.ruff.rules), ...prefixed("oxlint", now.smells.oxlint.rules) }),
    duplication: {
      percentage: difference(was.smells.duplication.percentage, now.smells.duplication.percentage, 2),
      clones: now.smells.duplication.clones - was.smells.duplication.clones,
      lines: now.smells.duplication.duplicatedLines - was.smells.duplication.duplicatedLines,
    },
    markers: now.smells.markers.count - was.smells.markers.count,
    typeEscapes: now.smells.typeEscapes.count - was.smells.typeEscapes.count,
    tests: {
      testLines: now.tests.ratio.testLines - was.tests.ratio.testLines,
      productionLines: now.tests.ratio.productionLines - was.tests.ratio.productionLines,
      facadeFunctions: now.tests.facadeCoverage.functions - was.tests.facadeCoverage.functions,
      facadeCovered: now.tests.facadeCoverage.covered - was.tests.facadeCoverage.covered,
    },
    files: { production: after.files.production - before.files.production, p90Lines: [was.complexity.files.p90Lines, now.complexity.files.p90Lines] },
    outsideDriven: inbound !== 0 || inboundBypasses !== 0,
  };
}

function measureChanges(before: CoherenceIndex, after: CoherenceIndex): Changes["measures"] {
  return Object.fromEntries(
    dimensions.flatMap((dimension) =>
      Object.entries(after.dimensions[dimension].measures).map(([name, measure]) => {
        const previous = before.dimensions[dimension].measures[name]!;
        return [`${dimension}.${name}`, { before: previous.value, after: measure.value, scoreDelta: difference(previous.score ?? 0, measure.score ?? 0) }];
      }),
    ),
  );
}

function setChange<Added extends string, Removed extends string>(before: string[], after: string[], added: Added, removed: Removed): Record<Added | Removed, string[]> {
  const [was, now] = [new Set(before), new Set(after)];
  return { [added]: after.filter((item) => !was.has(item)), [removed]: before.filter((item) => !now.has(item)) } as Record<Added | Removed, string[]>;
}

function countChanges(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return Object.fromEntries(keys.map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)]).filter(([, change]) => change !== 0));
}

function prefixed(tool: string, rules: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(rules).map(([rule, count]) => [`${tool}:${rule}`, count]));
}

function complexFunction({ file, function: name, ccn }: { file: string; function: string; ccn: number }): string {
  return `${file}:${name} (ccn ${ccn})`;
}

function bypass({ from, to, direction }: { from: string; to: string; direction: string }): string {
  return `${direction} ${from} -> ${to}`;
}

function difference(before: number, after: number, digits = 1): number {
  return roundTo(after - before, digits);
}
