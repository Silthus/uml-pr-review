import { describe, expect, test } from "bun:test";
import type { PlanOperation } from "../../../src/architecture/contracts/index.ts";
import { ArchitectureModel } from "../../../src/architecture/model/index.ts";
import { commitToValidate } from "../../../src/architecture/plan/index.ts";
import { architectureOf } from "../../support/architecture.ts";
import { base, base7, baseCommit, draft, errorTrackingModels, flags, flagsApi, flagsFacade, flagsModels, freshStore, logic } from "./store-fixture.ts";

const backend = "products/error_tracking/backend";
const flagsLoader = `${backend}/flags`;
const typoedFacade = "products/feature_flags/facade";
const nothingApplied = "Nothing was applied. Fix these problems and send the whole batch again with expectedRevision 1.";

async function edit(operations: PlanOperation[], model = base) {
  const { store } = await freshStore();
  const before = await draft(store);
  const outcome = await store.apply(before.id, { expectedRevision: 1, actor: "agent", operations }, model);
  return { outcome, before, stored: await store.get(before.id) };
}

async function editAfter(setup: PlanOperation[], operations: PlanOperation[], model = base) {
  const { store } = await freshStore();
  const { id } = await draft(store);
  const prepared = await store.apply(id, { expectedRevision: 1, actor: "agent", operations: setup }, base);
  if (!prepared.ok) throw new Error(prepared.message);
  const outcome = await store.apply(id, { expectedRevision: 2, actor: "agent", operations }, model);
  expect(await store.get(id)).toEqual(outcome.ok ? outcome.plan : prepared.plan);
  return outcome;
}

async function rejectionOf(operations: PlanOperation[]) {
  const { outcome, before, stored } = await edit(operations);
  expect(stored).toEqual(before);
  if (outcome.ok) throw new Error("expected the batch to be rejected");
  expect(outcome.reason).toBe("invalid");
  return outcome.message;
}

async function warningsOf(operations: PlanOperation[]) {
  const { outcome } = await edit(operations);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.warnings;
}

describe("planned modules", () => {
  test.each(["modify", "remove"] as const)("rejects %s of a path that is not a module at base and suggests close modules", async (action) => {
    expect(await rejectionOf([{ op: "upsert_module", path: typoedFacade, action, responsibility: "Serve flags" }])).toBe(
      [
        `Operation 1 (upsert_module): No module \`${typoedFacade}\` at base commit ${base7}. Did you mean \`${flagsFacade}\`, \`${flags}\`, or \`${flags}/backend\`? Use search_modules to find module paths.`,
        nothingApplied,
      ].join("\n"),
    );
  });

  test("points to search_modules when nothing comes close", async () => {
    expect(await rejectionOf([{ op: "upsert_module", path: "billing/invoices", action: "modify", responsibility: "Bill" }])).toBe(
      [`Operation 1 (upsert_module): No module \`billing/invoices\` at base commit ${base7}. Use search_modules to find module paths.`, nothingApplied].join("\n"),
    );
  });

  test("offers two close modules as alternatives", async () => {
    expect(await rejectionOf([{ op: "upsert_module", path: "posthog/modelz", action: "modify", responsibility: "Teams" }])).toBe(
      [
        `Operation 1 (upsert_module): No module \`posthog/modelz\` at base commit ${base7}. Did you mean \`posthog\` or \`posthog/models\`? Use search_modules to find module paths.`,
        nothingApplied,
      ].join("\n"),
    );
  });

  test("refuses to remove the repository root or to create a module where a file is", async () => {
    expect(
      await rejectionOf([
        { op: "upsert_module", path: ".", action: "remove", responsibility: "Start over" },
        { op: "upsert_module", path: `${logic}/issues.py`, action: "create", responsibility: "Issues" },
      ]),
    ).toBe(
      [
        "Operation 1 (upsert_module): The repository root `.` cannot be removed; plan the modules inside it as removed instead.",
        `Operation 2 (upsert_module): \`${logic}/issues.py\` is a file at ${base7}, not a module; plan the module that holds it as modify.`,
        nothingApplied,
      ].join("\n"),
    );
  });

  test("rejects create of a module that already exists at base", async () => {
    expect(await rejectionOf([{ op: "upsert_module", path: logic, action: "create", responsibility: "Show flags" }])).toBe(
      [`Operation 1 (upsert_module): \`${logic}\` already exists at ${base7}; plan it as modify.`, nothingApplied].join("\n"),
    );
  });
});

describe("seams", () => {
  test("rejects an endpoint that is neither a module at base nor within a planned created module", async () => {
    expect(await rejectionOf([{ op: "upsert_seam", from: logic, to: typoedFacade, action: "add" }])).toBe(
      [
        `Operation 1 (upsert_seam): No module \`${typoedFacade}\` at base commit ${base7}. Did you mean \`${flagsFacade}\`, \`${flags}\`, or \`${flags}/backend\`? Use search_modules to find module paths.`,
        nothingApplied,
      ].join("\n"),
    );
  });

  test("accepts an endpoint within a module the batch creates, in any order", async () => {
    const createLoader: PlanOperation = { op: "upsert_module", path: flagsLoader, action: "create", responsibility: "Load flags for an issue" };
    const seamFromLoader: PlanOperation = { op: "upsert_seam", from: `${flagsLoader}/queries`, to: flagsFacade, action: "add" };

    expect(await warningsOf([createLoader, seamFromLoader])).toEqual([]);
    expect(await warningsOf([seamFromLoader, createLoader])).toEqual([]);
  });

  test.each([
    { from: logic, to: backend, outer: backend, inner: logic },
    { from: backend, to: logic, outer: backend, inner: logic },
    { from: logic, to: logic, outer: logic, inner: logic },
    { from: ".", to: flagsFacade, outer: ".", inner: flagsFacade },
  ])("rejects a seam from $from to $to because one contains the other", async ({ from, to, outer, inner }) => {
    expect(await rejectionOf([{ op: "upsert_seam", from, to, action: "add" }])).toBe(
      [`Operation 1 (upsert_seam): A seam connects two separate modules; \`${outer}\` contains \`${inner}\`.`, nothingApplied].join("\n"),
    );
  });

  test("rejects an interface file outside the seam's target", async () => {
    const outside = `${flagsModels}/feature_flag.py`;
    expect(await rejectionOf([{ op: "upsert_seam", from: logic, to: flagsFacade, action: "add", interface: { files: [flagsApi, outside], symbols: [] } }])).toBe(
      [`Operation 1 (upsert_seam): Interface file \`${outside}\` is not within \`${flagsFacade}\`.`, nothingApplied].join("\n"),
    );
  });

  test("warns about an interface file the implementation still has to create", async () => {
    const planned = `${flagsFacade}/issues.py`;
    expect(await warningsOf([{ op: "upsert_seam", from: logic, to: flagsFacade, action: "add", interface: { files: [flagsApi, planned], symbols: [] } }])).toEqual([
      `Interface file \`${planned}\` does not exist at ${base7} yet; the implementation must create it.`,
    ]);
  });

  test.each(["remove", "keep"] as const)("warns when a %s seam has no production import at base", async (action) => {
    expect(await warningsOf([
      { op: "upsert_seam", from: logic, to: "posthog/models", action },
      { op: "upsert_seam", from: logic, to: flagsModels, action },
      { op: "upsert_seam", from: logic, to: flagsFacade, action },
    ])).toEqual([
      `No file in \`${logic}\` imports \`posthog/models\` at ${base7}; a ${action} seam expects an existing dependency.`,
      `No file in \`${logic}\` imports \`${flagsModels}\` at ${base7}; a ${action} seam expects an existing dependency.`,
    ]);
  });
});

describe("dropping and resolving", () => {
  test("names the missing module or seam and lists what the plan has", async () => {
    const { store } = await freshStore();
    const { id } = await draft(store);
    await store.apply(
      id,
      {
        expectedRevision: 1,
        actor: "agent",
        operations: [
          { op: "upsert_module", path: logic, action: "modify", responsibility: "Show flags" },
          { op: "upsert_seam", from: logic, to: flagsFacade, action: "keep" },
        ],
      },
      base,
    );

    const outcome = await store.apply(
      id,
      {
        expectedRevision: 2,
        actor: "agent",
        operations: [
          { op: "drop_module", path: errorTrackingModels },
          { op: "drop_seam", from: logic, to: flagsModels },
        ],
      },
      base,
    );

    expect(outcome).toMatchObject({
      ok: false,
      reason: "invalid",
      message: [
        `Operation 1 (drop_module): The plan has no module \`${errorTrackingModels}\` to drop. Its modules are \`${logic}\`.`,
        `Operation 2 (drop_seam): The plan has no seam \`${logic} -> ${flagsModels}\` to drop. Its seams are \`${logic} -> ${flagsFacade}\`.`,
        "Nothing was applied. Fix these problems and send the whole batch again with expectedRevision 2.",
      ].join("\n"),
    });
  });

  test("says so when the plan has nothing to drop", async () => {
    expect(await rejectionOf([{ op: "drop_module", path: logic }, { op: "drop_seam", from: logic, to: flagsFacade }])).toBe(
      [
        `Operation 1 (drop_module): The plan has no module \`${logic}\` to drop. It has no modules yet.`,
        `Operation 2 (drop_seam): The plan has no seam \`${logic} -> ${flagsFacade}\` to drop. It has no seams yet.`,
        nothingApplied,
      ].join("\n"),
    );
  });

  test("rejects resolving an unknown or already resolved comment and lists the open ones", async () => {
    expect(
      await rejectionOf([
        { op: "add_comment", target: { kind: "plan" }, body: "Why a new module?" },
        { op: "add_comment", target: { kind: "module", path: logic }, body: "Keep this thin." },
        { op: "resolve_comment", commentId: "c1", reply: "It isolates the loading." },
        { op: "resolve_comment", commentId: "c1" },
        { op: "resolve_comment", commentId: "c7" },
      ]),
    ).toBe(
      [
        "Operation 4 (resolve_comment): Comment `c1` is already resolved. Open comments: `c2`.",
        "Operation 5 (resolve_comment): The plan has no comment `c7`. Open comments: `c2`.",
        nothingApplied,
      ].join("\n"),
    );
  });
});

describe("base commit", () => {
  const nextCommit = "c".repeat(40);

  test("moves the plan to a commit when validated against that commit's architecture", async () => {
    const next = new ArchitectureModel(architectureOf({ [flagsApi]: [], [`${logic}/issues.py`]: [flagsApi] }, { commit: nextCommit }));
    const keepSeam: PlanOperation = { op: "upsert_seam", from: logic, to: flagsFacade, action: "keep" };
    const operations: PlanOperation[] = [{ op: "set_base_commit", commit: nextCommit }, keepSeam];

    const { outcome, before } = await edit(operations, next);

    expect(commitToValidate(before, operations)).toBe(nextCommit);
    expect(commitToValidate(before, [keepSeam])).toBe(baseCommit);
    expect(outcome).toMatchObject({ ok: true, warnings: [], plan: { baseCommit: nextCommit } });
  });

  test("rejects a commit whose architecture could not be given", async () => {
    expect(await rejectionOf([{ op: "set_summary", title: "Flags" }, { op: "set_base_commit", commit: nextCommit }])).toBe(
      [
        "Operation 2 (set_base_commit): Commit `ccccccc` does not exist in this repository. Pass the full 40-character SHA of an existing commit, for example the output of git rev-parse HEAD.",
        nothingApplied,
      ].join("\n"),
    );
  });

  test("refuses to validate against the architecture of another commit", async () => {
    const other = new ArchitectureModel(architectureOf({ [flagsApi]: [] }, { commit: nextCommit }));

    await expect(edit([{ op: "set_summary", title: "Flags" }], other)).rejects.toThrow(`apply validates against the architecture of ${baseCommit}, but got the architecture of ${nextCommit}.`);
  });
});

describe("the plan after the batch", () => {
  const createLoader: PlanOperation = { op: "upsert_module", path: flagsLoader, action: "create", responsibility: "Load flags for an issue" };
  const seamFromLoader: PlanOperation = { op: "upsert_seam", from: flagsLoader, to: flagsFacade, action: "add" };

  test("rejects dropping a created module that a seam still needs", async () => {
    const outcome = await editAfter([createLoader, seamFromLoader], [{ op: "drop_module", path: flagsLoader }]);

    expect(outcome).toMatchObject({
      ok: false,
      reason: "invalid",
      message: [
        `Seam \`${flagsLoader} -> ${flagsFacade}\`: \`${flagsLoader}\` is no longer a module the plan creates. Drop the seam in the same batch, or keep the module.`,
        "Nothing was applied. Fix these problems and send the whole batch again with expectedRevision 2.",
      ].join("\n"),
    });
  });

  test("rejects a seam to a module that the same batch creates and then drops", async () => {
    expect(await rejectionOf([createLoader, seamFromLoader, { op: "drop_module", path: flagsLoader }])).toBe(
      [
        `Operation 2 (upsert_seam): \`${flagsLoader}\` is no longer a module the plan creates. Drop the seam in the same batch, or keep the module.`,
        nothingApplied,
      ].join("\n"),
    );
  });

  test("accepts dropping a created module together with its seams", async () => {
    const outcome = await editAfter([createLoader, seamFromLoader], [{ op: "drop_module", path: flagsLoader }, { op: "drop_seam", from: flagsLoader, to: flagsFacade }]);

    expect(outcome).toMatchObject({ ok: true, plan: { modules: [], seams: [] } });
  });

  test("checks every module and seam again against a new base commit", async () => {
    const nextCommit = "c".repeat(40);
    const next = new ArchitectureModel(architectureOf({ [`${flagsFacade}/queries.py`]: [], "posthog/models/team.py": [`${flagsFacade}/queries.py`] }, { commit: nextCommit }));

    const outcome = await editAfter(
      [
        { op: "upsert_module", path: logic, action: "modify", responsibility: "Show flags" },
        { op: "upsert_seam", from: "posthog/models", to: flagsFacade, action: "keep", interface: { files: [`${flagsFacade}/queries.py`], symbols: [] } },
        { op: "upsert_seam", from: logic, to: flagsFacade, action: "keep" },
      ],
      [{ op: "set_base_commit", commit: nextCommit }],
      next,
    );

    expect(outcome).toMatchObject({
      ok: false,
      reason: "invalid",
      message: [
        `Module \`${logic}\`: No module \`${logic}\` at base commit ccccccc. Did you mean \`products\`, \`products/feature_flags\`, or \`products/feature_flags/backend\`? Use search_modules to find module paths.`,
        `Seam \`${logic} -> ${flagsFacade}\`: No module \`${logic}\` at base commit ccccccc. Did you mean \`products\`, \`products/feature_flags\`, or \`products/feature_flags/backend\`? Use search_modules to find module paths.`,
        "Nothing was applied. Fix these problems and send the whole batch again with expectedRevision 2.",
      ].join("\n"),
    });
  });

  test("warns about the plan's seams again after a base commit change, and only about seams that survive the batch", async () => {
    const nextCommit = "c".repeat(40);
    const next = new ArchitectureModel(architectureOf({ [`${logic}/issues.py`]: [], [flagsApi]: [] }, { commit: nextCommit }));

    const outcome = await editAfter(
      [{ op: "upsert_seam", from: logic, to: flagsFacade, action: "keep", interface: { files: [flagsApi], symbols: [] } }],
      [
        { op: "set_base_commit", commit: nextCommit },
        { op: "upsert_seam", from: logic, to: "posthog/models", action: "remove" },
        { op: "drop_seam", from: logic, to: "posthog/models" },
      ],
      next,
    );

    expect(outcome).toMatchObject({
      ok: true,
      warnings: [`No file in \`${logic}\` imports \`${flagsFacade}\` at ccccccc; a keep seam expects an existing dependency.`],
    });
  });
});

test("rejects the whole batch when any operation fails", async () => {
  expect(
    await rejectionOf([
      { op: "set_summary", title: "Flags on issues" },
      { op: "upsert_module", path: logic, action: "modify", responsibility: "Show flags" },
      { op: "upsert_module", path: flagsFacade, action: "create", responsibility: "Serve flags" },
      { op: "add_comment", target: { kind: "plan" }, body: "Draft" },
    ]),
  ).toBe([`Operation 3 (upsert_module): \`${flagsFacade}\` already exists at ${base7}; plan it as modify.`, nothingApplied].join("\n"));
});
