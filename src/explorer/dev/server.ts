#!/usr/bin/env bun
import type { z } from "zod";
import explorer from "../index.html";
import { ApplyOperationsRequestSchema, ArchitecturePayloadSchema, ArchitecturePlanSchema, CheckPlanRequestSchema, SetLockRequestSchema, type ArchitectureEvent, type ArchitecturePlan, type ConformanceResult, type PlanOperation } from "../../architecture/contracts/index.ts";

const at = "2026-09-26T10:15:00.000Z";
const baseCommit = "f637db96f1fc853ea6a83694f02b94ab690bdcaf";
const fixturePath = process.env.EXPLORER_FIXTURE ?? "src/explorer/dev/posthog-architecture.fixture.json";
const port = Number(process.env.PORT ?? 4488);
const payload = ArchitecturePayloadSchema.parse(await Bun.file(fixturePath).json());
let seq = 1;
let published = !process.env.EXPLORER_PLAN_LIVE;
let plan: ArchitecturePlan = process.env.EXPLORER_PLAN ? ArchitecturePlanSchema.parse(await Bun.file(process.env.EXPLORER_PLAN).json()) : {
  version: 1,
  id: "flags-on-issues",
  title: "Flags on issues",
  goal: "Show feature flag usage on error tracking issues without bypassing feature flag facades.",
  baseCommit,
  status: "draft",
  revision: 2,
  modules: [
    { path: "products/error_tracking/backend/facade", action: "modify", responsibility: "Expose issue flag usage through error tracking backend facade.", origin: "agent" },
    { path: "products/error_tracking/frontend", action: "modify", responsibility: "Render issue flag usage in the issue UI.", origin: "agent" },
    { path: "products/error_tracking/backend/logic", action: "modify", responsibility: "Read issue flag usage through a stable feature flags seam.", origin: "agent" },
  ],
  seams: [
    { from: "products/error_tracking/backend/logic", to: "products/feature_flags/backend/facade", action: "add", interface: { files: ["products/feature_flags/backend/api/feature_flag_usage.py"], symbols: ["flags_for_issue"] }, rationale: "Route through the public feature flags facade.", origin: "agent" },
    { from: "products/error_tracking/backend/facade", to: "products/feature_flags/backend/models", action: "add", rationale: "Fixture violation: facade bypasses the planned feature flags seam.", origin: "agent" },
  ],
  comments: [],
  revisions: [
    { number: 1, at, actor: "agent", client: "dev-fixture", kind: "create", operations: [] },
    { number: 2, at, actor: "agent", client: "dev-fixture", kind: "edit", operations: [{ op: "upsert_module", path: "products/error_tracking/backend/logic", action: "modify", responsibility: "Read issue flag usage through a stable feature flags seam." }] },
  ],
  createdAt: at,
  updatedAt: at,
};
let conformance: ConformanceResult | null = process.env.EXPLORER_STALE_CHECK ? outdatedCheck() : null;
const streams = new Set<ReadableStreamDefaultController<string>>();

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": explorer,
    "/dev/scenario": async (request) => routeScenario(request),
    "/dev/publish": async (request) => routePublish(request),
    "/api/architecture": () => Response.json(payload),
    "/api/plans": (request) => routePlans(request),
    "/api/plans/:id": (request) => routePlan(request),
    "/api/plans/:id/operations": async (request) => routeOperations(request),
    "/api/plans/:id/lock": async (request) => routeLock(request),
    "/api/plans/:id/check": async (request) => routeCheck(request),
    "/api/events": () => routeEvents(),
  },
});

console.log(`Explorer fixture server is running at ${server.url}?path=${encodeURIComponent(payload.repository.root)}&plan=${plan.id}`);
console.log(`Regenerate the fixture with: /usr/bin/git show origin/prototype/repository-index:prototype/repository-index/out/posthog-architecture.json > /tmp/posthog-architecture.raw.json && bun run src/explorer/dev/convert-posthog-fixture.ts /tmp/posthog-architecture.raw.json`);

function routePlans(request: Request): Response {
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  if (!published) return Response.json([]);
  return Response.json([{ id: plan.id, title: plan.title, status: plan.status, revision: plan.revision, baseCommit: plan.baseCommit, updatedAt: plan.updatedAt, pendingHumanComments: plan.comments.filter((comment) => !comment.resolution).length }]);
}

function routePlan(request: Request): Response {
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  if (!published) return Response.json({ error: "no such plan" }, { status: 404 });
  return Response.json({ plan, conformance });
}

async function routeOperations(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const body = await parseJson(request, ApplyOperationsRequestSchema);
  if (body instanceof Response) return body;
  if (body.expectedRevision !== plan.revision) return Response.json({ error: "stale revision", plan }, { status: 409 });
  const revision = plan.revision + 1;
  plan = applyOperations(plan, body.operations, body.note, revision);
  emit({ seq: seq++, at: plan.updatedAt, repositoryId: payload.repository.id, type: "plan_patch", planId: plan.id, revision: plan.revisions.at(-1)!, plan });
  return Response.json({ plan, warnings: [] });
}

async function routeLock(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const body = await parseJson(request, SetLockRequestSchema);
  if (body instanceof Response) return body;
  if (body.expectedRevision !== plan.revision) return Response.json({ error: "stale revision", plan }, { status: 409 });
  const revision = plan.revision + 1;
  const revisionEntry = { number: revision, at: new Date().toISOString(), actor: "human" as const, client: "explorer", kind: body.locked ? "lock" as const : "unlock" as const, operations: [] };
  plan = { ...plan, status: body.locked ? "locked" : "draft", revision, updatedAt: revisionEntry.at, revisions: [...plan.revisions, revisionEntry] };
  emit({ seq: seq++, at: plan.updatedAt, repositoryId: payload.repository.id, type: "plan_patch", planId: plan.id, revision: revisionEntry, plan });
  return Response.json({ plan });
}

async function routeCheck(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const body = await parseJson(request, CheckPlanRequestSchema);
  if (body instanceof Response) return body;
  conformance = checkResult();
  emit({ seq: seq++, at: conformance.checkedAt, repositoryId: payload.repository.id, type: "conformance_result", planId: plan.id, result: conformance });
  return Response.json(conformance);
}

function checkResult(): ConformanceResult {
  const [violated, ...kept] = plan.seams;
  const seams = [...(violated ? [{ from: violated.from, to: violated.to, action: violated.action, status: "violating" as const, imports: 1 }] : []), ...kept.map((seam) => ({ from: seam.from, to: seam.to, action: seam.action, status: "conforming" as const, imports: 1 }))];
  const findings: ConformanceResult["findings"] = violated
    ? [{
        id: `bypasses-seam|${violated.from}|${violated.to}`,
        rule: "bypasses-seam",
        severity: "violation",
        file: `${violated.from}/feature_flags.py`,
        line: 42,
        subject: { kind: "seam", from: violated.from, to: violated.to },
        target: "products/feature_flags/backend/models/__init__.py",
        test: false,
        message: `\`${violated.from}/feature_flags.py:42\` imports \`products/feature_flags/backend/models/__init__.py\` from \`products/feature_flags/backend/models\` directly, but the plan routes \`${violated.from}\` to \`products/feature_flags\` through \`${violated.to}\`.`,
        fix: `Import it through \`${violated.interface?.files[0] ?? violated.to}\` instead. If that interface does not offer it yet, add it there first.`,
      }]
    : [];
  return {
    verdict: findings.length > 0 ? "violating" : "conforming",
    modules: plan.modules.map((module) => ({ path: module.path, action: module.action, status: "pending" as const })),
    seams,
    findings,
    counts: { violations: findings.length, pending: plan.modules.length, warnings: 0 },
    planId: plan.id,
    planRevision: plan.revision,
    planStatus: plan.status,
    phase: "progress",
    worktree: payload.repository.root,
    baseCommit,
    snapshotTree: payload.tree,
    checkedAt: new Date().toISOString(),
  };
}

function outdatedCheck(): ConformanceResult {
  return { ...checkResult(), planRevision: 1, worktree: "/fixtures/posthog-review", checkedAt: at };
}

async function routeScenario(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  void playScenario();
  return Response.json({ ok: true });
}

async function routePublish(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  published = true;
  emit({ seq: seq++, at: plan.updatedAt, repositoryId: payload.repository.id, type: "plan_patch", planId: plan.id, revision: plan.revisions[0]!, plan });
  return Response.json({ ok: true });
}

async function playScenario() {
  const client = "claude-code";
  const activity = (tool: string, summary: string) => emit({ seq: seq++, at: new Date().toISOString(), repositoryId: payload.repository.id, type: "agent_activity", id: `a${seq}`, client, tool, status: "ok", summary, planId: plan.id, durationMs: 180 });
  await pause(600);
  activity("describe_module", "describe_module products/feature_flags/backend/facade");
  emit({ seq: seq++, at: new Date().toISOString(), repositoryId: payload.repository.id, type: "selection_hint", client, tool: "describe_module", target: { kind: "module", path: "products/feature_flags/backend/facade" }, planId: plan.id });
  await pause(2200);
  applyAgentOperations([
    { op: "upsert_module", path: "products/feature_flags/backend/facade", action: "modify", responsibility: "Expose flag usage per issue through the public facade." },
    { op: "upsert_seam", from: "products/error_tracking/frontend", to: "products/error_tracking/backend/facade", action: "keep", rationale: "The issue UI keeps reading through its own backend facade." },
  ]);
  activity("edit_plan", "edit_plan: +1 module, +1 seam");
  await pause(2600);
  const pending = plan.comments.find((comment) => comment.author === "human" && !comment.resolution);
  if (pending) {
    applyAgentOperations([{ op: "resolve_comment", commentId: pending.id, reply: "Agreed. Routing every flag read through the facade and dropping the direct model import." }]);
    activity("edit_plan", "edit_plan: resolved 1 human comment");
    await pause(1800);
  }
  activity("check_plan", "check_plan: 1 violation");
  await routeCheck(new Request("http://localhost/api/plans/x/check", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
}

function applyAgentOperations(operations: PlanOperation[]) {
  const revision = plan.revision + 1;
  plan = { ...applyOperations(plan, operations, undefined, revision), revisions: [...plan.revisions, { number: revision, at: new Date().toISOString(), actor: "agent", client: "claude-code", kind: "edit", operations }] };
  plan = { ...plan, modules: plan.modules.map((module) => (module.origin === "human" && operations.some((operation) => operation.op === "upsert_module" && operation.path === module.path) ? { ...module, origin: "agent" } : module)) };
  emit({ seq: seq++, at: plan.updatedAt, repositoryId: payload.repository.id, type: "plan_patch", planId: plan.id, revision: plan.revisions.at(-1)!, plan });
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function routeEvents(): Response {
  let active: ReadableStreamDefaultController<string> | null = null;
  const stream = new ReadableStream<string>({
    start(controller) {
      active = controller;
      streams.add(controller);
      controller.enqueue(`event: index_ready\ndata: ${JSON.stringify({ seq: seq++, at: new Date().toISOString(), repositoryId: payload.repository.id, type: "index_ready", root: payload.repository.root, commit: payload.commit, tree: payload.tree, stats: payload.stats })}\n\n`);
    },
    cancel() {
      if (active) streams.delete(active);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}

async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  try {
    return schema.parse(await request.json());
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }
}

function applyOperations(current: ArchitecturePlan, operations: PlanOperation[], note: string | undefined, revision: number): ArchitecturePlan {
  const timestamp = new Date().toISOString();
  let next = { ...current, revision, updatedAt: timestamp, modules: [...current.modules], seams: [...current.seams], comments: [...current.comments] };
  for (const operation of operations) {
    if (operation.op === "add_comment") next.comments = [...next.comments, { id: `c${next.comments.length + 1}`, target: operation.target, author: "human", body: operation.body, at: timestamp, revision }];
    if (operation.op === "resolve_comment") next.comments = next.comments.map((comment) => (comment.id === operation.commentId ? { ...comment, resolution: { by: "agent", reply: operation.reply, at: timestamp, revision } } : comment));
    if (operation.op === "upsert_module") next.modules = [...next.modules.filter((module) => module.path !== operation.path), { path: operation.path, action: operation.action, responsibility: operation.responsibility, origin: "human" }];
    if (operation.op === "drop_module") next.modules = next.modules.filter((module) => module.path !== operation.path);
    if (operation.op === "upsert_seam") next.seams = [...next.seams.filter((seam) => seam.from !== operation.from || seam.to !== operation.to), { from: operation.from, to: operation.to, action: operation.action, interface: operation.interface, rationale: operation.rationale, origin: "human" }];
    if (operation.op === "drop_seam") next.seams = next.seams.filter((seam) => seam.from !== operation.from || seam.to !== operation.to);
  }
  return { ...next, revisions: [...current.revisions, { number: revision, at: timestamp, actor: "human", client: "explorer", kind: "edit", note, operations }] };
}

function emit(event: ArchitectureEvent) {
  const message = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const stream of [...streams]) {
    try {
      stream.enqueue(message);
    } catch {
      streams.delete(stream);
    }
  }
}
