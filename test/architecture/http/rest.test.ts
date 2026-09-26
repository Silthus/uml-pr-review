import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { ArchitecturePayloadSchema, ArchitecturePlanSchema, ConformanceResultSchema, type ArchitecturePlan } from "../../../src/architecture/contracts/index.ts";
import type { TemporaryRepository } from "../index/repository.ts";
import { inRepository, jsonBody, removeRepositories, shop, shopRepository, startArchitectureServer, type ArchitectureServer } from "./architecture-server.ts";

let server: ArchitectureServer;
let repository: TemporaryRepository;

beforeAll(async () => {
  server = startArchitectureServer();
  repository = await shopRepository();
});

afterAll(async () => {
  await server.stop();
  await removeRepositories();
});

const api = (route: string, init?: BunFetchRequestInit) => server.api(inRepository(route, repository), init);

async function createdPlan(): Promise<ArchitecturePlan> {
  const response = await api("/api/plans", jsonBody({ title: "Charge orders", goal: "Orders charge payments." }));
  expect(response.status).toBe(201);
  return ArchitecturePlanSchema.parse(await response.json());
}

describe("GET /api/architecture", () => {
  test("serves the payload of HEAD gzip-compressed when the client accepts it", async () => {
    const response = await api("/api/architecture", { headers: { "accept-encoding": "gzip" }, decompress: false });

    expect(response.headers.get("content-encoding")).toBe("gzip");
    const payload = ArchitecturePayloadSchema.parse(JSON.parse(gunzipSync(await response.bytes()).toString()));
    expect(payload.commit).toBe((await repository.git("rev-parse", "HEAD")).trim());
    expect(payload.files.map(([path]) => path)).toEqual(Object.keys(shop).toSorted());
  });

  test("serves plain JSON to a client that does not accept gzip, and indexes the commit asked for", async () => {
    const first = (await repository.git("rev-list", "--max-parents=0", "HEAD")).trim();
    await repository.commit({ "shop/orders/refunds.py": "" });

    const response = await api(`/api/architecture?commit=${first}`, { headers: { "accept-encoding": "identity" } });

    expect(response.headers.get("content-encoding")).toBeNull();
    const payload = ArchitecturePayloadSchema.parse(await response.json());
    expect(payload.commit).toBe(first);
    expect(payload.files.map(([path]) => path)).not.toContain("shop/orders/refunds.py");
  });

  test("answers 400 for an unknown commit or a folder outside any repository", async () => {
    const unknownCommit = await api("/api/architecture?commit=0000000000000000000000000000000000000000");
    expect(unknownCommit.status).toBe(400);
    expect((await unknownCommit.json()).error).toContain("does not exist");

    const outside = await server.api("/api/architecture?path=/");
    expect(outside.status).toBe(400);
    expect(await outside.json()).toEqual({ error: "/ is not inside a Git repository. Pass the absolute path of your working directory." });
  });
});

describe("plans", () => {
  test("a human creates, reads, edits, locks, and checks a plan", async () => {
    const plan = await createdPlan();
    expect(plan.revisions).toMatchObject([{ number: 1, kind: "create", actor: "human" }]);

    const listed = await (await api("/api/plans")).json();
    expect(listed).toContainEqual(expect.objectContaining({ id: plan.id, revision: 1, pendingHumanComments: 0 }));

    const edited = await api(`/api/plans/${plan.id}/operations`, jsonBody({ expectedRevision: 1, operations: [{ op: "upsert_module", path: "shop/orders", action: "modify", responsibility: "Charge orders." }] }));
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ plan: { revision: 2, modules: [{ path: "shop/orders", origin: "human" }] }, warnings: [] });

    const locked = await api(`/api/plans/${plan.id}/lock`, jsonBody({ locked: true, expectedRevision: 2 }));
    expect(await locked.json()).toMatchObject({ plan: { revision: 3, status: "locked" } });

    expect(await (await api(`/api/plans/${plan.id}`)).json()).toMatchObject({ plan: { id: plan.id, revision: 3 }, conformance: null });
    const checked = await api(`/api/plans/${plan.id}/check`, jsonBody({ final: true }));
    const result = ConformanceResultSchema.parse(await checked.json());
    expect(result).toMatchObject({ planId: plan.id, phase: "final", verdict: "violating", planStatus: "locked" });
    expect((await (await api(`/api/plans/${plan.id}`)).json()).conformance).toEqual(result);
  });

  test("answers 409 with the current plan for a stale revision and for a lock conflict", async () => {
    const plan = await createdPlan();

    const stale = await api(`/api/plans/${plan.id}/operations`, jsonBody({ expectedRevision: 2, operations: [{ op: "set_summary", title: "Later" }] }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: expect.stringContaining("The plan is at revision 1, not 2."), plan: { id: plan.id, revision: 1 } });

    const unlockDraft = await api(`/api/plans/${plan.id}/lock`, jsonBody({ locked: false, expectedRevision: 1 }));
    expect(unlockDraft.status).toBe(409);
    expect(await unlockDraft.json()).toMatchObject({ plan: { id: plan.id, status: "draft" } });

    await api(`/api/plans/${plan.id}/lock`, jsonBody({ locked: true, expectedRevision: 1 }));
    const editLocked = await api(`/api/plans/${plan.id}/operations`, jsonBody({ expectedRevision: 2, operations: [{ op: "drop_module", path: "shop/orders" }] }));
    expect(editLocked.status).toBe(409);
    expect((await editLocked.json()).error).toStartWith(`Plan ${plan.id} is locked.`);
  });

  test("answers 404 for an unknown plan on every plan route", async () => {
    await createdPlan();
    const responses = await Promise.all([
      api("/api/plans/no-such-plan"),
      api("/api/plans/no-such-plan/operations", jsonBody({ expectedRevision: 1, operations: [{ op: "set_summary", title: "x" }] })),
      api("/api/plans/no-such-plan/lock", jsonBody({ locked: true, expectedRevision: 1 })),
      api("/api/plans/no-such-plan/check", jsonBody({})),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect((await responses[0]!.json()).error).toStartWith("No plan `no-such-plan` in this repository. Plans here:");
  });

  test("answers 400 for a body that does not match the contract, and for a batch the plan rejects", async () => {
    const plan = await createdPlan();

    const malformed = await api(`/api/plans/${plan.id}/operations`, jsonBody({ expectedRevision: 1, operations: [] }));
    expect(malformed.status).toBe(400);
    const notJson = await api("/api/plans", { method: "POST", body: "{" });
    expect(await notJson.json()).toEqual({ error: "The request body is not valid JSON." });

    const rejected = await api(`/api/plans/${plan.id}/operations`, jsonBody({ expectedRevision: 1, operations: [{ op: "upsert_module", path: "shop/order", action: "modify", responsibility: "x" }] }));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toContain("No module `shop/order` at base commit");
  });
});

describe("DNS rebinding guard", () => {
  test("answers 403 for a foreign Host or Origin on the API and on /mcp", async () => {
    const foreignHost = { headers: { host: "evil.example" } };
    const foreignOrigin = { headers: { origin: "http://evil.example" } };

    const responses = await Promise.all([
      api("/api/plans", foreignHost),
      api("/api/plans", jsonBody({ title: "x", goal: "y" }, foreignOrigin)),
      server.api("/mcp", jsonBody({}, foreignHost)),
      server.api("/mcp", jsonBody({}, foreignOrigin)),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect((await (await api("/api/plans")).json()).length).toBeGreaterThan(0);
  });
});
