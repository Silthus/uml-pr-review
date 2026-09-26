import type {
  ArchitecturePlan,
  CommentTarget,
  Dependency,
  FarDependency,
  ImportEvidence,
  ModuleView,
  PlanComment,
  PlanContext,
  PlanSummary,
  PlanView,
  Revision,
  Seam,
  SearchHit,
} from "../contracts/index.ts";
import { describeRevision } from "../plan/index.ts";

export function short(sha: string): string {
  return sha.slice(0, 7);
}

export function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function moduleLine(module: ModuleView, indent = ""): string {
  const children = module.childCount > 0 ? `, ${counted(module.childCount, "child", "children")}` : "";
  return `${indent}${module.path} (${module.kind}, ${counted(module.totalFiles, "file")}${children})`;
}

export function dependencyLine({ from, to, imports }: Dependency): string {
  return `  ${from} -> ${to}: ${counted(imports, "import")}`;
}

export function farDependencyLine({ module, imports, via }: FarDependency): string {
  const deepest = via.filter((leaf) => leaf.module !== module);
  const through = deepest.length > 0 ? ` via ${deepest.map((leaf) => `${leaf.module} (${leaf.imports})`).join(", ")}` : "";
  return `  ${module}: ${counted(imports, "import")}${through}`;
}

export function evidenceLine({ file, line, target, kind, names, test }: ImportEvidence): string {
  const imported = names.length > 0 ? ` [${names.join(", ")}]` : "";
  return `  ${file}:${line} -> ${target} (${kind}${test ? ", test" : ""})${imported}`;
}

export function searchHitLines({ module, files }: SearchHit): string[] {
  return [moduleLine(module, "  "), ...files.map((file) => `    ${file}`)];
}

export function section<T>(heading: string, items: T[], line: (item: T) => string | string[], empty: string): string[] {
  if (items.length === 0) return [`${heading}: ${empty}`];
  return [`${heading}:`, ...items.flatMap(line)];
}

export function planText(plan: PlanView | ArchitecturePlan): string[] {
  return [
    `Plan ${plan.id} "${plan.title}" at revision ${plan.revision} (${plan.status}), base commit ${short(plan.baseCommit)}.`,
    `Goal: ${plan.goal}`,
    ...section(`Modules (${plan.modules.length})`, plan.modules, ({ action, path, responsibility }) => `  ${action} ${path}: ${responsibility}`, "none yet."),
    ...section(`Seams (${plan.seams.length})`, plan.seams, seamLine, "none yet."),
    openCommentsLine(plan.comments),
  ];
}

function seamLine({ action, from, to, interface: through, rationale }: Seam): string {
  const files = through ? ` through ${through.files.map((file) => `\`${file}\``).join(" or ")}` : "";
  const symbols = through && through.symbols.length > 0 ? ` (symbols ${through.symbols.join(", ")})` : "";
  return `  ${action} ${from} -> ${to}${files}${symbols}${rationale ? `: ${rationale}` : ""}`;
}

function openCommentsLine(comments: PlanComment[]): string {
  const open = comments.filter((comment) => !comment.resolution).length;
  return `Comments: ${comments.length} (${open} open).`;
}

export function planNext(plan: PlanView | ArchitecturePlan, context: PlanContext): string {
  const work =
    plan.status === "locked"
      ? `The plan is locked: implement it, run check_plan while you work, and check_plan with final: true when you are done. Only comments can change it now (edit_plan with expectedRevision ${plan.revision}).`
      : `Change the plan with edit_plan (planId ${plan.id}, expectedRevision ${plan.revision}). When the human agrees, they lock it; then implement it and run check_plan.`;
  return [humanActivityNext(context), work].filter(Boolean).join(" ");
}

export function humanActivityNext({ pendingHumanComments, humanChanges }: PlanContext): string {
  return [
    pendingHumanComments.length > 0
      ? `First answer ${counted(pendingHumanComments.length, "human comment")}: resolve each with edit_plan resolve_comment and a reply, after changing the plan if the comment asks for it.`
      : "",
    humanChanges.length > 0 ? "The human changed the plan since your last edit; build on their changes, not over them." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function otherPlansLines(plans: PlanSummary[]): string[] {
  if (plans.length === 0) return [];
  return [`Other plans: ${plans.map(({ id, status, revision }) => `${id} (${status}, revision ${revision})`).join(", ")}.`];
}

export function planContextText({ pendingHumanComments, humanChanges, explorerUrl }: PlanContext): string[] {
  return [
    ...(pendingHumanComments.length > 0
      ? [
          `Human comments waiting for you (${pendingHumanComments.length}):`,
          ...pendingHumanComments.map(({ id, target, body }) => `${id} on ${targetText(target)}: "${body}"`),
        ]
      : []),
    ...(humanChanges.length > 0
      ? ["The human changed the plan since your last edit:", ...humanChanges.map(revisionLine)]
      : []),
    `Explorer: ${explorerUrl}`,
  ];
}

function revisionLine(revision: Revision): string {
  const note = revision.note ? ` ("${revision.note}")` : "";
  return `Revision ${revision.number}: ${describeRevision(revision)}${note}.`;
}

export function targetText(target: CommentTarget): string {
  if (target.kind === "plan") return "the plan";
  if (target.kind === "module") return `module \`${target.path}\``;
  return `seam \`${target.from} -> ${target.to}\``;
}
