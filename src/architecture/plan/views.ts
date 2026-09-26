import type { ArchitecturePlan, PlanComment, PlanOperation, PlanSummary, PlanView, Revision } from "../contracts/index.ts";

export function pendingHumanComments(plan: Pick<ArchitecturePlan, "comments">): PlanComment[] {
  return plan.comments.filter((comment) => comment.author === "human" && !comment.resolution);
}

export function humanChanges(plan: Pick<ArchitecturePlan, "revisions">): Revision[] {
  const lastAgentRevision = plan.revisions.findLastIndex((revision) => revision.actor === "agent");
  return plan.revisions.slice(lastAgentRevision + 1);
}

export function planView(plan: ArchitecturePlan): PlanView {
  const { revisions: _revisions, ...view } = plan;
  return view;
}

export function planSummary(plan: ArchitecturePlan): PlanSummary {
  const { id, title, baseCommit, status, revision, updatedAt } = plan;
  return { id, title, baseCommit, status, revision, updatedAt, pendingHumanComments: pendingHumanComments(plan).length };
}

const kindSummaries = { create: "created", lock: "locked", unlock: "unlocked" } as const;

export function describeRevision(revision: Revision): string {
  if (revision.kind !== "edit") return kindSummaries[revision.kind];
  return operationTallies(revision.operations).join(", ") || "no changes";
}

function operationTallies(operations: PlanOperation[]): string[] {
  const count = (op: PlanOperation["op"]) => operations.filter((operation) => operation.op === op).length;
  const baseCommit = operations.findLast((operation) => operation.op === "set_base_commit");
  return [
    tally("+", count("upsert_module"), "module"),
    tally("-", count("drop_module"), "module"),
    tally("+", count("upsert_seam"), "seam"),
    tally("-", count("drop_seam"), "seam"),
    count("set_summary") > 0 ? "summary" : "",
    baseCommit ? `base commit ${baseCommit.commit.slice(0, 7)}` : "",
    tally("", count("add_comment"), "comment"),
    tally("", count("resolve_comment"), "resolved comment"),
  ].filter(Boolean);
}

function tally(sign: string, count: number, noun: string): string {
  if (count === 0) return "";
  return `${sign}${count} ${noun}${count === 1 ? "" : "s"}`;
}
