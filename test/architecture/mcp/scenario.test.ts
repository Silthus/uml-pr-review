import { afterAll, beforeAll, expect, test } from "bun:test";
import { connectAgent, inRepository, jsonBody, removeRepositories, shopRepository, startArchitectureServer, type ArchitectureServer, type Wire } from "../http/architecture-server.ts";
import { agentTools, type ToolResult } from "./agent.ts";

let server: ArchitectureServer;

beforeAll(() => {
  server = startArchitectureServer();
});

afterAll(async () => {
  await server.stop();
  await removeRepositories();
});

test.each<Wire>(["modern", "legacy"])("over the %s wire, an agent plans a change, hears the human, and implements it until the plan conforms", async (wire) => {
  const repository = await shopRepository();
  const client = await connectAgent(server, wire);
  const call = agentTools(client, repository.dir);
  const human = (route: string, body: unknown) => server.api(inRepository(route, repository), jsonBody(body));

  const overview = await call("get_architecture_overview", { depth: 2 });
  expect(overview.isError).toBe(false);
  expect(overview.structured.modules.map((module: { path: string }) => module.path)).toEqual(["shop", "shop/orders", "shop/payments"]);
  expect(overview.text).toContain("shop/payments");

  const described = await call("describe_module", { path: "shop/payments/facade" });
  expect(described.structured.dependsOn).toEqual([{ module: "shop/payments/models", imports: 1, via: [{ module: "shop/payments/models", imports: 1 }] }]);
  expect(described.text).toContain("shop/payments/models: 1 import");

  const evidence = await call("get_dependency_evidence", { from: "shop/payments/facade", to: "shop/payments/models" });
  expect(evidence.structured.total).toBe(1);
  expect(evidence.text).toContain("shop/payments/facade/api.py:1 -> shop/payments/models/charge.py");

  const found = await call("search_modules", { query: "payments facade" });
  expect(found.structured.hits[0].module.path).toBe("shop/payments/facade");

  const created = await call("create_plan", { title: "Charge orders", goal: "Orders charge payments through the payments facade." });
  const planId: string = created.structured.plan.id;
  expect(created.structured.plan).toMatchObject({ revision: 1, status: "draft", baseCommit: (await repository.git("rev-parse", "HEAD")).trim() });
  expect(created.text).toContain(`expectedRevision 1`);

  const drafted = await call("edit_plan", {
    planId,
    expectedRevision: 1,
    operations: [
      { op: "upsert_module", path: "shop/orders", action: "modify", responsibility: "Charge an order when it is placed." },
      { op: "upsert_seam", from: "shop/orders", to: "shop/payments/facade", action: "add", interface: { files: ["shop/payments/facade/api.py"] } },
    ],
  });
  expect(drafted.structured.plan.revision).toBe(2);

  const comment = await human(`/api/plans/${planId}/operations`, {
    expectedRevision: 2,
    operations: [{ op: "add_comment", target: { kind: "seam", from: "shop/orders", to: "shop/payments/facade" }, body: "Only charge through api.py, please." }],
  });
  expect(comment.status).toBe(200);

  const read = await call("get_plan", { planId });
  expect(read.structured.pendingHumanComments).toMatchObject([{ id: "c1", body: "Only charge through api.py, please." }]);
  expect(read.structured.humanChanges.map((revision: { number: number }) => revision.number)).toEqual([3]);
  expect(read.text).toContain('Human comments waiting for you (1):\nc1 on seam `shop/orders -> shop/payments/facade`: "Only charge through api.py, please."');
  expect(read.structured.next).toStartWith("First answer 1 human comment: resolve each with edit_plan resolve_comment and a reply");

  const stale = await call("edit_plan", { planId, expectedRevision: 2, operations: [{ op: "set_summary", title: "Charge orders now" }] });
  expect(stale.isError).toBe(true);
  expect(stale.text).toContain("The plan is at revision 3, not 2. Revision 3 by the human: 1 comment. Retry with expectedRevision 3");

  const answered = await call("edit_plan", { planId, expectedRevision: 3, operations: [{ op: "resolve_comment", commentId: "c1", reply: "Agreed, api.py only." }] });
  expect(answered.structured.pendingHumanComments).toEqual([]);

  const locked = await human(`/api/plans/${planId}/lock`, { locked: true, expectedRevision: 4 });
  expect(locked.status).toBe(200);

  const refused = await call("edit_plan", { planId, expectedRevision: 5, operations: [{ op: "drop_module", path: "shop/orders" }] });
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain(`Plan ${planId} is locked.`);
  const commented = await call("edit_plan", { planId, expectedRevision: 5, operations: [{ op: "add_comment", target: { kind: "plan" }, body: "Starting on it." }] });
  expect(commented.structured.plan).toMatchObject({ revision: 6, status: "locked" });

  await repository.write({ "shop/orders/logic.py": "from shop.orders import models\nfrom shop.payments.models import charge\n" });
  const violating = await call("check_plan", { planId });
  expect(violating.structured.result.verdict).toBe("violating");
  expect(findingLines(violating)).toContain("violation bypasses-seam shop/orders/logic.py:2");
  expect(violating.text).toContain("Fix: Import it through `shop/payments/facade/api.py` instead.");
  expect(violating.structured.next).toBe("Apply the fix of every violation, then call check_plan again.");

  await repository.write({ "shop/orders/logic.py": "from shop.orders import models\nfrom shop.payments.facade import api\n" });
  const conforming = await call("check_plan", { planId, final: true });
  expect(conforming.structured.result).toMatchObject({ verdict: "conforming", phase: "final", planRevision: 6, planStatus: "locked" });
  expect(conforming.text.split("\n")[0]).toEndWith(": conforming.");

  await client.close();
});

function findingLines(result: ToolResult): string[] {
  return result.text.split("\n").filter((line) => /^(violation|pending|warning) /.test(line));
}
