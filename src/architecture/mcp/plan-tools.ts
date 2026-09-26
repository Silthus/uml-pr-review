import { z } from "zod";
import { renderConformanceText } from "../conformance/index.ts";
import {
  ArchitecturePlanSchema,
  ConformanceResultSchema,
  PlanContextSchema,
  PlanOperationSchema,
  PlanSummarySchema,
  PlanViewSchema,
  type ArchitecturePlan,
  type ConformanceResult,
  type PlanContext,
  type PlanOperation,
  type RepositoryRef,
  type SelectionTarget,
} from "../contracts/index.ts";
import { describeRevision, humanChanges, pendingHumanComments, planView, type ApplyOutcome } from "../plan/index.ts";
import type { ArchitectureService, RepositoryPlans } from "../service.ts";
import { descriptions } from "./descriptions.ts";
import { counted, humanActivityNext, otherPlansLines, planContextText, planNext, planText, short } from "./text.ts";
import { defineTool, ToolFailure, worktreeSchema, type ToolContext } from "./tool-kit.ts";

const planIdSchema = z.string().describe("The plan id, for example charge-orders-3f2a.");
const latestPlanIdSchema = z.string().optional().describe("The plan id. Default: the most recently updated plan in this repository.");

const withPlanContext = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape).extend(PlanContextSchema.shape);

export const createPlanTool = defineTool({
  name: "create_plan",
  title: "Create plan",
  description: descriptions.create_plan,
  input: z.object({
    worktree: worktreeSchema,
    title: ArchitecturePlanSchema.shape.title.describe("A short name for the change, at most 120 characters."),
    goal: ArchitecturePlanSchema.shape.goal.describe("What the change achieves and why, at most 2000 characters."),
  }),
  output: withPlanContext({ plan: PlanViewSchema }),
  async run({ title, goal }, { service, repository, client }) {
    const plans = await service.plans(repository.root);
    const plan = await plans.create({ title, goal, actor: "agent", client });
    const context = planContext(service, repository, plan);
    const text = [`Created plan ${plan.id} at revision ${plan.revision} (${plan.status}), based on HEAD ${short(plan.baseCommit)} of ${repository.root}.`, ...planContextText(context)];
    return {
      output: { plan: planView(plan), ...context },
      text: text.join("\n"),
      next: `Add the modules and seams with edit_plan (planId ${plan.id}, expectedRevision ${plan.revision}). The human watches the plan in the explorer and may comment on it or edit it.`,
      summary: `create_plan ${plan.id}`,
      planId: plan.id,
    };
  },
});

export const getPlanTool = defineTool({
  name: "get_plan",
  title: "Get plan",
  description: descriptions.get_plan,
  input: z.object({
    worktree: worktreeSchema,
    planId: latestPlanIdSchema,
    history: z.boolean().default(false).describe("Include every revision of the plan. Default false."),
  }),
  output: withPlanContext({ plan: z.union([ArchitecturePlanSchema, PlanViewSchema]), otherPlans: z.array(PlanSummarySchema) }),
  async run({ planId, history }, { service, repository }) {
    const plans = await service.plans(repository.root);
    const plan = await chosenPlan(plans, planId);
    const otherPlans = (await plans.list()).filter((summary) => summary.id !== plan.id);
    const context = planContext(service, repository, plan);
    const revisions = history ? ["Revisions:", ...plan.revisions.map((revision) => `  ${revision.number} by the ${revision.actor}${revision.client ? ` (${revision.client})` : ""}: ${describeRevision(revision)}`)] : [];
    const text = [...planText(plan), ...revisions, ...otherPlansLines(otherPlans), ...planContextText(context)];
    return {
      output: { plan: history ? plan : planView(plan), otherPlans, ...context },
      text: text.join("\n"),
      next: planNext(plan, context),
      summary: `get_plan ${plan.id}`,
      planId: plan.id,
    };
  },
});

export const editPlanTool = defineTool({
  name: "edit_plan",
  title: "Edit plan",
  description: descriptions.edit_plan,
  input: z.object({
    worktree: worktreeSchema,
    planId: planIdSchema,
    expectedRevision: z.number().int().positive().describe("The plan revision you last saw. Nothing is applied if the plan has moved on."),
    operations: z.array(PlanOperationSchema).min(1).max(50).describe("1 to 50 operations, applied in order and all or nothing."),
    note: z.string().max(2000).optional().describe("Why you made these edits, shown to the human."),
  }),
  output: withPlanContext({ plan: PlanViewSchema, warnings: z.array(z.string()) }),
  async run({ planId, expectedRevision, operations, note }, { service, repository, client }) {
    const plans = await service.plans(repository.root);
    const outcome = await plans.apply(planId, { expectedRevision, operations, actor: "agent", client, note });
    const plan = acceptedPlan(outcome, planId, service, repository);
    const context = planContext(service, repository, plan);
    const warnings = outcome.ok ? outcome.warnings : [];
    const revision = plan.revisions.at(-1)!;
    const text = [
      `Applied revision ${revision.number}: ${describeRevision(revision)}.`,
      ...(warnings.length > 0 ? ["Warnings:", ...warnings.map((warning) => `  ${warning}`)] : []),
      ...planText(plan),
      ...planContextText(context),
    ];
    return {
      output: { plan: planView(plan), warnings, ...context },
      text: text.join("\n"),
      next: planNext(plan, context),
      summary: `edit_plan: ${describeRevision(revision)}`,
      planId,
      selection: lastTouched(operations),
    };
  },
});

export const setPlanLockTool = defineTool({
  name: "set_plan_lock",
  title: "Lock or unlock plan",
  description: descriptions.set_plan_lock,
  input: z.object({
    worktree: worktreeSchema,
    planId: planIdSchema,
    locked: z.boolean().describe("true locks the plan, false unlocks it."),
    humanRequest: z.string().min(1).max(2000).describe("The human's words in this conversation that asked for the lock or unlock, quoted exactly."),
  }),
  output: withPlanContext({ plan: PlanViewSchema }),
  async run({ planId, locked, humanRequest }, { service, repository, client }) {
    const plans = await service.plans(repository.root);
    const outcome = await plans.setLock(planId, { locked, actor: "human", client, note: humanRequest });
    const plan = acceptedPlan(outcome, planId, service, repository);
    const context = planContext(service, repository, plan);
    const text = [`Plan ${plan.id} is now ${plan.status} at revision ${plan.revision}.`, ...planText(plan), ...planContextText(context)];
    return { output: { plan: planView(plan), ...context }, text: text.join("\n"), next: planNext(plan, context), summary: `set_plan_lock ${planId}: ${plan.status}`, planId };
  },
});

export const checkPlanTool = defineTool({
  name: "check_plan",
  title: "Check plan",
  description: descriptions.check_plan,
  input: z.object({
    worktree: worktreeSchema,
    planId: latestPlanIdSchema,
    final: z.boolean().default(false).describe("true when you think the implementation is done: planned work still missing becomes a violation. Default false."),
  }),
  output: withPlanContext({ result: ConformanceResultSchema }),
  async run({ planId, final }, { service, repository }) {
    const plans = await service.plans(repository.root);
    const plan = await chosenPlan(plans, planId);
    const result = await service.check(repository.root, plan.id, { phase: final ? "final" : "progress" });
    const context = planContext(service, repository, plan);
    return {
      output: { result, ...context },
      text: [renderConformanceText(result), "", ...planContextText(context)].join("\n"),
      next: checkNext(result, context),
      summary: `check_plan: ${countsSummary(result)}`,
      planId: plan.id,
      selection: firstViolation(result),
    };
  },
});

export const planTools = [createPlanTool, getPlanTool, editPlanTool, setPlanLockTool, checkPlanTool];

function planContext(service: ArchitectureService, repository: RepositoryRef, plan: ArchitecturePlan): PlanContext {
  return { pendingHumanComments: pendingHumanComments(plan), humanChanges: humanChanges(plan), explorerUrl: service.explorerUrl(repository, plan.id) };
}

function chosenPlan(plans: RepositoryPlans, planId: string | undefined): Promise<ArchitecturePlan> {
  return planId === undefined ? plans.latest() : plans.get(planId);
}

function acceptedPlan(outcome: ApplyOutcome, planId: string, service: ToolContext["service"], repository: RepositoryRef): ArchitecturePlan {
  if (outcome.ok) return outcome.plan;
  const context = outcome.plan ? planContextText(planContext(service, repository, outcome.plan)) : [];
  throw new ToolFailure([outcome.message, ...context].join("\n"), planId);
}

function lastTouched(operations: PlanOperation[]): SelectionTarget | undefined {
  for (const operation of operations.toReversed()) {
    if (operation.op === "upsert_module" || operation.op === "drop_module") return { kind: "module", path: operation.path };
    if (operation.op === "upsert_seam" || operation.op === "drop_seam") return { kind: "seam", from: operation.from, to: operation.to };
  }
  return undefined;
}

function firstViolation(result: ConformanceResult): SelectionTarget | undefined {
  const subject = result.findings.find((finding) => finding.severity === "violation")?.subject;
  if (!subject) return undefined;
  return subject.kind === "module" ? { kind: "module", path: subject.path } : { kind: "seam", from: subject.from, to: subject.to };
}

function checkNext(result: ConformanceResult, context: PlanContext): string {
  const draft = result.planStatus === "draft" ? "The plan is a draft; ask the human to lock it before you implement." : "";
  return [humanActivityNext(context), draft, checkOutcomeNext(result)].filter(Boolean).join(" ");
}

function checkOutcomeNext({ counts, phase }: ConformanceResult): string {
  if (counts.violations > 0) return "Apply the fix of every violation, then call check_plan again.";
  if (counts.pending > 0) return "Do the planned work listed as pending, then call check_plan again; use final: true when you think you are done.";
  if (phase === "progress") return "Nothing planned is missing or violated so far. Call check_plan with final: true when you think you are done.";
  return "The implementation conforms to the plan.";
}

function countsSummary({ verdict, counts }: ConformanceResult): string {
  const parts = [
    counts.violations > 0 ? counted(counts.violations, "violation") : "",
    counts.pending > 0 ? `${counts.pending} pending` : "",
    counts.warnings > 0 ? counted(counts.warnings, "warning") : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : verdict;
}
