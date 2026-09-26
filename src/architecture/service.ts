import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { CommandError, git } from "../git.ts";
import { checkConformance } from "./conformance/index.ts";
import {
  ConformanceResultSchema,
  type ArchitecturePayload,
  type ArchitecturePlan,
  type ConformanceResult,
  type PlanSummary,
  type RepositoryRef,
} from "./contracts/index.ts";
import type { EventBus } from "./events/index.ts";
import { createRepositoryIndexer } from "./index/index.ts";
import { ArchitectureModel } from "./model/index.ts";
import { commitToValidate, openPlanStore, type ApplyOutcome, type LockChange, type NewPlan, type PlanChange, type PlanStore } from "./plan/index.ts";

export type ServiceErrorReason = "not-a-repository" | "unknown-commit" | "no-commits" | "plan-not-found" | "not-descended";

export class ServiceError extends Error {
  constructor(
    readonly reason: ServiceErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type RepositoryPlans = {
  list(): Promise<PlanSummary[]>;
  get(id: string): Promise<ArchitecturePlan>;
  latest(): Promise<ArchitecturePlan>;
  create(input: Omit<NewPlan, "baseCommit">): Promise<ArchitecturePlan>;
  apply(id: string, change: PlanChange): Promise<ApplyOutcome>;
  setLock(id: string, change: LockChange): Promise<ApplyOutcome>;
  lastCheck(id: string): Promise<ConformanceResult | null>;
};

export type ArchitectureService = {
  repository(path: string): Promise<RepositoryRef>;
  architecture(path: string, commit?: string): Promise<ArchitectureModel>;
  plans(path: string): Promise<RepositoryPlans>;
  check(path: string, planId: string, options: { phase: "progress" | "final" }): Promise<ConformanceResult>;
  explorerUrl(repository: RepositoryRef, planId?: string): string;
};

export type ArchitectureServiceDependencies = { bus: EventBus; explorerOrigin: string; clock?: () => Date };

const retainedModels = 6;

export function createArchitectureService({ bus, explorerOrigin, clock = () => new Date() }: ArchitectureServiceDependencies): ArchitectureService {
  const indexer = createRepositoryIndexer({ onIndexed: publishIndexReady });
  const models = new Map<string, ArchitectureModel>();
  const stores = new Map<string, PlanStore>();

  function publishIndexReady({ repository, commit, tree, stats }: ArchitecturePayload): void {
    bus.publish({ type: "index_ready", repositoryId: repository.id, root: repository.root, commit, tree, stats });
  }

  async function repository(path: string): Promise<RepositoryRef> {
    const notARepository = new ServiceError("not-a-repository", `${path} is not inside a Git repository. Pass the absolute path of your working directory.`);
    if (!isAbsolute(path)) throw notARepository;
    return indexer.repository(path).catch(() => {
      throw notARepository;
    });
  }

  async function architecture(path: string, commit = "HEAD"): Promise<ArchitectureModel> {
    const { root } = await repository(path);
    return modelOf(await indexCommit(root, commit));
  }

  async function indexCommit(root: string, commit: string): Promise<ArchitecturePayload> {
    return indexer.index(root, { commit }).catch((error: unknown) => {
      if (error instanceof CommandError) throw unknownCommit(root, commit);
      throw error;
    });
  }

  function unknownCommit(root: string, commit: string): ServiceError {
    if (commit === "HEAD") return new ServiceError("no-commits", `${root} has no commits yet. Commit your work once, then try again.`);
    return new ServiceError("unknown-commit", `Commit \`${commit}\` does not exist in ${root}.`);
  }

  function modelOf(payload: ArchitecturePayload): ArchitectureModel {
    const key = [payload.repository.root, payload.commit, payload.tree].join("\0");
    const model = models.get(key) ?? new ArchitectureModel(payload);
    models.delete(key);
    models.set(key, model);
    if (models.size > retainedModels) models.delete(models.keys().next().value!);
    return model;
  }

  function storeOf(repository: RepositoryRef): PlanStore {
    const store = stores.get(repository.id) ?? openPlanStore(plansDirectory(repository), clock);
    stores.set(repository.id, store);
    return store;
  }

  async function plans(path: string): Promise<RepositoryPlans> {
    const located = await repository(path);
    const store = storeOf(located);
    const published = (outcome: ApplyOutcome): ApplyOutcome => {
      if (outcome.ok) publishPlanPatch(located, outcome.plan);
      return outcome;
    };

    async function get(id: string): Promise<ArchitecturePlan> {
      const plan = await store.get(id);
      if (!plan) throw new ServiceError("plan-not-found", unknownPlan(id, (await store.list()).map((summary) => summary.id)));
      return plan;
    }

    async function latest(): Promise<ArchitecturePlan> {
      const [newest] = await store.list();
      if (!newest) throw new ServiceError("plan-not-found", unknownPlan("", []));
      return get(newest.id);
    }

    async function create(input: Omit<NewPlan, "baseCommit">): Promise<ArchitecturePlan> {
      const plan = await store.create({ ...input, baseCommit: await headCommit(located.root) });
      publishPlanPatch(located, plan);
      return plan;
    }

    async function apply(id: string, change: PlanChange): Promise<ApplyOutcome> {
      const plan = await store.get(id);
      const base = await baseModel(located.root, plan ? commitToValidate(plan, change.operations) : "HEAD", plan);
      return published(await store.apply(id, change, base));
    }

    return {
      list: () => store.list(),
      get,
      latest,
      create,
      apply,
      setLock: async (id, change) => published(await store.setLock(id, change)),
      lastCheck: (id) => readConformance(located, id),
    };
  }

  async function baseModel(root: string, commit: string, plan: ArchitecturePlan | undefined): Promise<ArchitectureModel> {
    const payload = await indexCommit(root, commit).catch((error: unknown) => {
      if (error instanceof ServiceError && plan) return indexCommit(root, plan.baseCommit);
      throw error;
    });
    return modelOf(payload);
  }

  function publishPlanPatch(repository: RepositoryRef, plan: ArchitecturePlan): void {
    bus.publish({ type: "plan_patch", repositoryId: repository.id, planId: plan.id, revision: plan.revisions.at(-1)!, plan });
  }

  async function check(path: string, planId: string, { phase }: { phase: "progress" | "final" }): Promise<ConformanceResult> {
    const located = await repository(path);
    const plan = await (await plans(located.root)).get(planId);
    await refuseUnlessDescended(located.root, plan.baseCommit);
    const [base, head] = await Promise.all([indexCommit(located.root, plan.baseCommit), indexer.index(located.root, "working-tree")]);
    const changes = await indexer.changes(located.root, base.tree, head.tree);
    const report = checkConformance({ plan, base: modelOf(base), head: modelOf(head), changes, phase });
    const result: ConformanceResult = {
      ...report,
      planId: plan.id,
      planRevision: plan.revision,
      planStatus: plan.status,
      phase,
      worktree: located.root,
      baseCommit: plan.baseCommit,
      snapshotTree: head.tree,
      checkedAt: clock().toISOString(),
    };
    await writeConformance(located, result);
    bus.publish({ type: "conformance_result", repositoryId: located.id, planId: plan.id, result });
    return result;
  }

  function explorerUrl(repository: RepositoryRef, planId?: string): string {
    const plan = planId === undefined ? "" : `&plan=${encodeURIComponent(planId)}`;
    return `${explorerOrigin}/?path=${encodeURIComponent(repository.root)}${plan}`;
  }

  return { repository, architecture, plans, check, explorerUrl };
}

function plansDirectory(repository: RepositoryRef): string {
  return join(repository.commonDir, "uml-pr-review", "plans");
}

function conformancePath(repository: RepositoryRef, planId: string): string {
  return join(plansDirectory(repository), `${planId}.conformance.json`);
}

async function readConformance(repository: RepositoryRef, planId: string): Promise<ConformanceResult | null> {
  const text = await readFile(conformancePath(repository, planId), "utf8").catch(() => undefined);
  if (text === undefined) return null;
  try {
    return ConformanceResultSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

async function writeConformance(repository: RepositoryRef, result: ConformanceResult): Promise<void> {
  const target = conformancePath(repository, result.planId);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await mkdir(plansDirectory(repository), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function headCommit(root: string): Promise<string> {
  const head = await git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).catch(() => "");
  if (!head.trim()) throw new ServiceError("no-commits", `${root} has no commits yet. Commit your work once, then try again.`);
  return head.trim();
}

async function refuseUnlessDescended(root: string, baseCommit: string): Promise<void> {
  const descends = await git(root, ["merge-base", "--is-ancestor", baseCommit, "HEAD"]).then(
    () => true,
    () => false,
  );
  if (descends) return;
  const base7 = baseCommit.slice(0, 7);
  throw new ServiceError(
    "not-descended",
    `HEAD of ${root} does not descend from the plan's base commit ${base7}. Check out a branch based on ${base7}, or move the plan's base with set_base_commit while it is a draft.`,
  );
}

function unknownPlan(id: string, ids: string[]): string {
  if (ids.length === 0) return "There is no plan in this repository yet. Call create_plan.";
  return `No plan \`${id}\` in this repository. Plans here: ${ids.map((planId) => `\`${planId}\``).join(", ")}. Call get_plan without planId for the latest.`;
}
