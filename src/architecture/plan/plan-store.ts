import { z } from "zod";
import { ActorSchema, PlanOperationSchema, RevisionSchema, type Actor, type ArchitecturePlan, type PlanOperation, type PlanSummary, type Revision } from "../contracts/index.ts";
import type { ArchitectureModel } from "../model/index.ts";
import { applyOperations, changesContent, isSetBaseCommit } from "./apply-operations.ts";
import * as feedback from "./feedback.ts";
import { keyedMutex } from "./keyed-mutex.ts";
import { planFiles } from "./plan-files.ts";
import { planIdFor } from "./plan-id.ts";
import { compare } from "./paths.ts";
import { validatePlan } from "./validate-plan.ts";
import { planSummary } from "./views.ts";

export type PlanChange = { expectedRevision: number; operations: PlanOperation[]; actor: Actor; client?: string; note?: string };

export type NewPlan = { title: string; goal: string; baseCommit: string; actor: Actor; client?: string };

export type LockChange = { locked: boolean; actor: Actor; client?: string; note?: string; expectedRevision?: number };

export type ApplyOutcome =
  | { ok: true; plan: ArchitecturePlan; revision: Revision; warnings: string[] }
  | { ok: false; reason: "not-found" | "stale" | "locked" | "invalid"; message: string; plan?: ArchitecturePlan; newerRevisions?: Revision[] };

export type PlanStore = {
  list(): Promise<PlanSummary[]>;
  get(id: string): Promise<ArchitecturePlan | undefined>;
  create(input: NewPlan): Promise<ArchitecturePlan>;
  apply(id: string, change: PlanChange, base: ArchitectureModel): Promise<ApplyOutcome>;
  setLock(id: string, change: LockChange): Promise<ApplyOutcome>;
};

const PlanChangeSchema = z.object({
  expectedRevision: z.number().int().positive(),
  operations: z.array(PlanOperationSchema).min(1, "Send at least one operation."),
  actor: ActorSchema,
  client: z.string().optional(),
  note: RevisionSchema.shape.note,
});

export function commitToValidate(plan: ArchitecturePlan, operations: PlanOperation[]): string {
  return operations.findLast(isSetBaseCommit)?.commit ?? plan.baseCommit;
}

export function openPlanStore(directory: string, clock: () => Date = () => new Date()): PlanStore {
  const files = planFiles(directory);
  const exclusive = keyedMutex();
  const now = () => clock().toISOString();

  async function list(): Promise<PlanSummary[]> {
    const loaded = await Promise.all((await files.ids()).map((id) => files.load(id)));
    return loaded
      .flatMap((file) => (file.status === "found" ? [planSummary(file.plan)] : []))
      .sort((a, b) => compare(b.updatedAt, a.updatedAt) || compare(a.id, b.id));
  }

  async function get(id: string): Promise<ArchitecturePlan | undefined> {
    const file = await files.load(id);
    if (file.status === "unreadable") throw new Error(file.message);
    return file.status === "found" ? file.plan : undefined;
  }

  async function create(input: NewPlan): Promise<ArchitecturePlan> {
    const id = planIdFor(input.title);
    const created = await exclusive(id, async () => ((await files.exists(id)) ? undefined : files.write(newPlan(id, input, now()))));
    return created ?? create(input);
  }

  async function apply(id: string, change: PlanChange, base: ArchitectureModel): Promise<ApplyOutcome> {
    const parsed = PlanChangeSchema.safeParse(change);
    if (!parsed.success) return { ok: false, reason: "invalid", message: feedback.malformedChange(z.prettifyError(parsed.error)) };
    return exclusive(id, () => withCurrentPlan(id, parsed.data.expectedRevision, (plan) => edit(plan, parsed.data, base)));
  }

  async function edit(plan: ArchitecturePlan, { actor, client, note, operations }: PlanChange, base: ArchitectureModel): Promise<ApplyOutcome> {
    if (plan.status === "locked" && operations.some(changesContent)) return refused("locked", feedback.lockedPlan(plan.id), plan);
    const baseCommitError = baseCommitProblem(plan, operations, base);
    if (baseCommitError) return refused("invalid", feedback.rejectedBatch([baseCommitError], plan.revision), plan);
    const revision: Revision = { number: plan.revision + 1, at: now(), actor, client, kind: "edit", note, operations };
    const batch = applyOperations(plan, operations, { actor, at: revision.at, revision: revision.number });
    const check = validatePlan({ ...batch, previous: plan, base });
    const problems = [...batch.errors, ...check.errors].sort((a, b) => a.index - b.index);
    if (problems.length > 0) return refused("invalid", feedback.rejectedBatch(problems.map(({ line }) => line), plan.revision), plan);
    return accepted(await save(batch.plan, revision), check.warnings);
  }

  function setLock(id: string, { locked, actor, client, note, expectedRevision }: LockChange): Promise<ApplyOutcome> {
    return exclusive(id, () =>
      withCurrentPlan(id, expectedRevision, async (plan) => {
        const isLocked = plan.status === "locked";
        if (locked && isLocked) return refused("invalid", feedback.alreadyLocked(id), plan);
        if (!locked && !isLocked) return refused("invalid", feedback.notLocked(id), plan);
        const revision: Revision = { number: plan.revision + 1, at: now(), actor, client, kind: locked ? "lock" : "unlock", note, operations: [] };
        return accepted(await save({ ...plan, status: locked ? "locked" : "draft" }, revision), []);
      }),
    );
  }

  async function withCurrentPlan(id: string, expectedRevision: number | undefined, work: (plan: ArchitecturePlan) => Promise<ApplyOutcome>): Promise<ApplyOutcome> {
    const file = await files.load(id);
    if (file.status === "missing") return { ok: false, reason: "not-found", message: feedback.unknownPlan(id, await files.ids()) };
    if (file.status === "unreadable") return { ok: false, reason: "invalid", message: file.message };
    if (expectedRevision !== undefined && expectedRevision !== file.plan.revision) return stale(file.plan, expectedRevision);
    return work(file.plan);
  }

  function save(plan: ArchitecturePlan, revision: Revision): Promise<ArchitecturePlan> {
    return files.write({ ...plan, revision: revision.number, revisions: [...plan.revisions, revision], updatedAt: revision.at });
  }

  return { list, get, create, apply, setLock };
}

function newPlan(id: string, { title, goal, baseCommit, actor, client }: NewPlan, at: string): ArchitecturePlan {
  return {
    version: 1,
    id,
    title,
    goal,
    baseCommit,
    status: "draft",
    revision: 1,
    modules: [],
    seams: [],
    comments: [],
    revisions: [{ number: 1, at, actor, client, kind: "create", operations: [] }],
    createdAt: at,
    updatedAt: at,
  };
}

function baseCommitProblem(plan: ArchitecturePlan, operations: PlanOperation[], base: ArchitectureModel): string | undefined {
  const commit = commitToValidate(plan, operations);
  if (base.payload.commit === commit) return undefined;
  if (commit === plan.baseCommit) throw new Error(`apply validates against the architecture of ${commit}, but got the architecture of ${base.payload.commit ?? "a snapshot"}.`);
  return feedback.operationProblem(operations.findLastIndex(isSetBaseCommit), "set_base_commit", feedback.missingCommit(commit));
}

function stale(plan: ArchitecturePlan, expectedRevision: number): ApplyOutcome {
  const newerRevisions = plan.revisions.filter((revision) => revision.number > expectedRevision);
  return { ok: false, reason: "stale", message: feedback.staleRevision(plan, expectedRevision, newerRevisions), plan, newerRevisions };
}

function refused(reason: "locked" | "invalid", message: string, plan: ArchitecturePlan): ApplyOutcome {
  return { ok: false, reason, message, plan };
}

function accepted(plan: ArchitecturePlan, warnings: string[]): ApplyOutcome {
  return { ok: true, plan, revision: plan.revisions.at(-1)!, warnings };
}
