import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Client } from "@modelcontextprotocol/client";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { ArchitectureEvent } from "../../../src/architecture/contracts/index.ts";
import { connectAgent, removeRepositories, shopRepository, startArchitectureServer, type ArchitectureServer } from "../http/architecture-server.ts";
import { agentTools } from "./agent.ts";

let server: ArchitectureServer;
let client: Client;

beforeAll(async () => {
  server = startArchitectureServer();
  client = await connectAgent(server, "modern");
});

afterAll(async () => {
  await client.close();
  await server.stop();
  await removeRepositories();
});

test("a worktree outside any repository, or a relative one, asks for the absolute working directory", async () => {
  for (const worktree of ["/", "shop"]) {
    const result = await agentTools(client, worktree)("get_architecture_overview");
    expect(result).toMatchObject({ isError: true, text: `${worktree} is not inside a Git repository. Pass the absolute path of your working directory.` });
  }
});

test("an unknown module suggests the closest ones and search_modules, and the activity feed shows the failure", async () => {
  const repository = await shopRepository();
  const activity: ArchitectureEvent[] = [];
  const unsubscribe = server.bus.subscribe(await realpath(join(repository.dir, ".git")), (event) => activity.push(event));

  const result = await agentTools(client, repository.dir)("describe_module", { path: "shop/payment/facade" });
  unsubscribe();

  expect(result).toMatchObject({ isError: true, text: "No module `shop/payment/facade`. Did you mean `shop/payments/facade`, `shop/payments`, or `shop/payments/models`? Use search_modules to find module paths." });
  const [failure, ...others] = activity.filter((event) => event.type === "agent_activity");
  expect(others).toEqual([]);
  expect(failure).toMatchObject({ tool: "describe_module", status: "error" });
  expect(failure?.type === "agent_activity" && failure.summary).toStartWith("describe_module failed: No module `shop/payment/facade`. Did you mean");
});

test("plan lookups name the next call: create_plan without plans, the known ids otherwise", async () => {
  const call = agentTools(client, (await shopRepository()).dir);

  expect(await call("get_plan")).toMatchObject({ isError: true, text: "There is no plan in this repository yet. Call create_plan." });
  expect(await call("check_plan", { planId: "charge-orders-1234" })).toMatchObject({ isError: true, text: "There is no plan in this repository yet. Call create_plan." });

  const { structured } = await call("create_plan", { title: "Charge orders", goal: "Orders charge payments." });
  expect(await call("get_plan", { planId: "charge-orders-1234" })).toMatchObject({
    isError: true,
    text: `No plan \`charge-orders-1234\` in this repository. Plans here: \`${structured.plan.id}\`. Call get_plan without planId for the latest.`,
  });
});

test("check_plan refuses a worktree whose HEAD does not descend from the base commit", async () => {
  const repository = await shopRepository();
  const call = agentTools(client, repository.dir);
  const { structured } = await call("create_plan", { title: "Charge orders", goal: "Orders charge payments." });
  await repository.git("checkout", "--quiet", "--orphan", "elsewhere");
  await repository.commit({ "shop/orders/unrelated.py": "" });

  const result = await call("check_plan");

  const base7 = structured.plan.baseCommit.slice(0, 7);
  expect(result.isError).toBe(true);
  expect(result.text).toEndWith(
    `does not descend from the plan's base commit ${base7}. Check out a branch based on ${base7}, or move the plan's base with set_base_commit while it is a draft.`,
  );
});

test("a draft check says to have the plan locked, and set_plan_lock records the human's words", async () => {
  const call = agentTools(client, (await shopRepository()).dir);
  const { structured } = await call("create_plan", { title: "Charge orders", goal: "Orders charge payments." });

  const draftCheck = await call("check_plan");
  const locked = await call("set_plan_lock", { planId: structured.plan.id, locked: true, humanRequest: "Looks good, lock it." });
  const lockedAgain = await call("set_plan_lock", { planId: structured.plan.id, locked: true, humanRequest: "Lock it." });

  expect(draftCheck.text).toContain("The plan is a draft. Ask the human to lock it before you implement.");
  const history = await call("get_plan", { planId: structured.plan.id, history: true });
  expect(locked.structured).toMatchObject({ plan: { status: "locked", revision: 2 }, humanChanges: [] });
  expect(history.structured.plan.revisions.at(-1)).toMatchObject({ number: 2, kind: "lock", actor: "agent", client: "test-modern@1.0.0", note: "Looks good, lock it." });
  expect(lockedAgain.isError).toBe(true);
  expect(lockedAgain.text).toStartWith(`Plan ${structured.plan.id} is already locked. Implement it and check your work with check_plan.`);
});
