import { describe, expect, test } from "bun:test";
import type { Actor, ArchitecturePlan, PlanOperation, Revision } from "../../../src/architecture/contracts/index.ts";
import { describeRevision, humanChanges, pendingHumanComments, planView, type PlanStore } from "../../../src/architecture/plan/index.ts";
import { base, draft, flagsFacade, freshStore, logic } from "./store-fixture.ts";

async function edit(store: PlanStore, plan: ArchitecturePlan, actor: Actor, operations: PlanOperation[]): Promise<ArchitecturePlan> {
  const outcome = await store.apply(plan.id, { expectedRevision: plan.revision, actor, operations }, base);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.plan;
}

describe("how the human reaches the agent", () => {
  test("lists the human's unanswered comments and the human revisions since the agent's last one", async () => {
    const { store } = await freshStore();
    let plan = await draft(store);
    plan = await edit(store, plan, "human", [{ op: "add_comment", target: { kind: "plan" }, body: "Why a new module?" }]);
    plan = await edit(store, plan, "agent", [
      { op: "resolve_comment", commentId: "c1", reply: "It isolates the loading." },
      { op: "add_comment", target: { kind: "module", path: logic }, body: "I will keep this thin." },
    ]);
    plan = await edit(store, plan, "human", [
      { op: "add_comment", target: { kind: "seam", from: logic, to: flagsFacade }, body: "Only through the facade." },
      { op: "upsert_module", path: logic, action: "modify", responsibility: "Show flags on issues" },
    ]);
    const locked = await store.setLock(plan.id, { locked: true, actor: "human" });
    if (!locked.ok) throw new Error(locked.message);

    expect(pendingHumanComments(locked.plan).map(({ id, body }) => `${id}: ${body}`)).toEqual(["c3: Only through the facade."]);
    expect(humanChanges(locked.plan).map(({ number, kind }) => `${number} ${kind}`)).toEqual(["4 edit", "5 lock"]);
  });

  test("counts every revision as a human change while the agent has not written", async () => {
    const { store } = await freshStore();
    const plan = await edit(store, await draft(store, "human"), "human", [{ op: "add_comment", target: { kind: "plan" }, body: "Start here." }]);

    expect(humanChanges(plan).map(({ number }) => number)).toEqual([1, 2]);
  });

  test("shows a plan without its revision log", async () => {
    const { store } = await freshStore();
    const plan = await draft(store);

    expect(planView(plan)).toEqual({
      version: 1,
      id: plan.id,
      title: plan.title,
      goal: plan.goal,
      baseCommit: plan.baseCommit,
      status: "draft",
      revision: 1,
      modules: [],
      seams: [],
      comments: [],
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    });
  });
});

describe("describeRevision", () => {
  const revision = (kind: Revision["kind"], operations: PlanOperation[] = []): Revision => ({ number: 2, at: "2026-09-26T10:00:00.000Z", actor: "human", kind, operations });

  test.each([
    { kind: "create" as const, summary: "created" },
    { kind: "lock" as const, summary: "locked" },
    { kind: "unlock" as const, summary: "unlocked" },
  ])("summarizes a $kind revision as $summary", ({ kind, summary }) => {
    expect(describeRevision(revision(kind))).toBe(summary);
  });

  test("tallies an edit's operations in one line", () => {
    expect(
      describeRevision(
        revision("edit", [
          { op: "upsert_module", path: logic, action: "modify", responsibility: "Show flags" },
          { op: "upsert_module", path: `${logic}/flags`, action: "create", responsibility: "Load flags" },
          { op: "upsert_seam", from: logic, to: flagsFacade, action: "add", interface: { files: [`${flagsFacade}/api.py`], symbols: [] } },
          { op: "add_comment", target: { kind: "plan" }, body: "Drafted." },
        ]),
      ),
    ).toBe("+2 modules, +1 seam, 1 comment");
    expect(
      describeRevision(
        revision("edit", [
          { op: "drop_module", path: logic },
          { op: "drop_seam", from: logic, to: flagsFacade },
          { op: "drop_seam", from: logic, to: "posthog/models" },
          { op: "set_summary", title: "Flags" },
          { op: "set_base_commit", commit: "c".repeat(40) },
          { op: "resolve_comment", commentId: "c1" },
          { op: "resolve_comment", commentId: "c2" },
        ]),
      ),
    ).toBe("-1 module, -2 seams, summary, base commit ccccccc, 2 resolved comments");
  });
});
