import type { ConformanceResult, Finding } from "../contracts/index.ts";

const findingsInText = 40;

export function renderConformanceText(result: ConformanceResult): string {
  const shown = result.findings.slice(0, findingsInText);
  const hidden = result.findings.length - shown.length;
  return [
    headerOf(result),
    countsOf(result.counts),
    ...(result.planStatus === "draft" ? ["The plan is a draft. Ask the human to lock it before you implement."] : []),
    ...(shown.length > 0 ? ["", ...shown.flatMap(findingLines)] : []),
    ...(hidden > 0 ? [`${counted(hidden, "more finding", "more findings")} ${hidden === 1 ? "is" : "are"} in structuredContent.findings.`] : []),
  ].join("\n");
}

function headerOf(result: ConformanceResult): string {
  return `Plan ${result.planId} revision ${result.planRevision} (${result.planStatus}), ${result.phase} check of ${result.worktree} at snapshot ${short(result.snapshotTree)} against base ${short(result.baseCommit)}: ${result.verdict}.`;
}

function countsOf({ violations, pending, warnings }: ConformanceResult["counts"]): string {
  return `${counted(violations, "violation", "violations")}, ${pending} pending, ${counted(warnings, "warning", "warnings")}.`;
}

function findingLines({ severity, rule, file, line, message, fix }: Finding): string[] {
  return [`${severity} ${rule} ${file}:${line}`, `  ${message}`, `  Fix: ${fix}`];
}

function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function short(sha: string): string {
  return sha.slice(0, 7);
}
