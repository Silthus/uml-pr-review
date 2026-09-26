import { describe, expect, test } from "bun:test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ArchitecturePlanSchema, type PlanOperation } from "../../../src/architecture/contracts/index.ts";
import { openPlanStore } from "../../../src/architecture/plan/index.ts";
import { at, base, baseCommit, draft, flagsApi, flagsFacade, freshStore, logic, minuteClock } from "./store-fixture.ts";

describe("create", () => {
  test("starts a draft at revision 1 with an id from the title", async () => {
    const { store } = await freshStore();

    const plan = await draft(store);

    expect(plan).toEqual({
      version: 1,
      id: expect.stringMatching(/^feature-flags-on-issues-[0-9a-f]{4}$/),
      title: "Feature flags on issues",
      goal: "Show feature flag usage on error tracking issues.",
      baseCommit,
      status: "draft",
      revision: 1,
      modules: [],
      seams: [],
      comments: [],
      revisions: [{ number: 1, at: at(0), actor: "agent", client: "claude-code@2.1.0", kind: "create", operations: [] }],
      createdAt: at(0),
      updatedAt: at(0),
    });
    expect(await store.get(plan.id)).toEqual(plan);
  });

  test.each([
    { title: "Ünïcode Feature-Flags: on Issues!!", slug: "unicode-feature-flags-on-issues" },
    { title: "A very long title that keeps going well beyond the limit", slug: "a-very-long-title-that-keeps-going-well" },
    { title: "日本語", slug: "plan" },
  ])("slugs $title into $slug", async ({ title, slug }) => {
    const { store } = await freshStore();

    const plan = await store.create({ title, goal: "Goal", baseCommit, actor: "human" });

    expect(plan.id).toMatch(new RegExp(`^${slug}-[0-9a-f]{4}$`));
  });
});

describe("apply", () => {
  test("applies a batch as one revision and keeps the file canonical across a reload", async () => {
    const { store, directory } = await freshStore();
    const { id } = await draft(store);

    const operations: PlanOperation[] = [
      { op: "upsert_seam", from: logic, to: flagsFacade, action: "keep", interface: { files: [flagsApi], symbols: ["flags_for"] }, rationale: "Issues show flags" },
      { op: "upsert_module", path: logic, action: "modify", responsibility: "Show flags on issues" },
      { op: "upsert_module", path: "products/error_tracking/backend/flags", action: "create", responsibility: "Load flags for an issue" },
    ];

    const outcome = await store.apply(id, { expectedRevision: 1, actor: "agent", client: "claude-code@2.1.0", note: "First draft", operations }, base);

    expect(outcome).toMatchObject({ ok: true, warnings: [] });
    if (!outcome.ok) return;
    expect(outcome.plan.revision).toBe(2);
    expect(outcome.revision).toEqual({ number: 2, at: at(1), actor: "agent", client: "claude-code@2.1.0", kind: "edit", note: "First draft", operations });
    expect(outcome.plan.modules.map(({ path }) => path)).toEqual(["products/error_tracking/backend/flags", logic]);
    expect(outcome.plan.updatedAt).toBe(at(1));

    const bytes = await readFile(join(directory, `${id}.json`), "utf8");
    const reloaded = await openPlanStore(directory, minuteClock()).get(id);
    expect(reloaded).toEqual(outcome.plan);
    expect(bytes).toBe(`${JSON.stringify(reloaded, null, 2)}\n`);
    expect(ArchitecturePlanSchema.parse(JSON.parse(bytes))).toEqual(outcome.plan);
    expect(Object.keys(JSON.parse(bytes))).toEqual(Object.keys(ArchitecturePlanSchema.shape));
    expect(await readdir(directory)).toEqual([`${id}.json`]);
  });

  test("keeps the origin of an element when the other actor replaces it", async () => {
    const { store } = await freshStore();
    const { id } = await draft(store);
    await store.apply(id, { expectedRevision: 1, actor: "agent", operations: [{ op: "upsert_module", path: logic, action: "modify", responsibility: "Show flags" }] }, base);

    const outcome = await store.apply(
      id,
      {
        expectedRevision: 2,
        actor: "human",
        operations: [
          { op: "upsert_module", path: logic, action: "modify", responsibility: "Show flags next to the stack trace" },
          { op: "upsert_seam", from: logic, to: flagsFacade, action: "keep" },
        ],
      },
      base,
    );

    expect(outcome).toMatchObject({
      ok: true,
      plan: {
        modules: [{ path: logic, action: "modify", responsibility: "Show flags next to the stack trace", origin: "agent" }],
        seams: [{ from: logic, to: flagsFacade, action: "keep", origin: "human" }],
      },
    });
  });

  test("numbers comments per plan and records who resolved them in which revision", async () => {
    const { store } = await freshStore();
    const { id } = await draft(store);
    await store.apply(id, { expectedRevision: 1, actor: "human", operations: [{ op: "add_comment", target: { kind: "module", path: logic }, body: "Why here?" }] }, base);

    const outcome = await store.apply(
      id,
      {
        expectedRevision: 2,
        actor: "agent",
        operations: [
          { op: "resolve_comment", commentId: "c1", reply: "The issue view lives here." },
          { op: "add_comment", target: { kind: "seam", from: logic, to: flagsFacade }, body: "Only the facade." },
        ],
      },
      base,
    );

    expect(outcome.ok && outcome.plan.comments).toEqual([
      { id: "c1", target: { kind: "module", path: logic }, author: "human", body: "Why here?", at: at(1), revision: 2, resolution: { by: "agent", reply: "The issue view lives here.", at: at(2), revision: 3 } },
      { id: "c2", target: { kind: "seam", from: logic, to: flagsFacade }, author: "agent", body: "Only the facade.", at: at(2), revision: 3 },
    ]);
  });

  test("rejects an edit against an older revision and says what changed since", async () => {
    const { store } = await freshStore();
    const { id } = await draft(store);
    const human = await store.apply(
      id,
      {
        expectedRevision: 1,
        actor: "human",
        operations: [
          { op: "upsert_module", path: logic, action: "modify", responsibility: "Show flags" },
          { op: "add_comment", target: { kind: "plan" }, body: "Start from the issue view." },
        ],
      },
      base,
    );
    if (!human.ok) throw new Error(human.message);

    const outcome = await store.apply(id, { expectedRevision: 1, actor: "agent", operations: [{ op: "set_summary", goal: "Something else" }] }, base);

    expect(outcome).toEqual({
      ok: false,
      reason: "stale",
      message: "The plan is at revision 2, not 1. Revision 2 by the human: +1 module, 1 comment. Retry with expectedRevision 2 if your edits still make sense.",
      plan: human.plan,
      newerRevisions: [human.revision],
    });
  });

  test("tells the caller which plans exist when the id is unknown", async () => {
    const { store } = await freshStore();
    const edit = { expectedRevision: 1, actor: "agent" as const, operations: [] };

    expect(await store.apply("feature-flags-1234", edit, base)).toEqual({
      ok: false,
      reason: "not-found",
      message: "There is no plan in this repository yet. Call create_plan.",
    });
    const { id } = await draft(store);
    expect(await store.setLock("feature-flags-1234", { locked: true, actor: "human" })).toEqual({
      ok: false,
      reason: "not-found",
      message: `No plan \`feature-flags-1234\` in this repository. Plans here: \`${id}\`. Call get_plan without planId for the latest.`,
    });
    expect(await store.get("../../escape")).toBeUndefined();
  });
});

describe("lock", () => {
  async function lockedPlan() {
    const fixture = await freshStore();
    const { id } = await draft(fixture.store);
    const locked = await fixture.store.setLock(id, { locked: true, actor: "agent", client: "claude-code@2.1.0", note: "Looks good, lock it.", expectedRevision: 1 });
    return { ...fixture, id, locked };
  }

  test("records a lock revision with the human's words as its note", async () => {
    const { locked } = await lockedPlan();

    expect(locked).toMatchObject({
      ok: true,
      warnings: [],
      plan: { status: "locked", revision: 2, updatedAt: at(1) },
      revision: { number: 2, at: at(1), actor: "agent", client: "claude-code@2.1.0", kind: "lock", note: "Looks good, lock it.", operations: [] },
    });
  });

  test.each<PlanOperation>([
    { op: "upsert_module", path: logic, action: "modify", responsibility: "Show flags" },
    { op: "set_summary", title: "Renamed" },
    { op: "set_base_commit", commit: "c".repeat(40) },
    { op: "drop_seam", from: logic, to: flagsFacade },
  ])("refuses $op on a locked plan", async (operation) => {
    const { store, id } = await lockedPlan();

    const outcome = await store.apply(id, { expectedRevision: 2, actor: "agent", operations: [{ op: "add_comment", target: { kind: "plan" }, body: "Changing it." }, operation] }, base);

    expect(outcome).toMatchObject({
      ok: false,
      reason: "locked",
      message: `Plan ${id} is locked. Its modules and seams are what the human approved. Ask the human to unlock it in the explorer if the plan must change; comments still work.`,
      plan: { revision: 2, status: "locked" },
    });
  });

  test("still takes comments and their resolutions", async () => {
    const { store, id } = await lockedPlan();
    await store.apply(id, { expectedRevision: 2, actor: "human", operations: [{ op: "add_comment", target: { kind: "module", path: logic }, body: "Keep it thin." }] }, base);

    const outcome = await store.apply(id, { expectedRevision: 3, actor: "agent", operations: [{ op: "resolve_comment", commentId: "c1", reply: "Will do." }] }, base);

    expect(outcome).toMatchObject({ ok: true, plan: { status: "locked", revision: 4, comments: [{ id: "c1", resolution: { by: "agent", reply: "Will do." } }] } });
  });

  test("unlocking records an unlock revision and opens the plan for edits again", async () => {
    const { store, id } = await lockedPlan();

    const unlocked = await store.setLock(id, { locked: false, actor: "human", note: "Needs another seam." });
    const edited = await store.apply(id, { expectedRevision: 3, actor: "agent", operations: [{ op: "upsert_seam", from: logic, to: flagsFacade, action: "keep" }] }, base);

    expect(unlocked).toMatchObject({ ok: true, plan: { status: "draft", revision: 3 }, revision: { number: 3, actor: "human", kind: "unlock", note: "Needs another seam.", operations: [] } });
    expect(edited).toMatchObject({ ok: true, plan: { revision: 4 } });
  });

  test("refuses to lock a locked plan or unlock a draft", async () => {
    const { store, id } = await lockedPlan();
    const draftPlan = await draft(store);

    expect(await store.setLock(id, { locked: true, actor: "human" })).toMatchObject({
      ok: false,
      reason: "invalid",
      message: `Plan ${id} is already locked. Implement it and check your work with check_plan.`,
    });
    expect(await store.setLock(draftPlan.id, { locked: false, actor: "human" })).toMatchObject({
      ok: false,
      reason: "invalid",
      message: `Plan ${draftPlan.id} is a draft, so there is nothing to unlock. Change it with edit_plan.`,
    });
  });

  test("is stale when the plan moved past the expected revision", async () => {
    const { store, id } = await lockedPlan();

    expect(await store.setLock(id, { locked: false, actor: "human", expectedRevision: 1 })).toMatchObject({
      ok: false,
      reason: "stale",
      message: "The plan is at revision 2, not 1. Revision 2 by the agent: locked. Retry with expectedRevision 2 if your edits still make sense.",
      newerRevisions: [{ number: 2, kind: "lock" }],
    });
  });
});

describe("concurrency", () => {
  test("serializes applies on one plan, so the second with the same expected revision is stale", async () => {
    const { store } = await freshStore();
    const { id } = await draft(store);
    const commentAs = (actor: "agent" | "human", body: string) =>
      store.apply(id, { expectedRevision: 1, actor, operations: [{ op: "add_comment", target: { kind: "plan" }, body }] }, base);

    const [first, second] = await Promise.all([commentAs("agent", "First"), commentAs("human", "Second")]);

    expect(first).toMatchObject({ ok: true, plan: { revision: 2 } });
    expect(second).toMatchObject({ ok: false, reason: "stale", newerRevisions: [{ number: 2, actor: "agent" }] });
    expect((await store.get(id))?.comments.map(({ body }) => body)).toEqual(["First"]);
  });

  test("applies concurrent edits in call order when each expects the revision before it", async () => {
    const { store } = await freshStore();
    const { id } = await draft(store);

    const outcomes = await Promise.all(
      [1, 2, 3, 4, 5].map((expectedRevision) =>
        store.apply(id, { expectedRevision, actor: "human", operations: [{ op: "add_comment", target: { kind: "plan" }, body: `Comment ${expectedRevision}` }] }, base),
      ),
    );

    expect(outcomes.every(({ ok }) => ok)).toBe(true);
    expect((await store.get(id))?.comments.map(({ id: commentId, body }) => `${commentId} ${body}`)).toEqual(["c1 Comment 1", "c2 Comment 2", "c3 Comment 3", "c4 Comment 4", "c5 Comment 5"]);
  });
});

describe("list", () => {
  test("summarizes plans, most recently updated first, and ignores conformance results", async () => {
    const { store, directory } = await freshStore();
    const first = await draft(store);
    const second = await draft(store, "human");
    await store.apply(first.id, { expectedRevision: 1, actor: "human", operations: [{ op: "add_comment", target: { kind: "plan" }, body: "Ready?" }] }, base);
    await writeFile(join(directory, `${first.id}.conformance.json`), "{}");

    expect(await store.list()).toEqual([
      { id: first.id, title: "Feature flags on issues", baseCommit, status: "draft", revision: 2, updatedAt: at(2), pendingHumanComments: 1 },
      { id: second.id, title: "Feature flags on issues", baseCommit, status: "draft", revision: 1, updatedAt: at(1), pendingHumanComments: 0 },
    ]);
  });

  test("is empty before the first plan is written", async () => {
    expect(await (await freshStore()).store.list()).toEqual([]);
  });
});
