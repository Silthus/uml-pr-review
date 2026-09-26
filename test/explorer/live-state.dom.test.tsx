import { useHappyDom } from "./happy-dom.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, configure, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ArchitecturePlan, ConformanceResult, PlanSummary } from "../../src/architecture/contracts/index.ts";
import { ExplorerApp } from "../../src/explorer/app.tsx";
import { architectureOf } from "../support/architecture.ts";
import { FakeEventSource } from "./fake-event-source.ts";

const root = "/repo";
const otherWorktree = "/repo-review";
const at = "2026-09-26T10:15:00.000Z";
const later = "2026-09-26T10:20:00.000Z";
const baseCommit = "3f2a9c01d4e5b6a7980c1d2e3f4a5b6c7d8e9f00";

const payload = architectureOf({ "app/use.ts": [], "lib/api.ts": [] }, { repository: { id: "/repo/.git", root, commonDir: "/repo/.git", name: "repo" } });

const plan: ArchitecturePlan = {
  version: 1,
  id: "check-provenance",
  title: "Check provenance",
  goal: "Show only checks the explorer can vouch for.",
  baseCommit,
  status: "draft",
  revision: 1,
  modules: [{ path: "app", action: "modify", responsibility: "Use the api.", origin: "agent" }],
  seams: [],
  comments: [],
  revisions: [{ number: 1, at, actor: "agent", kind: "create", operations: [] }],
  createdAt: at,
  updatedAt: at,
};

const secondPlan: ArchitecturePlan = { ...plan, id: "second-plan", title: "Second plan" };

function revision(number: number, modules = plan.modules): ArchitecturePlan {
  const revisions = Array.from({ length: number }, (_, index) => (index === 0 ? plan.revisions[0]! : { number: index + 1, at: later, actor: "agent" as const, kind: "edit" as const, operations: [] }));
  return { ...plan, revision: number, modules, revisions, updatedAt: number === 1 ? at : later };
}

function summaryOf(current: ArchitecturePlan): PlanSummary {
  return { id: current.id, title: current.title, status: current.status, revision: current.revision, baseCommit: current.baseCommit, updatedAt: current.updatedAt, pendingHumanComments: 0 };
}

function checkOf(planRevision: number, worktree: string, verdict: ConformanceResult["verdict"] = "conforming"): ConformanceResult {
  return {
    verdict,
    modules: [{ path: "app", action: "modify", status: verdict }],
    seams: [],
    findings: [],
    counts: { violations: 0, pending: 0, warnings: 0 },
    planId: plan.id,
    planRevision,
    planStatus: "draft",
    phase: "final",
    worktree,
    baseCommit,
    snapshotTree: "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d",
    checkedAt: at,
  };
}

function patchEvent(patched: ArchitecturePlan) {
  return { seq: patched.revision, at: later, repositoryId: "/repo/.git", type: "plan_patch" as const, planId: patched.id, revision: patched.revisions.at(-1)!, plan: patched };
}

function checkEvent(result: ConformanceResult, seq: number) {
  return { seq, at: later, repositoryId: "/repo/.git", type: "conformance_result" as const, planId: result.planId, result };
}

function fakeServer({ initialPlans = [plan], conformance = null }: { initialPlans?: ArchitecturePlan[]; conformance?: ConformanceResult | null } = {}) {
  const plans = new Map(initialPlans.map((entry) => [entry.id, entry]));
  const pendingWrites: ((response: Response) => void)[] = [];
  const heldReads: (() => void)[] = [];
  let holding = false;
  let failing = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") return new Promise<Response>((resolve) => pendingWrites.push(resolve));
    if (holding) await new Promise<void>((resolve) => heldReads.push(resolve));
    if (failing) throw new Error("connection lost");
    if (url.startsWith("/api/architecture")) return Response.json(payload);
    if (url.startsWith("/api/plans?")) return Response.json([...plans.values()].map(summaryOf));
    const requested = plans.get(url.slice("/api/plans/".length).split("?")[0] ?? "");
    if (!requested) return Response.json({ error: "no such plan" }, { status: 404 });
    return Response.json({ plan: requested, conformance: conformance?.planId === requested.id ? conformance : null });
  }) as typeof fetch;
  return {
    advanceTo(next: ArchitecturePlan) {
      plans.set(next.id, next);
    },
    respond(response: Response) {
      const resolve = pendingWrites.shift();
      if (!resolve) throw new Error("No request is waiting for a response");
      resolve(response);
    },
    holdReads() {
      holding = true;
    },
    stopHolding() {
      holding = false;
    },
    failReads(value: boolean) {
      failing = value;
    },
    async releaseReads(order: "oldest-first" | "newest-first" = "oldest-first") {
      holding = false;
      const resumes = heldReads.splice(0);
      for (const resume of order === "oldest-first" ? resumes : resumes.reverse()) resume();
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    listFirst(id: string) {
      const first = plans.get(id);
      if (!first) throw new Error(`No plan ${id}`);
      plans.delete(id);
      const rest = [...plans.entries()];
      plans.clear();
      plans.set(id, first);
      for (const [key, value] of rest) plans.set(key, value);
    },
  };
}

async function renderExplorer(loadedRevision = 1) {
  history.replaceState(null, "", `?path=${encodeURIComponent(root)}&plan=${plan.id}`);
  const view = render(<ExplorerApp />);
  await view.findByText(`Architecture plan · revision ${loadedRevision}`);
  await act(async () => FakeEventSource.latest.open());
  return view;
}

function shownRevision(view: ReturnType<typeof render>) {
  return view.getByText(/^Architecture plan · revision/).textContent;
}

function planPanel(view: ReturnType<typeof render>) {
  return within(view.getByRole("region", { name: "Architecture plan" }));
}

async function submitComment(view: ReturnType<typeof render>, body: string) {
  await act(async () => {
    fireEvent.input(view.getByRole("textbox", { name: "Comment on the plan" }), { target: { value: body } });
  });
  await act(async () => {
    fireEvent.submit(view.getByRole("form", { name: "New comment on the plan" }));
  });
}

useHappyDom();
configure({ asyncUtilTimeout: 3000 });

beforeEach(() => {
  document.body.innerHTML = "";
  FakeEventSource.install();
  localStorage.clear();
});

afterEach(cleanup);

describe("explorer live state", () => {
  test("reconnecting the event stream refetches the revision the stream missed", async () => {
    const server = fakeServer();
    const view = await renderExplorer();

    await act(async () => FakeEventSource.latest.fail());
    server.advanceTo(revision(2));
    await act(async () => FakeEventSource.latest.open());

    expect(await view.findByText("Architecture plan · revision 2")).toBeTruthy();
  });

  test("a plan patch that lands during a resync is not undone by the resync's older response", async () => {
    const server = fakeServer();
    const view = await renderExplorer();

    server.holdReads();
    await act(async () => FakeEventSource.latest.fail());
    await act(async () => FakeEventSource.latest.open());
    await act(async () => FakeEventSource.latest.emit(patchEvent(revision(3))));
    expect(shownRevision(view)).toBe("Architecture plan · revision 3");

    server.advanceTo(revision(2));
    await act(() => server.releaseReads());

    expect(shownRevision(view)).toBe("Architecture plan · revision 3");
  });

  test("a resync that overtakes a plan load still leaves the explorer ready", async () => {
    const server = fakeServer({ initialPlans: [plan, secondPlan] });
    const view = await renderExplorer();

    server.holdReads();
    await act(async () => {
      fireEvent.change(view.getByRole("combobox", { name: "Plan" }), { target: { value: secondPlan.id } });
    });
    await act(async () => FakeEventSource.latest.fail());
    await act(async () => FakeEventSource.latest.open());
    await act(() => server.releaseReads("newest-first"));

    expect(view.getByRole("heading", { name: secondPlan.title })).toBeTruthy();
    await waitFor(() => expect(view.getByLabelText("Architecture canvas").getAttribute("aria-busy")).toBe("false"));
  });

  test("a failed resync shows its error until the next resync succeeds", async () => {
    const server = fakeServer();
    const view = await renderExplorer();

    server.failReads(true);
    await act(async () => FakeEventSource.latest.fail());
    await act(async () => FakeEventSource.latest.open());
    expect((await view.findByRole("alert")).textContent).toContain("connection lost");

    server.failReads(false);
    await act(async () => FakeEventSource.latest.fail());
    await act(async () => FakeEventSource.latest.open());
    await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
  });

  test("a resync that fails after a newer one applied does not show its error", async () => {
    const server = fakeServer();
    const view = await renderExplorer();

    server.holdReads();
    await act(async () => FakeEventSource.latest.fail());
    await act(async () => FakeEventSource.latest.open());
    server.stopHolding();
    server.advanceTo(revision(2));
    await act(async () => FakeEventSource.latest.fail());
    await act(async () => FakeEventSource.latest.open());
    await waitFor(() => expect(shownRevision(view)).toBe("Architecture plan · revision 2"));

    server.failReads(true);
    await act(() => server.releaseReads());

    expect(view.queryByRole("alert")).toBeNull();
    expect(shownRevision(view)).toBe("Architecture plan · revision 2");
  });

  test("a plan id that no longer exists falls back to the first plan, and reconnects keep following it", async () => {
    const server = fakeServer({ initialPlans: [secondPlan, plan] });
    history.replaceState(null, "", `?path=${encodeURIComponent(root)}&plan=deleted-plan`);
    const view = render(<ExplorerApp />);
    expect(await view.findByRole("heading", { name: secondPlan.title })).toBeTruthy();
    expect((view.getByRole("combobox", { name: "Plan" }) as HTMLSelectElement).value).toBe(secondPlan.id);

    server.listFirst(plan.id);
    server.advanceTo({ ...revision(2), id: secondPlan.id, title: secondPlan.title });
    await act(async () => FakeEventSource.latest.fail());
    await act(async () => FakeEventSource.latest.open());

    await waitFor(() => expect(shownRevision(view)).toBe("Architecture plan · revision 2"));
    expect(view.getByRole("heading", { name: secondPlan.title })).toBeTruthy();
  });

  test("choosing another plan opens it, and choosing no plan closes the panel", async () => {
    fakeServer({ initialPlans: [plan, secondPlan] });
    const view = await renderExplorer();

    await act(async () => {
      fireEvent.change(view.getByRole("combobox", { name: "Plan" }), { target: { value: secondPlan.id } });
    });
    expect(await view.findByRole("heading", { name: secondPlan.title })).toBeTruthy();

    await act(async () => {
      fireEvent.change(view.getByRole("combobox", { name: "Plan" }), { target: { value: "" } });
    });
    await waitFor(() => expect(view.queryByRole("region", { name: "Architecture plan" })).toBeNull());
  });

  test("a late load for a plan the human already left does not reopen it", async () => {
    const server = fakeServer({ initialPlans: [plan, secondPlan] });
    const view = await renderExplorer();

    server.holdReads();
    await act(async () => {
      fireEvent.change(view.getByRole("combobox", { name: "Plan" }), { target: { value: secondPlan.id } });
    });
    await act(async () => {
      fireEvent.change(view.getByRole("combobox", { name: "Plan" }), { target: { value: "" } });
    });
    await act(() => server.releaseReads());

    expect(view.queryByRole("region", { name: "Architecture plan" })).toBeNull();
    expect(view.queryByRole("heading", { name: secondPlan.title })).toBeNull();
  });

  test("a late mutation response never rolls the plan back behind a newer live revision", async () => {
    const server = fakeServer();
    const view = await renderExplorer();

    await submitComment(view, "Please change this");
    await act(async () => FakeEventSource.latest.emit(patchEvent(revision(3))));
    expect(shownRevision(view)).toBe("Architecture plan · revision 3");

    await act(async () => server.respond(Response.json({ plan: revision(2), warnings: [] })));

    expect(shownRevision(view)).toBe("Architecture plan · revision 3");
  });

  test("a rejected comment keeps the text and says why it was not saved", async () => {
    const server = fakeServer();
    const view = await renderExplorer();
    const box = view.getByRole("textbox", { name: "Comment on the plan" }) as HTMLTextAreaElement;

    await submitComment(view, "Please preserve my detailed feedback");
    await act(async () => server.respond(Response.json({ error: "stale revision", plan: revision(2) }, { status: 409 })));

    expect(box.value).toBe("Please preserve my detailed feedback");
    expect(within(view.getByRole("form", { name: "New comment on the plan" })).getByRole("alert").textContent).toContain("revision 2");
    expect(shownRevision(view)).toBe("Architecture plan · revision 2");
  });

  test("a rejected module save keeps the form open with its input", async () => {
    const server = fakeServer();
    const view = await renderExplorer();
    await act(async () => {
      fireEvent.click(planPanel(view).getByRole("button", { name: "New module…" }));
    });
    await act(async () => {
      fireEvent.input(view.getByRole("textbox", { name: "Module path" }), { target: { value: "lib" } });
      fireEvent.input(view.getByRole("textbox", { name: "Responsibility" }), { target: { value: "Serve the api." } });
    });
    await act(async () => {
      fireEvent.submit(view.getByRole("form", { name: "Planned module" }));
    });

    await act(async () => server.respond(Response.json({ error: "lib is not a module" }, { status: 400 })));

    expect((view.getByRole("textbox", { name: "Responsibility" }) as HTMLInputElement).value).toBe("Serve the api.");
    expect(within(view.getByRole("form", { name: "Planned module" })).getByRole("alert").textContent).toContain("lib is not a module");
  });

  test("a check of another revision in another worktree is shown as outdated, with what it checked", async () => {
    fakeServer({ initialPlans: [revision(2, [...plan.modules, { path: "missing", action: "create", responsibility: "Must exist.", origin: "human" }])], conformance: checkOf(1, otherWorktree) });
    const view = await renderExplorer(2);
    const panel = planPanel(view);

    expect(panel.queryByText("✓ conforming · final")).toBeNull();
    expect(panel.getByText("Outdated check")).toBeTruthy();
    const provenance = panel.getByText(/Checked revision 1 in \/repo-review/);
    expect(provenance.textContent).toContain("conforming");
    expect(provenance.querySelector("time")?.getAttribute("datetime")).toBe(at);
    expect(provenance.textContent).toContain("revision 2");
    expect(provenance.textContent).toContain(`This explorer shows ${root}.`);
    expect(panel.getByRole("button", { name: /^modify app/ }).textContent).not.toContain("conforming");
  });

  test("live check results count only for this worktree, and any plan edit outdates them", async () => {
    fakeServer();
    const view = await renderExplorer();
    const panel = planPanel(view);

    await act(async () => FakeEventSource.latest.emit(checkEvent(checkOf(1, otherWorktree), 7)));
    expect(panel.getByText("Not checked yet")).toBeTruthy();

    await act(async () => FakeEventSource.latest.emit(checkEvent(checkOf(1, root), 8)));
    expect(panel.getByText("✓ conforming · final")).toBeTruthy();
    expect(panel.getByRole("button", { name: /^modify app/ }).textContent).toContain("conforming");

    await act(async () => FakeEventSource.latest.emit(patchEvent(revision(2))));
    expect(panel.queryByText("✓ conforming · final")).toBeNull();
    expect(panel.getByText("Outdated check")).toBeTruthy();
    expect(panel.getByRole("button", { name: /^modify app/ }).textContent).not.toContain("conforming");
  });
});

