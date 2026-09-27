#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { CoherenceIndex, DimensionWeights } from "../contract.ts";
import { rescore } from "../rescore.ts";
import { compositeScore, dimensionScore, dimensionWeights } from "../score.ts";
import type { Attribution } from "./attribute.ts";
import { readVerdicts, type Verdicts } from "./judges.ts";
import { asScored, compositeUnder, readIndex } from "./rescore.ts";
import { classOf, readAttribution, type IndexClass } from "./selection.ts";
import { spearman } from "./statistics.ts";

type Scoring = { name: string; composite: (index: CoherenceIndex) => number };
type Pair = { attribution: Attribution; before: CoherenceIndex; after: CoherenceIndex };
type Summary = { scoring: string; movers: number; improved: number; worsened: number; rho: number | null; agreement: string };

const repository = "https://github.com/PostHog/posthog";
const namedPullRequests = [101488, 103523, 103711, 64001, 97753, 66346, 76015, 78272];

const scorings: Scoring[] = [
  { name: "before (#95)", composite: (index) => compositeUnder(index, asScored) },
  { name: "after (this change)", composite: (index) => rescore(index).composite.score },
  { name: "after, test ratio at the old weight 20", composite: (index) => weighted(rescore(index), { ...dimensionWeights, tests: 20 }) },
  { name: "after, test ratio dropped from the tests dimension", composite: (index) => withoutTestRatio(rescore(index)) },
];

function weighted({ dimensions }: CoherenceIndex, weights: DimensionWeights, tests = dimensions.tests.score): number {
  return compositeScore({ architecture: dimensions.architecture.score, complexity: dimensions.complexity.score, smells: dimensions.smells.score, tests }, weights);
}

function withoutTestRatio(index: CoherenceIndex): number {
  const { testRatio: _, ...rest } = index.dimensions.tests.measures;
  return weighted(index, dimensionWeights, dimensionScore(rest));
}

function judgeMean(verdicts: Verdicts, pr: number | null): number | null {
  if (pr === null) return null;
  const opus = verdicts.opus.get(pr);
  const astra = verdicts.astra.get(pr);
  return opus && astra ? (opus.score + astra.score) / 2 : null;
}

function summarise(scoring: Scoring, pairs: Pair[], verdicts: Verdicts): Summary {
  const rows = pairs.map(({ attribution, before, after }) => ({ attribution, delta: scoring.composite(after) - scoring.composite(before), mean: judgeMean(verdicts, attribution.pr) }));
  const judged = rows.filter((row): row is typeof row & { mean: number } => row.mean !== null);
  const leaning = judged.filter(({ delta, mean }) => classOf(delta) !== "flat" && mean !== 0);
  const agreeing = leaning.filter(({ delta, mean }) => Math.sign(delta) === Math.sign(mean));
  const countOf = (indexClass: IndexClass) => rows.filter(({ delta }) => classOf(delta) === indexClass).length;
  return {
    scoring: scoring.name,
    movers: countOf("improved") + countOf("worsened"),
    improved: countOf("improved"),
    worsened: countOf("worsened"),
    rho: spearman(judged.map(({ delta }) => delta), judged.map(({ mean }) => mean)),
    agreement: `${agreeing.length}/${leaning.length}`,
  };
}

function signed(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
}

function table(header: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function namedRows(pairs: Pair[], verdicts: Verdicts): (string | number)[][] {
  return namedPullRequests.flatMap((pr) => {
    const pair = pairs.find(({ attribution }) => attribution.pr === pr);
    if (!pair) return [];
    const [before, after] = scorings.slice(0, 2).map((scoring) => scoring.composite(pair.after) - scoring.composite(pair.before));
    const { opus, astra } = { opus: verdicts.opus.get(pr)?.score ?? "—", astra: verdicts.astra.get(pr)?.score ?? "—" };
    return [[`[#${pr}](${repository}/pull/${pr})`, pair.attribution.title.replaceAll("|", "\\|"), signed(before!), signed(after!), `${opus}, ${astra}`, facadeFacts(pair)]];
  });
}

function facadeFacts({ before, after }: Pair): string {
  const coverage = (index: CoherenceIndex) => `${index.dimensions.tests.facadeCoverage.covered}/${index.dimensions.tests.facadeCoverage.functions}`;
  const bypasses = (index: CoherenceIndex) => index.dimensions.architecture.facade.bypasses.length;
  const crossings = (index: CoherenceIndex) => index.dimensions.architecture.facade.crossings;
  return `coverage ${coverage(before)} → ${coverage(after)}; bypasses ${bypasses(before)} → ${bypasses(after)} of ${crossings(before)} → ${crossings(after)} crossings`;
}

function moverRows(pairs: Pair[], verdicts: Verdicts): (string | number)[][] {
  const after = scorings[1]!;
  return pairs
    .map((pair) => ({ pair, delta: after.composite(pair.after) - after.composite(pair.before) }))
    .filter(({ delta }) => classOf(delta) !== "flat")
    .sort((a, b) => a.delta - b.delta)
    .map(({ pair, delta }) => {
      const pr = pair.attribution.pr;
      const link = pr === null ? pair.attribution.commit.slice(0, 12) : `[#${pr}](${repository}/pull/${pr})`;
      const judges = pr === null ? "not judged" : `${verdicts.opus.get(pr)?.score ?? "—"}, ${verdicts.astra.get(pr)?.score ?? "—"}`;
      const { cycles, bypasses } = pair.attribution;
      return [link, signed(delta), judges, `bypasses +${bypasses.added.length}/−${bypasses.removed.length}; cycle files +${cycles.entered.length}/−${cycles.left.length}`];
    });
}

function testOnlyMovement(pairs: Pair[]): string {
  const testOnly = pairs.filter(({ attribution }) => attribution.lines.scopeMeasured.files === 0 && attribution.lines.scopeTests.files > 0);
  const largest = (scoring: Scoring) => Math.max(...testOnly.map(({ before, after }) => Math.abs(scoring.composite(after) - scoring.composite(before))));
  return `${testOnly.length} test-only PRs; the largest composite move is ${largest(scorings[0]!).toFixed(3)} before and ${largest(scorings[1]!).toFixed(3)} after.`;
}

function render(pairs: Pair[], verdicts: Verdicts): string {
  const summaries = scorings.map((scoring) => summarise(scoring, pairs, verdicts));
  return [
    "# The fixed facade measures on #95's workflows PRs",
    "",
    "Generated by `bun coherence/validation/fixed-measures.ts` from the #95 attribution, its judges, and the stored index reports of each PR's parent and commit. Deltas are unrounded composite points.",
    "",
    "## The PRs #95 called perverse or telling",
    "",
    table(["PR", "Title", "Before", "After", "Judges (Opus, Astra)", "Facade facts"], namedRows(pairs, verdicts)),
    "",
    "## All 321 PRs against the blind judges",
    "",
    table(
      ["Scoring", "Movers (Δ beyond ±0.2)", "Improved / worsened", "Spearman vs judges (64 judged)", "Sign agreement on leaning movers"],
      summaries.map(({ scoring, movers, improved, worsened, rho, agreement }) => [scoring, movers, `${improved} / ${worsened}`, rho === null ? "n/a" : rho.toFixed(3), agreement]),
    ),
    "",
    "The movers under the new scoring, and what moved them:",
    "",
    table(["PR", "Δ", "Judges (Opus, Astra)", "Bypasses and cycles"], moverRows(pairs, verdicts)),
    "",
    "Each bypass now costs the same fixed amount, so PRs that add bypasses read as worse. The judges, reading the diff, mostly score those features 0 or +1; #95 found the same leniency toward new coupling (#66346, #78272).",
    "",
    "With 64 judged PRs the standard error of a Spearman coefficient is about 0.13, so the three \"after\" rows agree with the judges equally well. The test-ratio weight is chosen on mechanism instead: test-only PRs barely move the ratio, as the next line shows.",
    "",
    testOnlyMovement(pairs),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { reports: { type: "string", default: "/tmp/coherence-validation-reports" }, out: { type: "string", default: join(import.meta.dir, "..", "..", "docs", "coherence", "validation", "fixed-measures.md") } } });
  const [run, verdicts] = await Promise.all([readAttribution(), readVerdicts()]);
  const pairs = await Promise.all(run.commits.map(async (attribution) => ({ attribution, before: await readIndex(values.reports, attribution.parent), after: await readIndex(values.reports, attribution.commit) })));
  await writeFile(values.out, render(pairs, verdicts));
  console.log(`Wrote ${values.out}`);
}
