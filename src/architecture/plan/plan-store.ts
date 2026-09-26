import type { Actor, ArchitecturePlan, PlanOperation, PlanSummary, Revision } from "../contracts/index.ts";
import type { ArchitectureModel } from "../model/index.ts";
import { applyOperations, changesContent, isSetBaseCommit } from "./apply-operations.ts";
import * as feedback from "./feedback.ts";
import { keyedMutex } from "./keyed-mutex.ts";
import { planFiles } from "./plan-files.ts";
import { planIdFor } from "./plan-id.ts";
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

type RevisionInput = Pick<Revision, "actor" | "client" | "kind" | "note" | "operations">;

export function commitToValidate(plan: ArchitecturePlan, operations: PlanOperation[]): string {
  return operations.findLast(isSetBaseCommit)?.commit ?? plan.baseCommit;
}

export function openPlanStore(directory: string, clock: () => Date = () => new Date()): PlanStore {
  const files = planFiles(directory);
  const exclusive = keyedMutex();
  const now = () => clock().toISOString();

  async function list(): Promise<PlanSummary[]> {
    const plans = await Promise.all((await files.ids()).map((id) => files.read(id)));
    return plans
      .flatMap((plan) => (plan ? [planSummary(plan)] : []))
      .sort((a, b) => compare(b.updatedAt, a.updatedAt) || compare(a.id, b.id));
  }

  async function create({ title, goal, baseCommit, actor, client }: NewPlan): Promise<ArchitecturePlan> {
    const id = await unusedId(title);
    return exclusive(id, () => {
      const at = now();
      return files.write({
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
      });
    });
  }

  async function unusedId(title: string): Promise<string> {
    const id = planIdFor(title);
    return (await files.exists(id)) ? unusedId(title) : id;
  }

  function apply(id: string, change: PlanChange, base: ArchitectureModel): Promise<ApplyOutcome> {
    return exclusive(id, () =>
      withCurrentPlan(id, change.expectedRevision, async (plan) => {
        if (plan.status === "locked" && change.operations.some(changesContent)) return refused("locked", feedback.lockedPlan(id), plan);
        const baseCommitError = baseCommitProblem(plan, change.operations, base);
        if (baseCommitError) return refused("invalid", baseCommitError, plan);
        const at = now();
        const batch = applyOperations(plan, change.operations, { base, actor: change.actor, at, revision: plan.revision + 1 });
        if (batch.errors.length > 0) return refused("invalid", feedback.rejectedBatch(batch.errors, plan.revision), plan);
        const { actor, client, note, operations } = change;
        return accepted(await appendRevision(batch.plan, at, { actor, client, kind: "edit", note, operations }), batch.warnings);
      }),
    );
  }

  function setLock(id: string, { locked, actor, client, note, expectedRevision }: LockChange): Promise<ApplyOutcome> {
    return exclusive(id, () =>
      withCurrentPlan(id, expectedRevision, async (plan) => {
        const isLocked = plan.status === "locked";
        if (locked && isLocked) return refused("invalid", feedback.alreadyLocked(id), plan);
        if (!locked && !isLocked) return refused("invalid", feedback.notLocked(id), plan);
        const next = { ...plan, status: locked ? ("locked" as const) : ("draft" as const) };
        return accepted(await appendRevision(next, now(), { actor, client, kind: locked ? "lock" : "unlock", note, operations: [] }), []);
      }),
    );
  }

  async function withCurrentPlan(id: string, expectedRevision: number | undefined, work: (plan: ArchitecturePlan) => Promise<ApplyOutcome>): Promise<ApplyOutcome> {
    const plan = await files.read(id);
    if (!plan) return { ok: false, reason: "not-found", message: feedback.unknownPlan(id, await files.ids()) };
    if (expectedRevision !== undefined && expectedRevision !== plan.revision) return stale(plan, expectedRevision);
    return work(plan);
  }

  function appendRevision(plan: ArchitecturePlan, at: string, input: RevisionInput): Promise<ArchitecturePlan> {
    const number = plan.revision + 1;
    return files.write({ ...plan, revision: number, revisions: [...plan.revisions, { number, at, ...input }], updatedAt: at });
  }

  return { list, get: files.read, create, apply, setLock };
}

function baseCommitProblem(plan: ArchitecturePlan, operations: PlanOperation[], base: ArchitectureModel): string | undefined {
  const commit = commitToValidate(plan, operations);
  if (base.payload.commit === commit) return undefined;
  if (commit === plan.baseCommit) throw new Error(`apply validates against the architecture of ${commit}, but got the architecture of ${base.payload.commit ?? "a snapshot"}.`);
  const index = operations.findLastIndex(isSetBaseCommit);
  return feedback.rejectedBatch([{ index, operation: operations[index]!, error: feedback.missingCommit(commit) }], plan.revision);
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

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
