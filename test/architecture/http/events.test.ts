import { afterAll, beforeAll, expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { TemporaryRepository } from "../index/repository.ts";
import { agentTools } from "../mcp/agent.ts";
import { connectAgent, inRepository, jsonBody, removeRepositories, shopRepository, startArchitectureServer, type ArchitectureServer } from "./architecture-server.ts";
import { openEventStream } from "./event-stream.ts";

let server: ArchitectureServer;
let shopA: TemporaryRepository;
let shopB: TemporaryRepository;

beforeAll(async () => {
  server = startArchitectureServer();
  [shopA, shopB] = await Promise.all([shopRepository(), shopRepository()]);
});

afterAll(async () => {
  await server.stop();
  await removeRepositories();
});

test("each event type reaches the event stream of its own repository only, in seq order", async () => {
  const streamA = await openEventStream(await server.api(inRepository("/api/events", shopA)));
  const streamB = await openEventStream(await server.api(inRepository("/api/events", shopB)));

  const codex = await connectAgent(server, "legacy", { "user-agent": "codex-mcp-client/0.157.0" });
  await agentTools(codex, shopB.dir)("describe_module", { path: "shop/orders" });
  await codex.close();

  await server.api(inRepository("/api/architecture", shopA));
  const claude = await connectAgent(server, "modern");
  await agentTools(claude, shopA.dir)("describe_module", { path: "shop/payments" });
  await claude.close();
  const plan = await (await server.api(inRepository("/api/plans", shopA), jsonBody({ title: "Charge orders", goal: "Orders charge payments." }))).json();
  await server.api(inRepository(`/api/plans/${plan.id}/check`, shopA), jsonBody({}));

  const eventsA = await streamA.next(5);
  const eventsB = await streamB.next(3);
  await Promise.all([streamA.close(), streamB.close()]);

  expect(eventsA.map((event) => event.type)).toEqual(["index_ready", "agent_activity", "selection_hint", "plan_patch", "conformance_result"]);
  expect(eventsB.map((event) => event.type)).toEqual(["index_ready", "agent_activity", "selection_hint"]);
  expect(new Set(eventsA.map((event) => event.repositoryId))).toEqual(new Set([await commonDir(shopA)]));
  expect(new Set(eventsB.map((event) => event.repositoryId))).toEqual(new Set([await commonDir(shopB)]));
  for (const events of [eventsA, eventsB]) expect(events.map((event) => event.seq)).toEqual(events.map((event) => event.seq).toSorted((a, b) => a - b));

  expect(eventsA[1]).toMatchObject({ client: "test-modern@1.0.0", tool: "describe_module", status: "ok", summary: "describe_module shop/payments" });
  expect(eventsA[2]).toMatchObject({ client: "test-modern@1.0.0", tool: "describe_module", target: { kind: "module", path: "shop/payments" } });
  expect(eventsA[3]).toMatchObject({ planId: plan.id, revision: { number: 1, kind: "create", actor: "human" }, plan: { id: plan.id } });
  expect(eventsA[4]).toMatchObject({ planId: plan.id, result: { planId: plan.id, verdict: "conforming" } });
  expect(eventsB[1]).toMatchObject({ client: "codex-mcp-client/0.157.0", summary: "describe_module shop/orders" });
});

async function commonDir(repository: TemporaryRepository): Promise<string> {
  return realpath(join(repository.dir, ".git"));
}
