#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { dimensionWeights, percentile, roundTo } from "../score.ts";
import type { Attribution } from "./attribute.ts";
import { dimensions } from "./changes.ts";
import { diffLocalDensity, DiffLocalRunSchema } from "./diff-local.ts";
import { readVerdicts, type Verdict, type Verdicts } from "./judges.ts";
import { asScored, compositeUnder, facadeCountsInsteadOfShares, facadeCoverageGated, facadeCoverageSmoothed, readIndex, without, type MeasureRule } from "./rescore.ts";
import { classOf, flatSampleSize, judged, prThreshold, readAttribution, sampleStratumOf, type IndexClass } from "./selection.ts";
import { cohenKappa, spearman } from "./statistics.ts";

type JudgeClass = "better" | "neutral" | "worse";
type Row = Attribution & { exact: number; indexClass: IndexClass; sampleStratum: IndexClass; weight: number; judged: boolean; opus: Verdict | null; astra: Verdict | null; mean: number | null; variants: Record<string, number>; local: { score: number; density: number } };

const repository = "https://github.com/PostHog/posthog";
const measureNames = ["architecture.propagationCost", "architecture.cycleShare", "architecture.facadeShare", "complexity.p90Ccn", "complexity.shareOverTen", "complexity.shareOverTwenty", "complexity.p90FunctionNloc", "complexity.p90FileLines", "smells.ruffPerKloc", "smells.oxlintPerKloc", "smells.duplicationPercentage", "smells.markersPerKloc", "smells.typeEscapesPerKloc", "tests.testRatio", "tests.facadeCoverage"];
const measuresPerDimension = Object.fromEntries(dimensions.map((dimension) => [dimension, measureNames.filter((name) => name.startsWith(`${dimension}.`)).length]));

const variantRules: Record<string, MeasureRule> = {
  current: asScored,
  "facade coverage gated below 5 functions": facadeCoverageGated,
  "facade coverage Laplace-smoothed": facadeCoverageSmoothed,
  "facade measures as counts (untested facade functions, bypasses)": facadeCountsInsteadOfShares,
  ...Object.fromEntries(measureNames.map((name) => [`without ${name}`, without(name)])),
};

async function rowsOf(commits: Attribution[], verdicts: Verdicts, reports: string, local: Map<string, Row["local"]>): Promise<Row[]> {
  const judgedCommits = new Set(judged(commits).map(({ commit }) => commit));
  const flatWeight = commits.filter((commit) => sampleStratumOf(commit) === "flat").length / flatSampleSize;
  return Promise.all(
    commits.map(async (commit) => {
      const [before, after] = await Promise.all([readIndex(reports, commit.parent), readIndex(reports, commit.commit)]);
      const opus = commit.pr === null ? null : (verdicts.opus.get(commit.pr) ?? null);
      const astra = commit.pr === null ? null : (verdicts.astra.get(commit.pr) ?? null);
      const variants = Object.fromEntries(Object.entries(variantRules).map(([name, rule]) => [name, compositeUnder(after, rule) - compositeUnder(before, rule)]));
      return {
        ...commit,
        exact: variants.current!,
        indexClass: classOf(variants.current!),
        sampleStratum: sampleStratumOf(commit),
        weight: sampleStratumOf(commit) === "flat" ? flatWeight : 1,
        judged: judgedCommits.has(commit.commit),
        opus,
        astra,
        mean: opus && astra ? (opus.score + astra.score) / 2 : null,
        local: local.get(commit.commit) ?? { score: 0, density: 0 },
        variants,
      };
    }),
  );
}

function judgeClass(mean: number): JudgeClass {
  return mean >= 0.5 ? "better" : mean <= -0.5 ? "worse" : "neutral";
}

function sign(value: number): string {
  return value > 0 ? "+" : value < 0 ? "-" : "0";
}

function contribution(row: Attribution, measure: string): number {
  const dimension = measure.split(".")[0] as keyof typeof dimensionWeights;
  return (row.measures[measure]!.scoreDelta * dimensionWeights[dimension]) / 100 / measuresPerDimension[dimension]!;
}

function driversOf(row: Attribution): string {
  const parts: string[] = [];
  const count = (label: string, value: number, digits = 0) => value !== 0 && parts.push(`${label} ${value > 0 ? "+" : ""}${roundTo(value, digits)}`);
  count("production lines", row.tests.productionLines);
  count("test lines", row.tests.testLines);
  count("production files", row.files.production);
  if (row.files.p90Lines[0] !== row.files.p90Lines[1]) parts.push(`p90 file lines ${row.files.p90Lines[0]}→${row.files.p90Lines[1]}`);
  count("functions over CCN 10", row.complexity.overTen);
  count("functions over CCN 20", row.complexity.overTwenty);
  if (row.complexity.entered.length > 0) parts.push(`top-10 complex in: ${row.complexity.entered.slice(0, 2).join(", ")}`);
  if (row.cycles.entered.length + row.cycles.left.length > 0) parts.push(`cycle files +${row.cycles.entered.length}/−${row.cycles.left.length}`);
  if (row.bypasses.added.length + row.bypasses.removed.length > 0) parts.push(`facade bypasses +${row.bypasses.added.length}/−${row.bypasses.removed.length}`);
  count("inbound crossings", row.crossings.inbound);
  count("outbound crossings", row.crossings.outbound);
  const lint = Object.values(row.lint).reduce((sum, change) => sum + change, 0);
  if (lint !== 0) parts.push(`lint ${lint > 0 ? "+" : ""}${lint} (${Object.entries(row.lint).slice(0, 3).map(([rule, change]) => `${rule} ${change > 0 ? "+" : ""}${change}`).join(", ")})`);
  count("duplication %", row.duplication.percentage, 2);
  count("markers", row.markers);
  count("type escapes", row.typeEscapes);
  count("facade functions", row.tests.facadeFunctions);
  count("facade covered", row.tests.facadeCovered);
  return parts.join("; ");
}

function topMeasures(row: Attribution, limit = 3): string {
  return measureNames
    .map((name) => ({ name, value: contribution(row, name) }))
    .filter(({ value }) => Math.abs(value) >= 0.05)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit)
    .map(({ name, value }) => `${name} ${value > 0 ? "+" : ""}${value.toFixed(2)}`)
    .join(", ");
}

function table(header: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.map((cell) => String(cell).replaceAll("|", "\\|")).join(" | ")} |`;
  return [line(header), `| ${header.map(() => "---").join(" | ")} |`, ...rows.map(line)].join("\n");
}

function fixed(value: number | null, digits = 2): string {
  return value === null || Number.isNaN(value) ? "n/a" : value.toFixed(digits);
}

function share(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${part}/${whole} (${Math.round((100 * part) / whole)}%)`;
}

function prLink(row: Attribution): string {
  return row.pr === null ? row.commit.slice(0, 12) : `[#${row.pr}](${repository}/pull/${row.pr})`;
}

function signed(value: number, digits = 1): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function overview(rows: Row[]): string {
  const types = [...new Set(rows.map(({ type }) => type))].sort();
  const moved = rows.filter(({ delta }) => delta.composite !== 0).length;
  const byType = types.map((type) => {
    const ofType = rows.filter((row) => row.type === type);
    const countOf = (indexClass: IndexClass) => ofType.filter((row) => row.indexClass === indexClass).length;
    return [type, ofType.length, countOf("improved"), countOf("flat"), countOf("worsened")];
  });
  const total = (indexClass: IndexClass) => rows.filter((row) => row.indexClass === indexClass).length;
  const rounded = (indexClass: IndexClass) => rows.filter((row) => row.sampleStratum === indexClass).length;
  const roundingOnly = rows.filter((row) => row.sampleStratum !== "flat" && row.indexClass === "flat");
  const hiddenByRounding = rows.filter((row) => row.sampleStratum === "flat" && row.indexClass !== "flat").length;
  const distribution = [...Map.groupBy(rows, ({ delta }) => delta.composite)].sort(([a], [b]) => a - b).map(([value, members]) => `${signed(value)}: ${members.length}`);
  const magnitudes = rows.map(({ delta }) => Math.abs(delta.composite));
  const exactMagnitudes = rows.map(({ exact }) => Math.abs(exact));
  const bucket = (low: number, high: number) => exactMagnitudes.filter((magnitude) => magnitude >= low && magnitude < high).length;
  const unroundedBuckets: [string, number][] = [["below 0.01", bucket(0, 0.01)], ["0.01 to 0.05", bucket(0.01, 0.05)], ["0.05 to 0.1", bucket(0.05, 0.1)], ["0.1 to 0.2", bucket(0.1, 0.2)], ["0.2 and above", bucket(0.2, Infinity)]];
  return [
    "## Overview",
    `${rows.length} first-parent commits; ${rows.filter(({ pr }) => pr !== null).length} carry a PR number. The printed (rounded) composite moved at all (|Δ| ≥ 0.1) for ${share(moved, rows.length)}. Classes use the unrounded composite delta with the PR threshold ±${prThreshold}.`,
    table(["type", "PRs", "improved", "flat", "worsened"], [...byType, ["**all**", rows.length, total("improved"), total("flat"), total("worsened")]]),
    `On the printed, rounded composite the classes would be ${rounded("improved")} improved, ${rounded("flat")} flat, ${rounded("worsened")} worsened; that rounded split drew the judge sample. ${roundingOnly.length} rounded movers are below the threshold unrounded (unrounded |Δ| ${fixed(Math.min(...roundingOnly.map(({ exact }) => Math.abs(exact))), 3)} to ${fixed(Math.max(...roundingOnly.map(({ exact }) => Math.abs(exact))), 3)}), and ${hiddenByRounding} unrounded movers hide in the rounded flat class.`,
    `Composite Δ distribution: ${distribution.join(", ")}.`,
    `Rounded |Δ| percentiles: p50 ${percentile(magnitudes, 0.5)}, p75 ${percentile(magnitudes, 0.75)}, p90 ${percentile(magnitudes, 0.9)}, p95 ${percentile(magnitudes, 0.95)}, max ${Math.max(...magnitudes)}.`,
    `Unrounded |Δ|: ${unroundedBuckets.map(([label, count]) => `${label}: ${count}`).join(", ")}; p90 ${fixed(percentile(exactMagnitudes, 0.9), 3)}, p95 ${fixed(percentile(exactMagnitudes, 0.95), 3)}, p97 ${fixed(percentile(exactMagnitudes, 0.97), 3)}.`,
    `Outside-driven (inbound facade crossings or bypasses changed): ${rows.filter(({ outsideDriven }) => outsideDriven).length}. Commits whose scope change touched no measured production file: ${rows.filter(({ lines }) => lines.scopeMeasured.files === 0).length}, of which ${rows.filter(({ lines, delta }) => lines.scopeMeasured.files === 0 && delta.composite !== 0).length} still moved the composite.`,
  ].join("\n\n");
}

function interJudge(rows: Row[]): string {
  const both = rows.filter((row) => row.opus && row.astra);
  const opus = both.map((row) => row.opus!.score);
  const astra = both.map((row) => row.astra!.score);
  const signs = (scores: number[]) => scores.map(sign);
  const crossTab = ["+", "0", "-"].map((opusSign) => [`Opus ${opusSign}`, ...["+", "0", "-"].map((astraSign) => both.filter((row) => sign(row.opus!.score) === opusSign && sign(row.astra!.score) === astraSign).length)]);
  const histogram = (scores: number[]) => [-2, -1, 0, 1, 2].map((score) => scores.filter((value) => value === score).length).join(" / ");
  return [
    "## Inter-judge agreement (the ceiling)",
    `${both.length} PRs judged by both. Exact score agreement ${share(both.filter((row) => row.opus!.score === row.astra!.score).length, both.length)}; sign agreement ${share(both.filter((row) => sign(row.opus!.score) === sign(row.astra!.score)).length, both.length)}.`,
    `Cohen's kappa on the sign: **${fixed(cohenKappa(signs(opus), signs(astra)))}**. Spearman on the scale: **${fixed(spearman(opus, astra))}**.`,
    `Score histograms (−2 / −1 / 0 / +1 / +2): Opus ${histogram(opus)}; Astra ${histogram(astra)}.`,
    table(["", "Astra +", "Astra 0", "Astra −"], crossTab),
  ].join("\n\n");
}

function indexVersusJudges(rows: Row[]): string {
  const scored = rows.filter((row) => row.mean !== null);
  const moved = scored.filter((row) => row.indexClass !== "flat");
  const flat = scored.filter((row) => row.indexClass === "flat");
  const agrees = (row: Row) => (row.indexClass === "improved" ? row.mean! > 0 : row.mean! < 0);
  const decided = moved.filter((row) => row.mean !== 0);
  const indexSign = (row: Row) => (row.indexClass === "improved" ? "+" : row.indexClass === "worsened" ? "-" : "0");
  const kappaWith = (judge: "opus" | "astra") => cohenKappa(scored.map(indexSign), scored.map((row) => sign(row[judge]!.score)));
  const confusion = (["improved", "flat", "worsened"] as IndexClass[]).map((indexClass) => {
    const members = scored.filter((row) => row.indexClass === indexClass);
    return [indexClass, members.length, ...(["better", "neutral", "worse"] as JudgeClass[]).map((judgement) => members.filter((row) => judgeClass(row.mean!) === judgement).length)];
  });
  const weighted = (members: Row[]) => members.reduce((sum, row) => sum + row.weight, 0);
  const nonNeutral = (row: Row) => judgeClass(row.mean!) !== "neutral";
  const bothAgree = (row: Row) => row.opus!.score !== 0 && Math.sign(row.opus!.score) === Math.sign(row.astra!.score);
  const blindness = (changed: (row: Row) => boolean) => {
    const blind = weighted(flat.filter(changed));
    const seen = weighted(moved.filter(changed));
    return `about ${Math.round(blind)} flat against ${Math.round(seen)} moved, so about ${Math.round((100 * blind) / Math.max(1, blind + seen))}% blind`;
  };
  return [
    "## Index versus judges",
    `Sign agreement on the ${moved.length} non-flat PRs: ${share(moved.filter(agrees).length, moved.length)} counting a judge mean of 0 as disagreement; ${share(decided.filter(agrees).length, decided.length)} over the ${decided.length} where the judges lean one way.`,
    `Spearman(unrounded composite Δ, mean judge): ${fixed(spearman(scored.map(({ exact }) => exact), scored.map(({ mean }) => mean!)))} over all ${scored.length} judged PRs; ${fixed(spearman(moved.map(({ exact }) => exact), moved.map(({ mean }) => mean!)))} over the non-flat ones. These are sample statistics: the sample holds every rounded mover and a random ${flatSampleSize} of the rounded-flat PRs.`,
    `Cohen's kappa, index class against each judge's sign: Opus ${fixed(kappaWith("opus"))}, Astra ${fixed(kappaWith("astra"))}.`,
    "Confusion matrix (judge class from the mean score: ≥ 0.5 better, ≤ −0.5 worse):",
    table(["index class", "judged", "judges: better", "judges: neutral", "judges: worse"], confusion),
    `Blindness, population-weighted (each sampled rounded-flat PR stands for ${fixed(flat.find(({ sampleStratum }) => sampleStratum === "flat")?.weight ?? 1)} PRs): of the PRs the judges see as a quality change (mean ≥ 0.5 or ≤ −0.5), ${blindness(nonNeutral)}. With the strict rule that both judges give the same non-zero sign, ${blindness(bothAgree)}.`,
  ].join("\n\n");
}

function perMeasure(rows: Row[]): string {
  const scored = rows.filter((row) => row.mean !== null);
  const totalContribution = measureNames.reduce((sum, name) => sum + rows.reduce((inner, row) => inner + Math.abs(contribution(row, name)), 0), 0);
  const line = (label: string, valueOf: (row: Row) => number): [string, number, string, string] => {
    const movedRows = rows.filter((row) => valueOf(row) !== 0);
    const decided = scored.filter((row) => valueOf(row) !== 0 && judgeClass(row.mean!) !== "neutral");
    const agreeing = decided.filter((row) => sign(valueOf(row)) === (judgeClass(row.mean!) === "better" ? "+" : "-")).length;
    return [label, movedRows.length, fixed(spearman(scored.map(valueOf), scored.map(({ mean }) => mean!))), share(agreeing, decided.length)];
  };
  const dimensionRows = dimensions.map((dimension) => line(`**${dimension}**`, (row) => row.delta[dimension]));
  const measureRows = measureNames.map((name) => {
    const [label, moved, rho, agreement] = line(name, (row) => row.measures[name]!.scoreDelta);
    const weight = rows.reduce((sum, row) => sum + Math.abs(contribution(row, name)), 0);
    return [label, moved, `${Math.round((100 * weight) / totalContribution)}%`, rho, agreement];
  });
  return [
    "## Per dimension and per measure",
    "Moved: PRs (of all) where the score moved. Share of movement: this measure's share of the summed |composite contribution| over all PRs. Spearman against the mean judge score over judged PRs. Sign agreement: where the measure moved and the judges lean one way.",
    table(["dimension", "moved", "Spearman vs judges", "sign agreement"], dimensionRows),
    table(["measure", "moved", "share of movement", "Spearman vs judges", "sign agreement"], measureRows),
  ].join("\n\n");
}

function variants(rows: Row[]): string {
  const scored = rows.filter((row) => row.mean !== null);
  const lines = Object.keys(variantRules).map((name) => {
    const delta = (row: Row) => row.variants[name]!;
    const moving = rows.filter((row) => Math.abs(delta(row)) >= prThreshold);
    const decided = scored.filter((row) => Math.abs(delta(row)) >= prThreshold && judgeClass(row.mean!) !== "neutral");
    const agreeing = decided.filter((row) => sign(delta(row)) === (judgeClass(row.mean!) === "better" ? "+" : "-")).length;
    return [name, moving.length, fixed(spearman(scored.map(delta), scored.map(({ mean }) => mean!))), share(agreeing, decided.length)];
  });
  return [
    "## Rescoring variants and ablations",
    "The composite recomputed unrounded from the stored measures under each rule. Movers: PRs with |Δ| ≥ the PR threshold.",
    table(["variant", "movers", "Spearman vs judges", "sign agreement on movers"], lines),
  ].join("\n\n");
}

function diffLocalSection(rows: Row[]): string {
  const scored = rows.filter((row) => row.mean !== null);
  const decided = (valueOf: (row: Row) => number) => scored.filter((row) => valueOf(row) !== 0 && judgeClass(row.mean!) !== "neutral");
  const agreement = (valueOf: (row: Row) => number) => {
    const members = decided(valueOf);
    return share(members.filter((row) => sign(valueOf(row)) === (judgeClass(row.mean!) === "better" ? "+" : "-")).length, members.length);
  };
  const line = (label: string, valueOf: (row: Row) => number, moves: (row: Row) => boolean) => [label, share(rows.filter(moves).length, rows.length), share(scored.filter(moves).length, scored.length), fixed(spearman(scored.map(valueOf), scored.map(({ mean }) => mean!))), agreement((row) => (moves(row) ? valueOf(row) : 0))];
  return [
    "## Diff-local variant against the judges",
    "The diff-local score counts findings in the files the PR changed, before minus after: functions over CCN 10 (×1) and 20 (×2), ruff and oxlint findings, type escapes, TODO-style markers, facade bypasses touching a changed file (×3), and changed files on an import cycle. Positive means fewer findings.",
    table(["signal", "PRs it moves", "judged PRs it moves", "Spearman vs judges", "sign agreement where it moves"], [
      line("scope-level composite (unrounded |Δ| ≥ 0.2)", (row) => row.exact, (row) => row.indexClass !== "flat"),
      line("diff-local score (≠ 0)", (row) => row.local.score, (row) => row.local.score !== 0),
      line("diff-local density per KLOC of changed files (|Δ| ≥ 1)", (row) => row.local.density, (row) => Math.abs(row.local.density) >= 1),
    ]),
  ].join("\n\n");
}

function checks(rows: Row[]): string {
  const bigFeatures = rows.filter((row) => row.type === "feat" && row.lines.scopeMeasured.added >= 300);
  const testOnly = rows.filter((row) => row.lines.scopeMeasured.files === 0 && row.lines.scopeTests.files > 0);
  const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);
  const describe = (label: string, members: Row[]) => {
    const scored = members.filter((row) => row.mean !== null);
    return [
      label,
      members.length,
      fixed(mean(members.map(({ delta }) => delta.composite))),
      fixed(mean(members.map(({ delta }) => delta.complexity))),
      fixed(mean(members.map(({ delta }) => delta.tests))),
      `${members.filter((row) => row.indexClass === "worsened").length} / ${members.filter((row) => row.indexClass === "improved").length}`,
      scored.length === 0 ? "n/a" : `${fixed(mean(scored.map(({ mean: judge }) => judge!)))} (n=${scored.length})`,
    ];
  };
  const facadeMoves = rows.filter((row) => row.measures["tests.facadeCoverage"]!.scoreDelta !== 0);
  const facadeRows = facadeMoves.map((row) => [prLink(row), `${row.measures["tests.facadeCoverage"]!.before ?? "null"} → ${row.measures["tests.facadeCoverage"]!.after ?? "null"}`, `${signed(row.tests.facadeFunctions, 0)} / ${signed(row.tests.facadeCovered, 0)}`, signed(contribution(row, "tests.facadeCoverage"), 2), signed(row.delta.composite), row.variants["facade coverage gated below 5 functions"]!.toFixed(2)]);
  const shareMoves = rows.filter((row) => row.measures["architecture.facadeShare"]!.scoreDelta !== 0);
  return [
    "## Targeted checks",
    table(["group", "PRs", "mean Δ composite", "mean Δ complexity", "mean Δ tests", "worsened / improved", "mean judge"], [describe("feat with ≥ 300 added production lines in scope", bigFeatures), describe("test-only in scope", testOnly), describe("all", rows)]),
    `Facade coverage moved on ${facadeMoves.length} PRs:`,
    table(["PR", "coverage share", "Δ functions / covered", "composite contribution", "Δ composite", "Δ composite if gated"], facadeRows),
    `Facade share moved on ${shareMoves.length} PRs, ${shareMoves.filter(({ outsideDriven }) => outsideDriven).length} of them through inbound crossings; a single crossing is worth about ${fixed(contribution(shareMoves[0] ?? rows[0]!, "architecture.facadeShare"))} composite points in the first of them.`,
  ].join("\n\n");
}

function movers(rows: Row[], direction: "improvers" | "worseners", limit = 10): string {
  const ordered = [...rows].sort((a, b) => (direction === "improvers" ? b.exact - a.exact : a.exact - b.exact)).slice(0, limit);
  return [
    `## Top ${limit} ${direction}`,
    table(
      ["PR", "title", "Δ (unrounded)", "moved most", "drivers", "Opus", "Astra"],
      ordered.map((row) => [prLink(row), row.title, signed(row.exact, 2), topMeasures(row), driversOf(row), verdictCell(row.opus), verdictCell(row.astra)]),
    ),
  ].join("\n\n");
}

function disagreements(rows: Row[]): string {
  const scored = rows.filter((row) => row.mean !== null);
  const opposite = scored.filter((row) => (row.indexClass === "improved" && row.mean! <= -0.5) || (row.indexClass === "worsened" && row.mean! >= 0.5));
  const blind = scored.filter((row) => row.indexClass === "flat" && Math.abs(row.mean!) >= 1);
  const lines = [...opposite, ...blind]
    .sort((a, b) => Math.abs(b.mean!) * (Math.abs(b.exact) + 0.1) - Math.abs(a.mean!) * (Math.abs(a.exact) + 0.1))
    .map((row) => [prLink(row), row.title, `${row.indexClass} ${signed(row.exact, 2)}`, row.mean!.toFixed(1), topMeasures(row) || "—", verdictCell(row.opus), verdictCell(row.astra)]);
  return [
    "## Biggest disagreements",
    `${opposite.length} PRs where the index and the judges point opposite ways, and ${blind.length} flat PRs the judges score at |mean| ≥ 1.`,
    table(["PR", "title", "index", "judge mean", "moved most", "Opus", "Astra"], lines),
  ].join("\n\n");
}

function verdictCell(verdict: Verdict | null): string {
  return verdict === null ? "—" : `${signed(verdict.score, 0)}: ${verdict.reason}`;
}

function csvOf(rows: Row[]): string {
  const header = ["pr", "commit", "date", "type", "title", "class", "rounded_class", "sample_weight", "judged", "delta_composite", "delta_composite_unrounded", ...dimensions.map((dimension) => `delta_${dimension}`), ...measureNames.map((name) => `score_delta_${name}`), "scope_added", "scope_deleted", "scope_test_added", "scope_test_deleted", "outside_added", "outside_deleted", "outside_driven", "drivers", "opus_score", "astra_score", "judge_mean", "opus_reason", "astra_reason"];
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = rows.map((row) =>
    [
      row.pr, row.commit.slice(0, 12), row.date.slice(0, 10), row.type, row.title, row.indexClass, row.sampleStratum, roundTo(row.weight, 3), row.judged, row.delta.composite, roundTo(row.exact, 3),
      ...dimensions.map((dimension) => row.delta[dimension]),
      ...measureNames.map((name) => row.measures[name]!.scoreDelta),
      row.lines.scope.added, row.lines.scope.deleted, row.lines.scopeTests.added, row.lines.scopeTests.deleted, row.lines.outside.added, row.lines.outside.deleted,
      row.outsideDriven, driversOf(row), row.opus?.score, row.astra?.score, row.mean, row.opus?.reason, row.astra?.reason,
    ].map(cell).join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      reports: { type: "string", default: "/tmp/coherence-validation-reports" },
      csv: { type: "string", default: join(import.meta.dir, "..", "..", "docs", "coherence", "validation", "prs.csv") },
      tables: { type: "string", default: join(import.meta.dir, "..", "..", "docs", "coherence", "validation", "tables.md") },
    },
  });
  const { commits } = await readAttribution();
  const local = new Map(DiffLocalRunSchema.parse(await Bun.file(join(import.meta.dir, "data", "diff-local.json")).json()).map(({ commit, score, before, after }) => [commit, { score, density: diffLocalDensity(before, after) }]));
  const rows = await rowsOf(commits, await readVerdicts(), resolve(values.reports!), local);
  const tables = [overview(rows), interJudge(rows), indexVersusJudges(rows), perMeasure(rows), variants(rows), diffLocalSection(rows), checks(rows), movers(rows, "improvers"), movers(rows, "worseners"), disagreements(rows)].join("\n\n");
  await writeFile(resolve(values.csv!), csvOf(rows));
  await writeFile(resolve(values.tables!), `# Blind-judge validation: generated tables\n\n${tables}\n`);
  console.log(tables);
}
