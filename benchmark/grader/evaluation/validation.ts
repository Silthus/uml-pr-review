import { subtypes } from "../../corrections/labels.ts";
import type { DetectorName } from "../violations.ts";
import { judgedFlagsPerPullRequest, type FalseAlarmLabel, type Flag } from "./false-alarms.ts";
import { bySubtype, matchedLineThreshold, outcomeOf, percent, productionFileFlags, quantile, rate, type Rate, type ScoredCase } from "./metrics.ts";
import { movedAsAsked, movedTheOtherWay, scopeMoveThreshold, type ScopeResult } from "./scope-index.ts";
import type { StoredGrade } from "./store.ts";

export type EvaluatedSplit = { cases: ScoredCase[]; outsideProduction: number; clean: StoredGrade[]; cleanSampled: number };

type ValidationInput = {
  detectors: readonly DetectorName[];
  configSha256: string;
  graderSha256: string;
  heldOutSha256: string;
  development: EvaluatedSplit;
  heldOut: EvaluatedSplit;
  flags: Flag[];
  labels: Map<string, FalseAlarmLabel>;
  scope: ScopeResult[];
};

type Outcomes = { flagged(scored: ScoredCase): boolean; near(scored: ScoredCase): boolean; confirmed(scored: ScoredCase): boolean; fixed(scored: ScoredCase): boolean; addedLines(scored: ScoredCase): number };

const allSubtypes = [...subtypes, "all" as const];

export function developmentTables(split: EvaluatedSplit, detectors: readonly DetectorName[]): string[] {
  const verified = verifiedOnly(split);
  return [
    `${verified.cases.length} verified development fixes on production files (${split.outsideProduction} comments on other files left out), against ${split.clean.length} clean development pull requests.`,
    "",
    ...detectorTable(verified, detectors),
    "",
    "Catches per sub-type, which the keep-or-drop rule reads:",
    "",
    ...subtypeTable(verified.cases, detectors),
  ];
}

export function validationReport(input: ValidationInput): string {
  const verified = verifiedOnly(input.heldOut);
  const outcomes = outcomesOf(input.heldOut.cases, input.detectors);
  const fileFlags = productionFileFlags(input.heldOut.clean, input.detectors);
  const matched = matchedLineThreshold(fileFlags.addedLines, share(rate(fileFlags.flagged)));
  return [
    "## Held-out validation",
    "",
    `The frozen config hashes to \`${input.configSha256}\` and the grader sources with it to \`${input.graderSha256}\` (\`frozen.json\`). The held-out rows hash to \`${input.heldOutSha256}\`, which matches \`heldout.sha256\`. The grader ran once on the held-out set.`,
    "",
    `**Catch** means the grader, run on the pull request as the reviewer saw it (merge base to the commented commit), reports a violation it introduced in the commented file. **Near** means within 20 lines of the comment. **Confirmed** means the fix commit also removes a violation of the same detector in that file. Only comments on production files count, on both sides of every comparison, because the grader cannot flag anything else (${input.heldOut.outsideProduction} held-out comments on other files are left out). **Verified** rows are the fixes that a fresh Opus verifier judged to address the comment fully or partly (${verified.cases.length} of ${input.heldOut.cases.length}).`,
    "",
    ...catchSection(input.heldOut, verified, outcomes, matched),
    ...detectorSection(verified, input.detectors),
    ...baselineSection(input, verified, outcomes, matched),
    ...falseAlarmSection(input),
    ...scopeSection(input, outcomes),
    ...speedSection(input.heldOut),
  ].join("\n");
}

function catchSection(heldOut: EvaluatedSplit, verified: EvaluatedSplit, outcomes: Outcomes, matched: number): string[] {
  const verifiedBySubtype = bySubtype(verified.cases, (scored) => scored);
  const allBySubtype = bySubtype(heldOut.cases, (scored) => scored);
  return [
    "### Catch rate per sub-type",
    "",
    `| Sub-type | Verified | Catch | Near | Confirmed | Size baseline, adds > ${matched} | All isolable, verified or not | Catch |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...allSubtypes.map((subtype) => {
      const [inVerified, inAll] = [verifiedBySubtype[subtype], allBySubtype[subtype]];
      return `| ${subtype} | ${inVerified.length} | ${fraction(rate(inVerified.map(outcomes.flagged)))} | ${fraction(rate(inVerified.map(outcomes.near)))} | ${fraction(rate(inVerified.map(outcomes.confirmed)))} | ${fraction(rate(inVerified.map((scored) => outcomes.addedLines(scored) > matched)))} | ${inAll.length} | ${fraction(rate(inAll.map(outcomes.flagged)))} |`;
    }),
    "",
  ];
}

function detectorSection(verified: EvaluatedSplit, detectors: readonly DetectorName[]): string[] {
  return ["### Per detector, verified held-out fixes", "", ...detectorTable(verified, detectors), "", ...subtypeTable(verified.cases, detectors), ""];
}

function baselineSection(input: ValidationInput, verified: EvaluatedSplit, outcomes: Outcomes, matched: number): string[] {
  const { heldOut, development, detectors } = input;
  const fileFlags = productionFileFlags(heldOut.clean, detectors);
  const cleanRate = rate(fileFlags.flagged);
  const developmentFlags = productionFileFlags(development.clean, detectors);
  const developmentThreshold = matchedLineThreshold(developmentFlags.addedLines, share(rate(developmentFlags.flagged)));
  const developmentCutRate = rate(fileFlags.addedLines.map((added) => added > developmentThreshold));
  const sized = (threshold: number) => fraction(rate(verified.cases.map((scored) => outcomes.addedLines(scored) > threshold)));
  return [
    "### Baseline: flag any file that adds more than N lines",
    "",
    `On the ${heldOut.clean.length} graded clean held-out pull requests, the grader flags ${percent(cleanRate)} of the ${cleanRate.total} changed production files (${pullRequestsFlagged(heldOut.clean, detectors)} pull requests have at least one flag). The size baseline flags the same share of files at N = ${matched} lines.`,
    "",
    `- Grader: catches ${fraction(rate(verified.cases.map(outcomes.flagged)))} of verified fixes.`,
    `- Size baseline, N = ${matched} (matched on the held-out clean files): ${sized(matched)}.`,
    `- Size baseline, N = ${developmentThreshold} (matched on the development clean files, fixed before validation; it flags ${percent(developmentCutRate)} of held-out clean files): ${sized(developmentThreshold)}.`,
    "",
  ];
}

function falseAlarmSection(input: ValidationInput): string[] {
  const { heldOut, flags, labels, detectors } = input;
  const verdicts = [...labels.values()].filter(({ id }) => flags.some((flag) => flag.id === id));
  const notProblem = verdicts.filter(({ verdict }) => verdict === "not-a-problem");
  const problem = verdicts.filter(({ verdict }) => verdict === "problem").length;
  return [
    "### False alarms",
    "",
    `A seeded sample of ${heldOut.cleanSampled} held-out pull requests without any correction; ${heldOut.cleanSampled - heldOut.clean.length} merge commits are missing from the local clone, so ${heldOut.clean.length} were graded. The grader flagged ${pullRequestsFlagged(heldOut.clean, detectors)} of them. Up to ${judgedFlagsPerPullRequest} flags per pull request (${flags.length} in all) went to fresh Opus judges, who saw the flag and the code but not the grade, the weights, or any catch numbers.`,
    "",
    `- Judged: ${verdicts.length}. A real problem: ${problem}. Not a problem: ${notProblem.length}. Unsure: ${verdicts.length - problem - notProblem.length}.`,
    `- **False-alarm rate: ${percent({ hits: notProblem.length, total: problem + notProblem.length })}** of decided flags (${percent({ hits: notProblem.length, total: verdicts.length })} counting unsure as not a false alarm).`,
    `- Pull requests with at least one flag judged not a problem: ${new Set(notProblem.map(({ id }) => id.split(":")[0])).size} of ${heldOut.clean.length}.`,
    ...falseAlarmsByDetector(flags, verdicts),
    "",
  ];
}

function scopeSection(input: ValidationInput, outcomes: Outcomes): string[] {
  const scoreable = input.scope.filter(({ before, after }) => before !== null && after !== null);
  const withDiffLocal = input.scope.filter(({ diffLocal }) => diffLocal !== null);
  const graderOn = (results: ScopeResult[]) => input.heldOut.cases.filter(({ id }) => results.some((result) => result.id === id));
  return [
    "### Old scope index and #95's diff-local prototype",
    "",
    `A seeded sample of ${input.scope.length} verified held-out fixes. Each signal is read on the fix commit against its parent, and asks whether the fix moves it the way the reviewer asked. Scope: the product folder of the commented file.`,
    "",
    "| Signal | Fixes it could score | Moved as asked | Moved the other way |",
    "| --- | --- | --- | --- |",
    `| Scope composite, unrounded, change of ${scopeMoveThreshold} or more (the #95 threshold) | ${scoreable.length} | ${fraction(rate(scoreable.map(movedAsAsked)))} | ${fraction(rate(scoreable.map(movedTheOtherWay)))} |`,
    `| #95 diff-local prototype, score not 0 | ${withDiffLocal.length} | ${fraction(rate(withDiffLocal.map(({ diffLocal }) => diffLocal! > 0)))} | ${fraction(rate(withDiffLocal.map(({ diffLocal }) => diffLocal! < 0)))} |`,
    `| Grader: the fix removes a violation in the commented file (production files only) | ${graderOn(scoreable).length} | ${fraction(rate(graderOn(scoreable).map(outcomes.fixed)))} | n/a |`,
    "",
  ];
}

function speedSection(heldOut: EvaluatedSplit): string[] {
  const seconds = [...heldOut.cases.flatMap(({ reviewed, fixed }) => [reviewed.seconds, fixed.seconds]), ...heldOut.clean.map(({ seconds }) => seconds)].sort((a, b) => a - b);
  return [
    "### Speed during the held-out run",
    "",
    `${seconds.length} gradings: median ${quantile(seconds, 0.5).toFixed(2)} s, p90 ${quantile(seconds, 0.9).toFixed(2)} s per commit range, with six shards and the scope-index run sharing one machine. For one process on consecutive commits, see \`evaluate.ts timing\` in the verdict.`,
  ];
}

function detectorTable(split: EvaluatedSplit, detectors: readonly DetectorName[]): string[] {
  const flags = productionFileFlags(split.clean, detectors);
  const rows = ["| Detector | Flags clean files | Catches corrections | Size baseline at the same flag rate |", "| --- | --- | --- | --- |"];
  for (const detector of detectors) {
    const cleanRate = rate(productionFileFlags(split.clean, [detector]).flagged);
    const threshold = matchedLineThreshold(flags.addedLines, share(cleanRate));
    const caught = rate(split.cases.map((scored) => outcomeOf(scored, [detector]).flagged.size > 0));
    const sized = rate(split.cases.map((scored) => outcomeOf(scored, detectors).addedLines > threshold));
    rows.push(`| ${detector} | ${percent(cleanRate)} | ${fraction(caught)} | ${fraction(sized)} (adds > ${threshold} lines) |`);
  }
  return rows;
}

function subtypeTable(cases: ScoredCase[], detectors: readonly DetectorName[]): string[] {
  return [
    `| Detector | ${allSubtypes.join(" | ")} |`,
    `| --- | ${allSubtypes.map(() => "---").join(" | ")} |`,
    ...detectors.map((detector) => {
      const caught = bySubtype(cases, (scored) => outcomeOf(scored, [detector]).flagged.size > 0);
      return `| ${detector} | ${allSubtypes.map((subtype) => `${rate(caught[subtype]).hits}/${caught[subtype].length}`).join(" | ")} |`;
    }),
  ];
}

function outcomesOf(cases: ScoredCase[], detectors: readonly DetectorName[]): Outcomes {
  const outcomes = new Map(cases.map((scored) => [scored.id, outcomeOf(scored, detectors)]));
  const of = (scored: ScoredCase) => outcomes.get(scored.id)!;
  return {
    flagged: (scored) => of(scored).flagged.size > 0,
    near: (scored) => of(scored).near.size > 0,
    confirmed: (scored) => [...of(scored).flagged].some((detector) => of(scored).fixed.has(detector)),
    fixed: (scored) => of(scored).fixed.size > 0,
    addedLines: (scored) => of(scored).addedLines,
  };
}

function verifiedOnly(split: EvaluatedSplit): EvaluatedSplit {
  return { ...split, cases: split.cases.filter(({ verified }) => verified === true) };
}

function pullRequestsFlagged(clean: StoredGrade[], detectors: readonly DetectorName[]): number {
  return clean.filter((grade) => detectors.some((detector) => (grade.detectors[detector]?.introduced.length ?? 0) > 0)).length;
}

function falseAlarmsByDetector(flags: Flag[], verdicts: FalseAlarmLabel[]): string[] {
  const verdictOf = new Map(verdicts.map((label) => [label.id, label.verdict]));
  return [...Map.groupBy(flags, ({ violation }) => violation.detector)].map(([detector, group]) => {
    const decided = group.filter(({ id }) => verdictOf.get(id) === "problem" || verdictOf.get(id) === "not-a-problem");
    return `- ${detector}: ${group.length} judged, ${percent(rate(decided.map(({ id }) => verdictOf.get(id) === "not-a-problem")))} not a problem.`;
  });
}

function share({ hits, total }: Rate): number {
  return total === 0 ? 0 : hits / total;
}

function fraction(value: Rate): string {
  return `${value.hits}/${value.total} (${percent(value)})`;
}
