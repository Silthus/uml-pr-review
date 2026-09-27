import { subtypes } from "../../corrections/labels.ts";
import type { DetectorName } from "../violations.ts";
import type { FalseAlarmLabel, Flag } from "./false-alarms.ts";
import { bySubtype, matchedLineThreshold, outcomeOf, percent, productionFileFlags, rate, type Rate, type ScoredCase } from "./metrics.ts";
import { movedAsAsked, scopeMoveThreshold, type ScopeResult } from "./scope-index.ts";
import type { StoredGrade } from "./store.ts";

export type EvaluatedSplit = { cases: ScoredCase[]; clean: StoredGrade[] };

export type ValidationInput = {
  detectors: readonly DetectorName[];
  configSha256: string;
  heldOutSha256: string;
  development: EvaluatedSplit;
  heldOut: EvaluatedSplit;
  flags: Flag[];
  labels: Map<string, FalseAlarmLabel>;
  scope: ScopeResult[];
};

export function detectorTable(split: EvaluatedSplit, detectors: readonly DetectorName[]): string[] {
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

export function validationReport(input: ValidationInput): string {
  const { detectors, heldOut } = input;
  const verified = heldOut.cases.filter(({ verified }) => verified === true);
  const outcomes = new Map(heldOut.cases.map((scored) => [scored.id, outcomeOf(scored, detectors)]));
  const fileFlags = productionFileFlags(heldOut.clean, detectors);
  const cleanRate = rate(fileFlags.flagged);
  const matched = matchedLineThreshold(fileFlags.addedLines, share(cleanRate));
  const devFlags = productionFileFlags(input.development.clean, detectors);
  const devThreshold = matchedLineThreshold(devFlags.addedLines, share(rate(devFlags.flagged)));
  const flagged = (scored: ScoredCase) => outcomes.get(scored.id)!.flagged.size > 0;
  const near = (scored: ScoredCase) => outcomes.get(scored.id)!.near.size > 0;
  const confirmed = (scored: ScoredCase) => [...outcomes.get(scored.id)!.flagged].some((detector) => outcomes.get(scored.id)!.fixed.has(detector));
  const sizeFlag = (threshold: number) => (scored: ScoredCase) => outcomes.get(scored.id)!.addedLines > threshold;
  const verdicts = [...input.labels.values()].filter(({ id }) => input.flags.some((flag) => flag.id === id));
  const notProblem = verdicts.filter(({ verdict }) => verdict === "not-a-problem").length;
  const problem = verdicts.filter(({ verdict }) => verdict === "problem").length;
  const pullRequestsFlagged = heldOut.clean.filter((grade) => detectors.some((detector) => (grade.detectors[detector]?.introduced.length ?? 0) > 0)).length;
  const seconds = [...heldOut.cases.flatMap(({ reviewed, fixed }) => [reviewed.seconds, fixed.seconds]), ...heldOut.clean.map(({ seconds }) => seconds)].sort((a, b) => a - b);
  const scoreable = input.scope.filter(({ before, after }) => before !== null && after !== null);

  return [
    "## Held-out validation",
    "",
    `The frozen config hashes to \`${input.configSha256}\`. The held-out rows hash to \`${input.heldOutSha256}\`, which matches \`heldout.sha256\`. The grader ran once on the held-out set.`,
    "",
    `**Catch** means the grader, run on the pull request as the reviewer saw it (merge base to the commented commit), reports a violation it introduced in the commented file. **Near** means within 20 lines of the comment. **Confirmed** means the fix commit also removes a violation of the same detector in that file. **Verified** rows are the held-out fixes that a fresh Opus verifier judged to address the comment fully or partly (${verified.length} of ${heldOut.cases.length}).`,
    "",
    "### Catch rate per sub-type",
    "",
    `| Sub-type | Verified | Catch | Near | Confirmed | Size baseline, adds > ${matched} | All isolable | Catch (unverified) |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...[...subtypes, "all" as const].map((subtype) => {
      const inVerified = bySubtype(verified, (scored) => scored)[subtype];
      const inAll = bySubtype(heldOut.cases, (scored) => scored)[subtype];
      return `| ${subtype} | ${inVerified.length} | ${fraction(rate(inVerified.map(flagged)))} | ${fraction(rate(inVerified.map(near)))} | ${fraction(rate(inVerified.map(confirmed)))} | ${fraction(rate(inVerified.map(sizeFlag(matched))))} | ${inAll.length} | ${fraction(rate(inAll.map(flagged)))} |`;
    }),
    "",
    "### Per detector, verified held-out fixes",
    "",
    ...detectorTable({ cases: verified, clean: heldOut.clean }, detectors),
    "",
    "### Baseline: flag any file that adds more than N lines",
    "",
    `On the ${heldOut.clean.length} clean held-out pull requests, the grader flags ${percent(cleanRate)} of the ${cleanRate.total} changed production files (${pullRequestsFlagged} of ${heldOut.clean.length} pull requests have at least one flag). The size baseline flags the same share of files at N = ${matched} lines.`,
    "",
    `- Grader: catches ${fraction(rate(verified.map(flagged)))} of verified fixes.`,
    `- Size baseline, N = ${matched} (matched on the held-out clean files): ${fraction(rate(verified.map(sizeFlag(matched))))}.`,
    `- Size baseline, N = ${devThreshold} (matched on the development clean files, fixed before validation): ${fraction(rate(verified.map(sizeFlag(devThreshold))))}.`,
    "",
    "### False alarms",
    "",
    `A seeded sample of ${heldOut.clean.length} held-out pull requests without any correction. The grader flagged ${pullRequestsFlagged} of them. Up to ${5} flags per pull request (${input.flags.length} in all) went to fresh Opus judges, who saw the flag and the code but not the grade, the weights, or any catch numbers.`,
    "",
    `- Judged: ${verdicts.length}. A real problem: ${problem}. Not a problem: ${notProblem}. Unsure: ${verdicts.length - problem - notProblem}.`,
    `- **False-alarm rate: ${percent({ hits: notProblem, total: problem + notProblem })}** of decided flags (${percent({ hits: notProblem, total: verdicts.length })} counting unsure as not a false alarm).`,
    ...falseAlarmsByDetector(input.flags, verdicts),
    "",
    "### Old scope index",
    "",
    `The product-scope Coherence Index, run on a seeded sample of ${input.scope.length} verified held-out fixes (scope: the product folder of the commented file), fix commit against its parent. It "moves as asked" when the unrounded composite rises by ${scopeMoveThreshold} or more, the #95 threshold. It could be computed for ${scoreable.length}.`,
    "",
    `- Moved as asked: ${fraction(rate(scoreable.map(movedAsAsked)))}. Moved the other way (falls by ${scopeMoveThreshold} or more): ${fraction(rate(scoreable.map(({ before, after }) => before! - after! >= scopeMoveThreshold)))}.`,
    `- Grader on the same sample, confirmed catches: ${fraction(rate(heldOut.cases.filter(({ id }) => input.scope.some((result) => result.id === id)).map(confirmed)))}.`,
    "",
    "### Speed",
    "",
    `${seconds.length} gradings: median ${quantile(seconds, 0.5).toFixed(2)} s, p90 ${quantile(seconds, 0.9).toFixed(2)} s, mean ${(seconds.reduce((sum, value) => sum + value, 0) / Math.max(1, seconds.length)).toFixed(2)} s per commit range, warm caches, one process per shard.`,
  ].join("\n");
}

function falseAlarmsByDetector(flags: Flag[], verdicts: FalseAlarmLabel[]): string[] {
  const verdictOf = new Map(verdicts.map((label) => [label.id, label.verdict]));
  const grouped = Map.groupBy(flags, ({ violation }) => violation.detector);
  return [...grouped].map(([detector, group]) => {
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

function quantile(sorted: number[], q: number): number {
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}
