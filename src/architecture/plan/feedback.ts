import type { ArchitecturePlan, PlanOperation, Revision } from "../contracts/index.ts";
import { seamLabel, shortCommit } from "./paths.ts";
import { describeRevision } from "./views.ts";

export function unknownModule(path: string, base7: string, suggestions: string[]): string {
  const didYouMean = suggestions.length > 0 ? ` Did you mean ${alternatives(suggestions)}?` : "";
  return `No module \`${path}\` at base commit ${base7}.${didYouMean} Use search_modules to find module paths.`;
}

export function moduleAlreadyExists(path: string, base7: string): string {
  return `\`${path}\` already exists at ${base7}; plan it as modify.`;
}

export function fileIsNotModule(path: string, base7: string): string {
  return `\`${path}\` is a file at ${base7}, not a module; plan the module that holds it as modify.`;
}

export function rootRemoval(): string {
  return "The repository root `.` cannot be removed; plan the modules inside it as removed instead.";
}

export function seamWithinItself(outer: string, inner: string): string {
  return `A seam connects two separate modules; \`${outer}\` contains \`${inner}\`.`;
}

export function noLongerCreated(endpoint: string): string {
  return `\`${endpoint}\` is no longer a module the plan creates. Drop the seam in the same batch, or keep the module.`;
}

export function interfaceFileOutside(file: string, to: string): string {
  return `Interface file \`${file}\` is not within \`${to}\`.`;
}

export function interfaceFileMissing(file: string, base7: string): string {
  return `Interface file \`${file}\` does not exist at ${base7} yet; the implementation must create it.`;
}

export function seamWithoutDependency(from: string, to: string, base7: string, action: "remove" | "keep"): string {
  return `No file in \`${from}\` imports \`${to}\` at ${base7}; a ${action} seam expects an existing dependency.`;
}

export function missingModule(path: string, plan: ArchitecturePlan): string {
  const existing = plan.modules.length > 0 ? `Its modules are ${codeList(plan.modules.map(({ path }) => path))}.` : "It has no modules yet.";
  return `The plan has no module \`${path}\` to drop. ${existing}`;
}

export function missingSeam(from: string, to: string, plan: ArchitecturePlan): string {
  const existing = plan.seams.length > 0 ? `Its seams are ${codeList(plan.seams.map(seamLabel))}.` : "It has no seams yet.";
  return `The plan has no seam \`${seamLabel({ from, to })}\` to drop. ${existing}`;
}

export function missingComment(commentId: string, plan: ArchitecturePlan): string {
  return `The plan has no comment \`${commentId}\`. ${openComments(plan)}`;
}

export function commentAlreadyResolved(commentId: string, plan: ArchitecturePlan): string {
  return `Comment \`${commentId}\` is already resolved. ${openComments(plan)}`;
}

export function missingCommit(commit: string): string {
  return `Commit \`${shortCommit(commit)}\` does not exist in this repository. Pass the full 40-character SHA of an existing commit, for example the output of git rev-parse HEAD.`;
}

export function operationProblem(index: number, op: PlanOperation["op"], error: string): string {
  return `Operation ${index + 1} (${op}): ${error}`;
}

export function rejectedBatch(problems: string[], revision: number): string {
  return [...problems, `Nothing was applied. Fix these problems and send the whole batch again with expectedRevision ${revision}.`].join("\n");
}

export function malformedChange(details: string): string {
  return `The edit does not match the edit_plan input schema, so nothing was applied.\n${details}`;
}

export function unreadablePlan(file: string, reason: string): string {
  return `The plan file ${file} cannot be read as a plan (${reason}). Restore or delete that file, or start a new plan with create_plan.`;
}

export function unknownPlan(id: string, ids: string[]): string {
  if (ids.length === 0) return "There is no plan in this repository yet. Call create_plan.";
  return `No plan \`${id}\` in this repository. Plans here: ${codeList(ids)}. Call get_plan without planId for the latest.`;
}

export function staleRevision(plan: ArchitecturePlan, expected: number, newerRevisions: Revision[]): string {
  const changes = newerRevisions.map((revision) => `Revision ${revision.number} by the ${revision.actor}: ${describeRevision(revision)}.`);
  return [`The plan is at revision ${plan.revision}, not ${expected}.`, ...changes, `Retry with expectedRevision ${plan.revision} if your edits still make sense.`].join(" ");
}

export function lockedPlan(id: string): string {
  return `Plan ${id} is locked. Its modules and seams are what the human approved. Ask the human to unlock it in the explorer if the plan must change; comments still work.`;
}

export function alreadyLocked(id: string): string {
  return `Plan ${id} is already locked. Implement it and check your work with check_plan.`;
}

export function notLocked(id: string): string {
  return `Plan ${id} is a draft, so there is nothing to unlock. Change it with edit_plan.`;
}

function openComments(plan: ArchitecturePlan): string {
  const open = plan.comments.filter((comment) => !comment.resolution);
  return open.length > 0 ? `Open comments: ${codeList(open.map(({ id }) => id))}.` : "It has no open comments.";
}

function codeList(items: string[]): string {
  return items.map((item) => `\`${item}\``).join(", ");
}

function alternatives(items: string[]): string {
  const quoted = items.map((item) => `\`${item}\``);
  if (quoted.length < 3) return quoted.join(" or ");
  return `${quoted.slice(0, -1).join(", ")}, or ${quoted.at(-1)}`;
}
