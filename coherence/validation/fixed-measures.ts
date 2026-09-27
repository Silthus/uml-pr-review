#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import type { DimensionWeights } from "../contract.ts";
import { compositeScore, dimensionWeights, scoringVersion } from "../score.ts";
import type { Attribution } from "./attribute.ts";
import { readVerdicts, type Verdicts } from "./judges.ts";
import { readIndex } from "./rescore.ts";
import { classOf, readAttribution, type IndexClass } from "./selection.ts";
import { spearman } from "./statistics.ts";

const RescoredSchema = z.object({
  scoringVersion: z.number().int(),
  commits: z.record(
    z.string(),
    z.object({
      scores: z.object({ architecture: z.number().nullable(), complexity: z.number().nullable(), smells: z.number().nullable(), tests: z.number().nullable() }),
      facade: z.object({ functions: z.number().int(), covered: z.number().int(), bypasses: z.number().int(), crossings: z.number().int(), productionLines: z.number().int() }),
    }),
  ),
});
type Rescored = z.infer<typeof RescoredSchema>;
type Scored = Rescored["commits"][string];
type Scoring = { name: string; delta: (attribution: Attribution) => number };

const repository = "https://github.com/PostHog/posthog";
const dataDirectory = join(import.meta.dir, "data");
const rescoredFile = join(dataDirectory, "rescored.json");
const studyCsv = join(import.meta.dir, "..", "..", "docs", "coherence", "validation", "prs.csv");
const namedPullRequests = [101488, 103523, 103711, 64001, 97753, 66346, 76015, 78272];

async function rescoredFrom(reports: string, attributions: Attribution[]): Promise<Rescored> {
  const commits = [...new Set(attributions.flatMap(({ parent, commit }) => [parent, commit]))].sort();
  const entries = await Promise.all(
    commits.map(async (commit): Promise<[string, Scored]> => {
      const { dimensions, files } = await readIndex(reports, commit);
      const { facade } = dimensions.architecture;
      return [
        commit,
        {
          scores: { architecture: dimensions.architecture.score, complexity: dimensions.complexity.score, smells: dimensions.smells.score, tests: dimensions.tests.score },
          facade: { functions: dimensions.tests.facadeCoverage.functions, covered: dimensions.tests.facadeCoverage.covered, bypasses: facade.bypasses.length, crossings: facade.crossings, productionLines: files.productionLines },
        },
      ];
    }),
  );
  return { scoringVersion, commits: Object.fromEntries(entries) };
}

async function readRescored(): Promise<Rescored> {
  const rescored = RescoredSchema.parse(JSON.parse(await readFile(rescoredFile, "utf8")));
  if (rescored.scoringVersion !== scoringVersion) throw new Error(`${rescoredFile} holds scoring version ${rescored.scoringVersion}, not ${scoringVersion}. Pass --reports to refresh it.`);
  return rescored;
}

async function studyDeltas(): Promise<Map<string, number>> {
  const [header, ...lines] = (await readFile(studyCsv, "utf8")).trim().split("\n").map(csvCells);
  const [commit, delta] = [header!.indexOf("commit"), header!.indexOf("delta_composite_unrounded")];
  return new Map(lines.map((cells) => [cells[commit]!, Number(cells[delta])]));
}

function csvCells(line: string): string[] {
  return [...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)].map(([, cell]) => cell!.replace(/^"|"$/g, "").replaceAll('""', '"'));
}

function scorings(rescored: Rescored, study: Map<string, number>): Scoring[] {
  const composite = (commit: string, weights: DimensionWeights) => compositeScore(rescored.commits[commit]!.scores, weights);
  const under = (weights: DimensionWeights) => ({ commit, parent }: Attribution) => composite(commit, weights) - composite(parent, weights);
  return [
    { name: "scoring v1 (#95)", delta: ({ commit }) => study.get(commit.slice(0, 12))! },
    { name: `scoring v${scoringVersion}, tests weight ${dimensionWeights.tests}`, delta: under(dimensionWeights) },
    { name: `scoring v${scoringVersion}, tests weight 0`, delta: under({ ...dimensionWeights, tests: 0 }) },
    { name: `scoring v${scoringVersion}, tests weight 20`, delta: under({ ...dimensionWeights, tests: 20 }) },
  ];
}

function judgeMean(verdicts: Verdicts, pr: number | null): number | null {
  const [opus, astra] = pr === null ? [] : [verdicts.opus.get(pr), verdicts.astra.get(pr)];
  return opus && astra ? (opus.score + astra.score) / 2 : null;
}

function summaryRow(scoring: Scoring, attributions: Attribution[], verdicts: Verdicts): (string | number)[] {
  const rows = attributions.map((attribution) => ({ delta: scoring.delta(attribution), mean: judgeMean(verdicts, attribution.pr) }));
  const judged = rows.filter((row): row is { delta: number; mean: number } => row.mean !== null);
  const leaning = judged.filter(({ delta, mean }) => classOf(delta) !== "flat" && mean !== 0);
  const agreeing = leaning.filter(({ delta, mean }) => Math.sign(delta) === Math.sign(mean));
  const countOf = (indexClass: IndexClass) => rows.filter(({ delta }) => classOf(delta) === indexClass).length;
  const rho = spearman(judged.map(({ delta }) => delta), judged.map(({ mean }) => mean));
  return [scoring.name, countOf("improved") + countOf("worsened"), `${countOf("improved")} / ${countOf("worsened")}`, rho === null ? "n/a" : rho.toFixed(3), `${agreeing.length}/${leaning.length}`];
}

function namedRows(attributions: Attribution[], [before, after]: Scoring[], rescored: Rescored, verdicts: Verdicts): (string | number)[][] {
  return namedPullRequests.flatMap((pr) => {
    const attribution = attributions.find((candidate) => candidate.pr === pr);
    if (!attribution) return [];
    const judges = `${verdicts.opus.get(pr)?.score ?? "—"}, ${verdicts.astra.get(pr)?.score ?? "—"}`;
    return [[prLink(attribution), attribution.title.replaceAll("|", "\\|"), signed(before!.delta(attribution)), signed(after!.delta(attribution)), judges, facadeFacts(rescored.commits[attribution.parent]!, rescored.commits[attribution.commit]!)]];
  });
}

function facadeFacts(before: Scored, after: Scored): string {
  const coverage = ({ facade }: Scored) => `${facade.covered}/${facade.functions}`;
  const perKloc = ({ facade }: Scored) => ((1000 * facade.bypasses) / facade.productionLines).toFixed(2);
  return `coverage ${coverage(before)} → ${coverage(after)} (unscored); bypasses ${before.facade.bypasses} → ${after.facade.bypasses}, ${perKloc(before)} → ${perKloc(after)} per KLOC`;
}

function moverRows(attributions: Attribution[], after: Scoring, verdicts: Verdicts): (string | number)[][] {
  return attributions
    .map((attribution) => ({ attribution, delta: after.delta(attribution) }))
    .filter(({ delta }) => classOf(delta) !== "flat")
    .sort((a, b) => a.delta - b.delta)
    .map(({ attribution, delta }) => {
      const judges = attribution.pr === null ? "not judged" : `${verdicts.opus.get(attribution.pr)?.score ?? "—"}, ${verdicts.astra.get(attribution.pr)?.score ?? "—"}`;
      const { cycles, bypasses } = attribution;
      return [prLink(attribution), signed(delta), judges, `bypasses +${bypasses.added.length}/−${bypasses.removed.length}; cycle files +${cycles.entered.length}/−${cycles.left.length}`];
    });
}

function testOnlyLine(attributions: Attribution[], [before, after]: Scoring[]): string {
  const testOnly = attributions.filter(({ lines }) => lines.scopeMeasured.files === 0 && lines.scopeTests.files > 0);
  const largest = (scoring: Scoring) => Math.max(...testOnly.map((attribution) => Math.abs(scoring.delta(attribution)))).toFixed(3);
  return `${testOnly.length} test-only PRs: the largest composite move is ${largest(before!)} under scoring v1 and ${largest(after!)} under v${scoringVersion}.`;
}

function prLink({ pr, commit }: Attribution): string {
  return pr === null ? commit.slice(0, 12) : `[#${pr}](${repository}/pull/${pr})`;
}

function signed(value: number): string {
  const shown = Number(value.toFixed(2));
  return `${shown > 0 ? "+" : shown < 0 ? "−" : ""}${Math.abs(shown).toFixed(2)}`;
}

function table(header: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function render(attributions: Attribution[], rescored: Rescored, study: Map<string, number>, verdicts: Verdicts): string {
  const all = scorings(rescored, study);
  return [
    `# The Coherence Index under scoring v${scoringVersion}, on #95's workflows PRs`,
    "",
    "Scoring v1 is #95's, read from the committed `prs.csv`. The current scoring is read from `coherence/validation/data/rescored.json`, the #95 index reports rescored from their stored facts. Deltas are unrounded composite points.",
    "",
    "Regenerate: `bun coherence/validation/attribute.ts --repo ~/dev/posthog --ref 57ca357730843205c2d659098ac8e4c5e07a6698` rebuilds the reports in `/tmp/coherence-validation-reports`; `bun coherence/validation/fixed-measures.ts --reports /tmp/coherence-validation-reports` refreshes `rescored.json` and this file. Without `--reports`, it renders from the committed data alone.",
    "",
    "## The PRs #95 called perverse or telling",
    "",
    table(["PR", "Title", "v1", `v${scoringVersion}`, "Judges (Opus, Astra)", "Facade facts"], namedRows(attributions, all, rescored, verdicts)),
    "",
    "## All 321 PRs against the blind judges",
    "",
    table(["Scoring", "Movers (Δ beyond ±0.2)", "Improved / worsened", "Spearman vs judges (64 judged)", "Sign agreement on leaning movers"], all.map((scoring) => summaryRow(scoring, attributions, verdicts))),
    "",
    `The #95 judge data cannot tell tests weights of 0, 10, and 20 apart: with 64 judged PRs the standard error of a Spearman coefficient is about 0.13. The weight ${dimensionWeights.tests} is a judgement call. ${testOnlyLine(attributions, all)}`,
    "",
    `## Movers under scoring v${scoringVersion}`,
    "",
    table(["PR", "Δ", "Judges (Opus, Astra)", "Bypasses and cycles"], moverRows(attributions, all[1]!, verdicts)),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { reports: { type: "string" }, out: { type: "string", default: join(import.meta.dir, "..", "..", "docs", "coherence", "validation", "fixed-measures.md") } } });
  const [{ commits }, verdicts, study] = await Promise.all([readAttribution(), readVerdicts(), studyDeltas()]);
  if (values.reports) await writeFile(rescoredFile, JSON.stringify(await rescoredFrom(values.reports, commits), null, 1));
  await writeFile(values.out, render(commits, await readRescored(), study, verdicts));
  console.log(`Wrote ${values.out}`);
}
