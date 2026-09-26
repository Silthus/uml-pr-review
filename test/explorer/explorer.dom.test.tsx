import "./happy-dom.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ArchitectureEvent, ArchitecturePlan, ConformanceResult, PlanSummary } from "../../src/architecture/contracts/index.ts";
import { architectureOf } from "../support/architecture.ts";
import { ExplorerApp } from "../../src/explorer/main.tsx";

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
    { from: logic, to: facade, action: "add", interface: { files: [`${facade}/api.py`], symbols: ["flags_for_issue"] }, rationale: "Route through the facade.", origin: "agent" },
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
      message: "products/error_tracking/backend/logic bypasses the planned seam to products/feature_flags/backend/facade.",
      fix: "Import through products/feature_flags/backend/facade/api.py instead.",
    },
  ],
  counts: { violations: 1, pending: 1, warnings: 0 },
  planId: plan.id,
  planRevision: plan.revision,
  planStatus: "locked",
  phase: "progress",
  worktree: root,
  baseCommit,
  snapshotTree: "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d",
  checkedAt: at,
};

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closeCalled = false;

  constructor(url: string) {
    super();
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closeCalled = true;
  }

  emit(event: ArchitectureEvent) {
    this.dispatchEvent(new MessageEvent(event.type, { data: JSON.stringify(event) }));
  }
}

function installFetch(statusByUrl = new Map<string, number>()) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const status = statusByUrl.get(url) ?? 200;
    if (url.startsWith("/api/architecture")) return Response.json(payload, { status });
    if (url.startsWith("/api/plans/flags-on-issues/operations") && status === 409) return Response.json({ error: "stale revision", plan: { ...plan, revision: 3 } }, { status });
    if (url.startsWith("/api/plans/flags-on-issues/operations")) return Response.json({ plan: { ...plan, revision: 3, comments: [{ id: "c1", target: { kind: "module", path: logic }, author: "human", body: "Please keep this behind the facade.", at, revision: 3 }] }, warnings: [] });
    if (url.startsWith("/api/plans/flags-on-issues/check")) return Response.json(conformance, { status });
    if (url.startsWith("/api/plans/flags-on-issues/lock")) return Response.json({ plan: { ...plan, status: "locked", revision: 3 } }, { status });
    if (url.startsWith("/api/plans/flags-on-issues")) return Response.json({ plan, conformance: null }, { status });
    if (url.startsWith("/api/plans")) return Response.json([summary], { status });
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;
  return calls;
}

function renderExplorer(search = `?path=${encodeURIComponent(root)}&plan=flags-on-issues`) {
  history.replaceState(null, "", search);
  return render(<ExplorerApp />);
}

async function waitForLayout() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  localStorage.clear();
});

describe("ExplorerApp", () => {
  test("loads the architecture through the REST contract and expands nested UML packages", async () => {
    installFetch();

    const view = renderExplorer();

    expect(await view.findByRole("heading", { name: "repo" })).toBeTruthy();
    await waitForLayout();
    expect(view.getByRole("link", { name: "Pull requests" }).getAttribute("href")).toBe(`/pulls?path=${encodeURIComponent(root)}`);
    expect(await view.findByRole("button", { name: /products package/i })).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "expand products" }));
    });

    expect(await view.findByRole("button", { name: /error_tracking package/i })).toBeTruthy();
    expect(view.getAllByText("«directory»").length).toBeGreaterThan(0);
    expect(view.getByText("Tests hidden")).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByRole("switch", { name: "Show tests" }));
    });

    expect(view.getByText("Tests visible")).toBeTruthy();
    expect(await view.findByRole("button", { name: /tests package/i })).toBeTruthy();
  });

  test("selection highlights incoming and outgoing dependencies with file-line evidence", async () => {
    installFetch();

    const view = renderExplorer();
    const logicPackage = await view.findByRole("button", { name: /logic package/i });
    await act(async () => {
      fireEvent.click(logicPackage);
    });
    await waitForLayout();

    expect(view.getByRole("heading", { name: logic })).toBeTruthy();
    const outgoing = view.getByRole("region", { name: "Depends on" });
    expect(within(outgoing).getByRole("button", { name: /products\/feature_flags\/backend\/facade/i })).toBeTruthy();
    expect(within(outgoing).getByText("products/error_tracking/backend/logic/service.py:12 → products/feature_flags/backend/facade/api.py")).toBeTruthy();
    expect(view.getAllByText("outgoing").length).toBeGreaterThan(0);
  });

  test("follow agent reacts to selection hints from SSE", async () => {
    installFetch();

    const view = renderExplorer();
    await view.findByRole("heading", { name: "repo" });
    await waitForLayout();
    await act(async () => {
      fireEvent.click(view.getByRole("switch", { name: "Follow agent" }));
    });

    await act(async () => {
      FakeEventSource.instances[0]?.emit({ seq: 3, at, repositoryId: "/repo/.git", type: "selection_hint", client: "claude", tool: "describe_module", target: { kind: "module", path: facade }, planId: plan.id });
    });

    expect(await view.findByRole("heading", { name: facade })).toBeTruthy();
    expect(view.getByText("claude focused products/feature_flags/backend/facade")).toBeTruthy();
  });

  test("comments post plan operations and refetch after a stale revision", async () => {
    const staleUrl = `/api/plans/flags-on-issues/operations?path=${encodeURIComponent(root)}`;
    const calls = installFetch(new Map([[staleUrl, 409]]));

    const view = renderExplorer();
    const logicPackage = await view.findByRole("button", { name: /logic package/i });
    await act(async () => {
      fireEvent.click(logicPackage);
    });
    await waitForLayout();
    await act(async () => {
      fireEvent.change(view.getByRole("textbox", { name: "Comment" }), { target: { value: "Please keep this behind the facade." } });
      fireEvent.click(view.getByRole("button", { name: "Add comment" }));
    });

    await waitFor(() => expect(calls.filter((call) => call.url.startsWith("/api/plans/flags-on-issues"))).toHaveLength(3));
    const operationCall = calls.find((call) => call.url === staleUrl);
    expect(JSON.parse(String(operationCall?.init?.body))).toEqual({
      expectedRevision: 2,
      operations: [{ op: "add_comment", target: { kind: "module", path: logic }, body: "Please keep this behind the facade." }],
      note: "Human comment from explorer",
    });
    expect(view.getByText("Plan changed elsewhere; refreshed revision 3.")).toBeTruthy();
  });

  test("check results render conformance status and file-line findings", async () => {
    installFetch();

    const view = renderExplorer();
    await view.findByRole("heading", { name: "repo" });
    await waitForLayout();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Check" }));
    });

    expect((await view.findAllByText("Violating")).length).toBeGreaterThan(0);
    expect(view.getByText("products/error_tracking/backend/logic/service.py:18")).toBeTruthy();
    expect(view.getByText("Import through products/feature_flags/backend/facade/api.py instead.")).toBeTruthy();
  });
});
