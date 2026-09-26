import type {
  ArchitecturePlan,
  ChangedFile,
  ConformancePhase,
  ConformanceReport,
  ElementStatus,
  Finding,
  FindingSeverity,
} from "../contracts/index.ts";
import type { ArchitectureModel } from "../model/index.ts";
import { Change } from "./change.ts";
import type { DraftFinding } from "./draft.ts";
import { importFindings } from "./import-rules.ts";
import { moduleFindings } from "./module-rules.ts";
import { compare } from "./paths.ts";
import { productionImportsAlong, seamFindings } from "./seam-rules.ts";

export type ConformanceInput = {
  plan: ArchitecturePlan;
  base: ArchitectureModel;
  head: ArchitectureModel;
  changes: ChangedFile[];
  phase: ConformancePhase;
};

const severityOrder: Record<FindingSeverity, number> = { violation: 0, pending: 1, warning: 2 };

export function checkConformance({ phase, ...input }: ConformanceInput): ConformanceReport {
  const change = new Change(input);
  const imports = importFindings(change);
  const drafts = [...moduleFindings(change), ...imports, ...seamFindings(change, imports)];
  const findings = drafts.map((draft) => finalized(draft, phase)).sort(bySeverityThenLocation);
  const statusOf = elementStatuses(findings);
  return {
    verdict: verdictOf(findings),
    modules: change.plan.modules.map(({ path, action }) => ({ path, action, status: statusOf(moduleKey(path)) })),
    seams: change.plan.seams.map((seam) => ({
      from: seam.from,
      to: seam.to,
      action: seam.action,
      status: statusOf(seamKey(seam)),
      imports: productionImportsAlong(change, seam).length,
    })),
    findings,
    counts: {
      violations: countOf(findings, "violation"),
      pending: countOf(findings, "pending"),
      warnings: countOf(findings, "warning"),
    },
  };
}

function finalized({ severity, ...draft }: DraftFinding, phase: ConformancePhase): Finding {
  const planned = severity === "planned" ? (phase === "progress" ? "pending" : "violation") : severity;
  return {
    id: [draft.rule, draft.file, draft.line, draft.target ?? subjectKey(draft.subject)].join("|"),
    ...draft,
    severity: draft.test && planned === "violation" ? "warning" : planned,
  };
}

function bySeverityThenLocation(a: Finding, b: Finding): number {
  return severityOrder[a.severity] - severityOrder[b.severity] || compare(a.file, b.file) || a.line - b.line || compare(a.id, b.id);
}

function elementStatuses(findings: Finding[]): (key: string) => ElementStatus {
  const statuses = new Map<string, ElementStatus>();
  for (const { severity, subject } of findings) {
    const key = subject.kind === "module" ? moduleKey(subject.path) : seamKey(subject);
    if (severity === "violation") statuses.set(key, "violating");
    else if (severity === "pending" && statuses.get(key) !== "violating") statuses.set(key, "pending");
  }
  return (key) => statuses.get(key) ?? "conforming";
}

function verdictOf(findings: Finding[]): ElementStatus {
  if (findings.some(({ severity }) => severity === "violation")) return "violating";
  if (findings.some(({ severity }) => severity === "pending")) return "pending";
  return "conforming";
}

function countOf(findings: Finding[], severity: FindingSeverity): number {
  return findings.filter((finding) => finding.severity === severity).length;
}

function subjectKey(subject: Finding["subject"]): string {
  return subject.kind === "module" ? subject.path : `${subject.from} -> ${subject.to}`;
}

function moduleKey(path: string): string {
  return `module\n${path}`;
}

function seamKey({ from, to }: { from: string; to: string }): string {
  return `seam\n${from}\n${to}`;
}
