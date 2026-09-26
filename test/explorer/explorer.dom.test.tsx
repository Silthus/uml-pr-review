import { useHappyDom } from "./happy-dom.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, configure, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ArchitecturePayload, ArchitecturePlan, ConformanceResult, PlanComment, PlanSummary } from "../../src/architecture/contracts/index.ts";
import { ExplorerApp } from "../../src/explorer/app.tsx";
import { architectureOf } from "../support/architecture.ts";
import { FakeEventSource } from "./fake-event-source.ts";

const root = "/repo";
const at = "2026-09-26T10:15:00.000Z";
const baseCommit = "3f2a9c01d4e5b6a7980c1d2e3f4a5b6c7d8e9f00";
const logic = "products/error_tracking/backend/logic";
const facade = "products/feature_flags/backend/facade";
const models = "products/feature_flags/backend/models";

const payload = architectureOf(
  {
    "products/error_tracking/backend/logic/service.py": [
      { to: "products/feature_flags/backend/facade/api.py", line: 12, names: ["flags_for_issue"] },
      { to: "products/feature_flags/backend/models/flag.py", line: 18, names: ["FeatureFlag"] },
    ],
    "products/error_tracking/frontend/IssueFlags.tsx": [{ to: "products/error_tracking/backend/facade/api.py", line: 4 }],
    "products/feature_flags/backend/facade/api.py": [{ to: "products/feature_flags/backend/models/flag.py", line: 3 }],
    "products/feature_flags/backend/models/flag.py": [],
    "products/feature_flags/backend/tests/test_flags.py": [{ to: "products/error_tracking/backend/logic/service.py", line: 6 }],
    "posthog/settings.py": [],
  },
  { repository: { id: "/repo/.git", root, commonDir: "/repo/.git", name: "repo" } },
);

const plan: ArchitecturePlan = {
  version: 1,
  id: "flags-on-issues",
  title: "Flags on issues",
  goal: "Show feature flag usage on error tracking issues.",
  baseCommit,
  status: "draft",
  revision: 2,
  modules: [
    { path: logic, action: "modify", responsibility: "Read issue flag usage.", origin: "agent" },
    { path: "products/error_tracking/frontend", action: "modify", responsibility: "Render issue flag usage.", origin: "agent" },
  ],
  seams: [
    { from: logic, to: facade, action: "add", interface: { files: [`${facade}/api.py`, `${facade}/types.py`], symbols: ["flags_for_issue"] }, rationale: "Route through the facade.", origin: "agent" },
    { from: logic, to: models, action: "add", rationale: "Intentional violation fixture.", origin: "agent" },
  ],
  comments: [],
  revisions: [
    { number: 1, at, actor: "agent", kind: "create", operations: [] },
    { number: 2, at, actor: "agent", kind: "edit", operations: [{ op: "upsert_module", path: logic, action: "modify", responsibility: "Read issue flag usage." }] },
  ],
  createdAt: at,
  updatedAt: at,
};

const crowded = architectureOf(Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`products/product_${String(index + 1).padStart(2, "0")}/app.py`, []])), { repository: { id: "/repo/.git", root, commonDir: "/repo/.git", name: "repo" } });

const summary: PlanSummary = { id: plan.id, title: plan.title, status: plan.status, revision: plan.revision, baseCommit, updatedAt: at, pendingHumanComments: 0 };

const conformance: ConformanceResult = {
  verdict: "violating",
  modules: [{ path: logic, action: "modify", status: "pending" }],
  seams: [
    { from: logic, to: facade, action: "add", status: "conforming", imports: 1 },
    { from: logic, to: models, action: "add", status: "violating", imports: 1 },
  ],
  findings: [
    {
      id: "bypasses-seam|products/error_tracking/backend/logic/service.py|18|products/feature_flags/backend/models/flag.py",
      rule: "bypasses-seam",
      severity: "violation",
      file: "products/error_tracking/backend/logic/service.py",
      line: 18,
      subject: { kind: "seam", from: logic, to: facade },
      target: "products/feature_flags/backend/models/flag.py",
      test: false,
      message: "`products/error_tracking/backend/logic/service.py:18` imports `products/feature_flags/backend/models/flag.py` directly, but the plan routes `products/error_tracking/backend/logic` through `products/feature_flags/backend/facade`.",
      fix: "Import through products/feature_flags/backend/facade/api.py instead.",
    },
  ],
  counts: { violations: 1, pending: 1, warnings: 0 },
  planId: plan.id,
  planRevision: plan.revision,
  planStatus: "draft",
  phase: "progress",
  worktree: root,
  baseCommit,
  snapshotTree: "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d",
  checkedAt: at,
};

type FakeServer = { statusByUrl?: Map<string, number>; plans?: PlanSummary[]; architecture?: ArchitecturePayload; openPlan?: ArchitecturePlan };

function installFetch({ statusByUrl = new Map<string, number>(), plans = [summary], architecture = payload, openPlan = plan }: FakeServer = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const status = statusByUrl.get(url) ?? 200;
    if (url.startsWith("/api/architecture")) return Response.json(architecture, { status });
    if (url.startsWith("/api/plans/flags-on-issues/operations") && status === 409) return Response.json({ error: "stale revision", plan: { ...plan, revision: 3 } }, { status });
    if (url.startsWith("/api/plans/flags-on-issues/operations")) {
      const body = JSON.parse(String(init?.body)) as { operations: ArchitecturePlan["revisions"][number]["operations"] };
      const operation = body.operations[0];
      const comments = operation?.op === "add_comment" ? [{ id: "c1", target: operation.target, author: "human" as const, body: operation.body, at, revision: 3 }] : [];
      return Response.json({ plan: { ...plan, revision: 3, comments }, warnings: [] });
    }
    if (url.startsWith("/api/plans/flags-on-issues/check")) return Response.json(conformance, { status });
    if (url.startsWith("/api/plans/flags-on-issues/lock")) return Response.json({ plan: { ...plan, status: "locked", revision: 3 } }, { status });
    if (url.startsWith("/api/plans/flags-on-issues")) return Response.json({ plan: openPlan, conformance: null }, { status });
    if (url.startsWith("/api/plans")) return Response.json(plans, { status });
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;
  return calls;
}

function renderExplorer(search = `?path=${encodeURIComponent(root)}&plan=flags-on-issues`) {
  history.replaceState(null, "", search);
  return render(<ExplorerApp />);
}

function planPanel(view: ReturnType<typeof render>) {
  return within(view.getByRole("region", { name: "Architecture plan" }));
}

function seamRow(view: ReturnType<typeof render>, from: string, to: string): HTMLElement {
  const row = planPanel(view).getAllByRole("listitem").find((item) => item.textContent?.includes(`${from} → ${to}`));
  if (!row) throw new Error(`No seam row ${from} → ${to}`);
  return within(row).getByRole("button");
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

useHappyDom();
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  document.body.innerHTML = "";
  FakeEventSource.install();
  localStorage.clear();
});

afterEach(cleanup);

describe("ExplorerApp", () => {
  test("loads the architecture over REST and opens packages in place", async () => {
    installFetch({ plans: [] });

    const view = renderExplorer(`?path=${encodeURIComponent(root)}`);

    expect(await view.findByRole("heading", { name: "repo" })).toBeTruthy();
    expect(view.getByRole("link", { name: "Pull requests" }).getAttribute("href")).toBe(`/pulls?path=${encodeURIComponent(root)}`);
    expect(await view.findByRole("button", { name: "products package" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "products/error_tracking package" })).toBeNull();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "expand products" }));
    });

    expect(await view.findByRole("button", { name: "products/error_tracking package" })).toBeTruthy();
    expect(view.getByRole("button", { name: "collapse products" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "products/feature_flags/backend/tests package" })).toBeNull();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "expand products/feature_flags" }));
    });
    const expandBackend = await view.findByRole("button", { name: "expand products/feature_flags/backend" });
    await act(async () => {
      fireEvent.click(expandBackend);
    });
    await act(async () => {
      fireEvent.click(view.getByRole("switch", { name: "Show tests" }));
    });

    expect(await view.findByRole("button", { name: "products/feature_flags/backend/tests package" })).toBeTruthy();
  });

  test("selecting a package lists its evidence, and Focus connections opens the lens until Escape", async () => {
    installFetch();

    const view = renderExplorer();
    const logicTab = await view.findByRole("button", { name: `${logic} package` });
    await act(async () => {
      fireEvent.click(logicTab);
    });
    await settle();

    expect(view.getByRole("heading", { name: "logic" })).toBeTruthy();
    const dependsOn = view.getByRole("region", { name: "Depends on" });
    expect(within(dependsOn).getByRole("button", { name: "products/feature_flags" })).toBeTruthy();
    expect(within(dependsOn).getByTitle("products/error_tracking/backend/logic/service.py:12 imports products/feature_flags/backend/facade/api.py")).toBeTruthy();
    expect(within(dependsOn).getByTitle("products/error_tracking/backend/logic/service.py:18 imports products/feature_flags/backend/models/flag.py")).toBeTruthy();
    const dependedOnBy = view.getByRole("region", { name: "Depended on by" });
    expect(within(dependedOnBy).getByText("None outside tests.")).toBeTruthy();
    const facadeTab = view.getByRole("button", { name: `${facade} package` });
    await waitFor(() => expect(facadeTab.closest(".package")?.className).toContain("tone-outgoing"));

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Focus connections" }));
    });

    expect(await view.findByText(/Connections of/)).toBeTruthy();
    expect(await view.findByRole("button", { name: "products/feature_flags package" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "posthog package" })).toBeNull();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(view.queryByText(/Connections of/)).toBeNull();
    expect(await view.findByText(/Plan focus/)).toBeTruthy();
    await settle();
  });

  test("follow agent moves the selection on selection hints and stays put when switched off", async () => {
    installFetch();

    const view = renderExplorer();
    await view.findByRole("heading", { name: "repo" });
    await settle();

    await act(async () => {
      FakeEventSource.instances[0]?.emit({ seq: 3, at, repositoryId: "/repo/.git", type: "selection_hint", client: "claude", tool: "describe_module", target: { kind: "module", path: facade }, planId: plan.id });
    });

    expect(await view.findByRole("heading", { name: "facade" })).toBeTruthy();
    expect(view.getByText(`claude is looking at ${facade}`)).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByRole("switch", { name: "Follow agent" }));
    });
    await act(async () => {
      FakeEventSource.instances[0]?.emit({ seq: 4, at, repositoryId: "/repo/.git", type: "selection_hint", client: "claude", tool: "describe_module", target: { kind: "module", path: models }, planId: plan.id });
    });

    expect(view.getByRole("heading", { name: "facade" })).toBeTruthy();
  });

  test("a plan patch from the agent replaces the plan and reveals its new module", async () => {
    installFetch();

    const view = renderExplorer();
    await view.findByRole("heading", { name: "repo" });
    await settle();
    const patched: ArchitecturePlan = { ...plan, revision: 3, modules: [...plan.modules, { path: facade, action: "modify", responsibility: "Expose flags per issue.", origin: "agent" }] };

    await act(async () => {
      FakeEventSource.instances[0]?.emit({ seq: 5, at, repositoryId: "/repo/.git", type: "plan_patch", planId: plan.id, revision: { number: 3, at, actor: "agent", client: "claude", kind: "edit", operations: [{ op: "upsert_module", path: facade, action: "modify", responsibility: "Expose flags per issue." }] }, plan: patched });
    });
    await settle();

    expect(view.getByText("Architecture plan · revision 3")).toBeTruthy();
    expect(view.getByText(`agent revision 3: modify ${facade}`)).toBeTruthy();
    expect((await view.findByRole("button", { name: `${facade} package` })).closest(".package")?.className).toContain("fresh");
  });

  test("comments post plan operations and a stale revision is explained after the plan is reloaded", async () => {
    const operationsUrl = `/api/plans/flags-on-issues/operations?path=${encodeURIComponent(root)}`;
    const calls = installFetch({ statusByUrl: new Map([[operationsUrl, 409]]) });

    const view = renderExplorer();
    const logicTab = await view.findByRole("button", { name: `${logic} package` });
    await act(async () => {
      fireEvent.click(logicTab);
    });
    await settle();
    await act(async () => {
      fireEvent.input(view.getByRole("textbox", { name: "Comment on logic" }), { target: { value: "Please keep this behind the facade." } });
    });
    await act(async () => {
      fireEvent.submit(view.getByRole("form", { name: "New comment on logic" }));
    });

    await waitFor(() => expect(calls.some((call) => call.url === operationsUrl)).toBe(true));
    expect(JSON.parse(String(calls.find((call) => call.url === operationsUrl)?.init?.body))).toEqual({
      expectedRevision: 2,
      operations: [{ op: "add_comment", target: { kind: "module", path: logic }, body: "Please keep this behind the facade." }],
      note: "Comment from the explorer",
    });
    expect((await view.findByRole("alert")).textContent).toContain("plan is now at revision 3");
    expect(view.getByText("Architecture plan · revision 3")).toBeTruthy();
  });

  test("hand edits and the lock go through the plan operations contract", async () => {
    const calls = installFetch();

    const view = renderExplorer();
    const facadeTab = await view.findByRole("button", { name: `${facade} package` });
    await act(async () => {
      fireEvent.click(facadeTab);
    });
    await settle();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Add to plan" }));
    });
    await act(async () => {
      fireEvent.input(view.getByRole("textbox", { name: "Responsibility" }), { target: { value: "Expose flags per issue." } });
    });
    await act(async () => {
      fireEvent.submit(view.getByRole("form", { name: "Planned module" }));
    });

    await waitFor(() => expect(calls.some((call) => call.url.includes("/operations"))).toBe(true));
    expect(JSON.parse(String(calls.find((call) => call.url.includes("/operations"))?.init?.body)).operations).toEqual([{ op: "upsert_module", path: facade, action: "modify", responsibility: "Expose flags per issue." }]);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Lock plan" }));
    });

    await waitFor(() => expect(calls.some((call) => call.url.includes("/lock"))).toBe(true));
    expect(JSON.parse(String(calls.find((call) => call.url.includes("/lock"))?.init?.body))).toEqual({ locked: true, expectedRevision: 3 });
    expect(await view.findByRole("button", { name: "Unlock" })).toBeTruthy();
  });

  test("a check paints conformance on the plan and lists findings at file:line", async () => {
    installFetch();

    const view = renderExplorer();
    await view.findByRole("heading", { name: "repo" });
    await settle();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Check" }));
    });
    await settle();

    const planPanel = view.getByRole("region", { name: "Architecture plan" });
    expect(within(planPanel).getByText(/violating · progress/)).toBeTruthy();
    expect(within(planPanel).getByText("Import through products/feature_flags/backend/facade/api.py instead.")).toBeTruthy();
    expect(within(planPanel).getByTitle("products/error_tracking/backend/logic/service.py:18")).toBeTruthy();
    const violatingSeam = within(planPanel).getAllByTitle(models).map((path) => path.closest("li")).find((row) => row?.textContent?.includes("violating"));
    expect(violatingSeam?.textContent).toContain(`${logic} → ${models}`);
    expect(within(planPanel).getAllByTitle(facade).some((path) => path.closest("li")?.textContent?.includes("conforming"))).toBe(true);
  });

  test("the plan panel reads as the plan's breakdown: responsibilities, seam interfaces, and rationale", async () => {
    installFetch();

    const view = renderExplorer();
    await view.findByRole("heading", { name: "repo" });
    await settle();

    const moduleRow = planPanel(view).getByRole("listitem", { name: `modify ${logic}` });
    expect(moduleRow.textContent).toContain("Read issue flag usage.");
    const seamRow = planPanel(view).getByRole("listitem", { name: `add ${logic} → ${facade}` });
    const via = within(seamRow).getByText(/^via/);
    expect(via.textContent).toBe("via api.py, types.py (flags_for_issue)");
    expect(within(via).getByTitle(`${facade}/api.py`)).toBeTruthy();
    expect(within(seamRow).getByText("Route through the facade.")).toBeTruthy();
    expect(within(planPanel(view).getByRole("listitem", { name: `add ${logic} → ${models}` })).queryByText(/^via/)).toBeNull();

    await act(async () => {
      fireEvent.click(within(seamRow).getByRole("button"));
    });
    expect(view.getByText("add seam")).toBeTruthy();
  });

  test("show all reveals the children folded behind the more cell", async () => {
    installFetch({ plans: [], architecture: crowded });

    const view = renderExplorer(`?path=${encodeURIComponent(root)}&expanded=products`);
    const showAll = await view.findByRole("button", { name: "show all modules in products" });

    expect(view.getAllByRole("button", { name: /^products\/product_\d+ package$/ })).toHaveLength(12);

    await act(async () => {
      fireEvent.click(showAll);
    });

    expect(await view.findByRole("button", { name: "products/product_14 package" })).toBeTruthy();
    expect(view.getAllByRole("button", { name: /^products\/product_\d+ package$/ })).toHaveLength(14);
    expect(view.queryByRole("button", { name: "show all modules in products" })).toBeNull();
  });

  test("a seam's interface lists one file per line", async () => {
    installFetch();

    const view = renderExplorer();
    await view.findByRole("heading", { name: "repo" });
    await settle();
    await act(async () => {
      fireEvent.click(seamRow(view, logic, facade));
    });

    const files = within(view.getByRole("list", { name: "Interface files" })).getAllByRole("listitem");
    expect(files.map((file) => file.textContent)).toEqual([`${facade}/api.py`, `${facade}/types.py`]);
  });

  test("a finding renders its code spans as code", async () => {
    installFetch();

    const view = renderExplorer();
    await view.findByRole("heading", { name: "repo" });
    await settle();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Check" }));
    });
    await settle();

    const finding = planPanel(view).getByRole("listitem", { name: /^bypasses-seam/ });
    expect(within(finding).getAllByRole("code").map((code) => code.textContent)).toEqual([
      "products/error_tracking/backend/logic/service.py:18",
      "products/feature_flags/backend/models/flag.py",
      logic,
      facade,
    ]);
  });

  test("a plan the agent creates while no plan is open shows in the picker and the URL", async () => {
    installFetch({ plans: [] });

    const view = renderExplorer(`?path=${encodeURIComponent(root)}`);
    await view.findByRole("heading", { name: "repo" });
    await settle();
    const created: ArchitecturePlan = { ...plan, revision: 1, revisions: [plan.revisions[0]!] };

    await act(async () => {
      FakeEventSource.instances[0]?.emit({ seq: 2, at, repositoryId: "/repo/.git", type: "plan_patch", planId: plan.id, revision: created.revisions[0]!, plan: created });
    });
    await settle();

    const picker = view.getByRole("combobox", { name: "Plan" }) as HTMLSelectElement;
    expect(picker.value).toBe(plan.id);
    expect(picker.selectedOptions[0]?.textContent).toBe(plan.title);
    expect(new URLSearchParams(location.search).get("plan")).toBe(plan.id);
  });

  test("a comment on a dependency that was never planned is listed as unplanned, not dropped", async () => {
    const comment: PlanComment = { id: "c1", target: { kind: "seam", from: "products/error_tracking/frontend", to: "products/error_tracking/backend/facade" }, author: "human", body: "Keep this one as it is.", at, revision: 3 };
    installFetch({ openPlan: { ...plan, revision: 3, comments: [comment] } });

    const view = renderExplorer();
    await view.findByRole("heading", { name: "repo" });
    await settle();

    const thread = planPanel(view).getByRole("region", { name: "Comments on unplanned seam products/error_tracking/frontend → products/error_tracking/backend/facade" });
    expect(within(thread).getByText("unplanned seam")).toBeTruthy();
    expect(within(thread).getByText(comment.body)).toBeTruthy();
  });

  test("a comment on a seam the plan drops stays visible with its original target and the reply", async () => {
    const comment: PlanComment = { id: "c1", target: { kind: "seam", from: logic, to: models }, author: "human", body: "Route this through the facade instead of the models.", at, revision: 3 };
    installFetch({ openPlan: { ...plan, revision: 3, comments: [comment] } });

    const view = renderExplorer();
    await view.findByRole("heading", { name: "repo" });
    await settle();
    const reply = "Done. The models seam is gone; logic reads flags through the facade.";
    const dropping: ArchitecturePlan["revisions"][number] = { number: 4, at, actor: "agent", client: "claude", kind: "edit", operations: [{ op: "drop_seam", from: logic, to: models }, { op: "resolve_comment", commentId: "c1", reply }] };
    const dropped: ArchitecturePlan = { ...plan, revision: 4, seams: plan.seams.filter((seam) => seam.to !== models), comments: [{ ...comment, resolution: { by: "agent", reply, at, revision: 4 } }], revisions: [...plan.revisions, dropping] };

    await act(async () => {
      FakeEventSource.instances[0]?.emit({ seq: 4, at, repositoryId: "/repo/.git", type: "plan_patch", planId: plan.id, revision: dropping, plan: dropped });
    });
    await settle();

    expect(planPanel(view).queryAllByRole("listitem").some((item) => item.textContent?.includes(`${logic} → ${models}`) && item.textContent.includes("add"))).toBe(false);
    const thread = planPanel(view).getByRole("region", { name: `Comments on dropped seam ${logic} → ${models}` });
    expect(within(thread).getByText(comment.body)).toBeTruthy();
    expect(within(thread).getByText(reply)).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(thread).getByRole("button", { name: `Show seam ${logic} → ${models}` }));
    });

    const inspectorThread = view.getByRole("region", { name: `seam ${logic} → ${models}` });
    expect(within(inspectorThread).getByText(reply)).toBeTruthy();
  });
});
