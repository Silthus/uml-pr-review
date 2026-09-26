import { localhostAllowedHostnames, localhostAllowedOrigins, validateHostHeader, validateOriginHeader } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  ApplyOperationsRequestSchema,
  CheckPlanRequestSchema,
  CreatePlanRequestSchema,
  SetLockRequestSchema,
  type ApplyOperationsResponse,
  type ArchitecturePlan,
  type ConformanceResult,
  type ErrorResponse,
  type PlanDetailResponse,
  type PlanListResponse,
  type SetLockResponse,
} from "../contracts/index.ts";
import type { EventBus } from "../events/index.ts";
import type { ArchitectureModel } from "../model/index.ts";
import type { ApplyOutcome } from "../plan/index.ts";
import { ServiceError, type ArchitectureService, type RepositoryPlans } from "../service.ts";
import { eventStream } from "./event-stream.ts";

type Handler<Request_ extends Request = Request> = (request: Request_) => Promise<Response>;
type PlanRequest = Bun.BunRequest<"/api/plans/:id">;
type PlanHandler = (request: PlanRequest, plans: RepositoryPlans, planId: string) => Promise<Response>;

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly plan?: ArchitecturePlan,
  ) {
    super(message);
  }
}

export function createArchitectureRoutes({ service, bus }: { service: ArchitectureService; bus: EventBus }) {
  const compressed = new WeakMap<ArchitectureModel, Uint8Array<ArrayBuffer>>();

  const plansOf = (request: Request) => service.plans(repositoryPath(request));
  const forPlan = (handler: PlanHandler): Handler<PlanRequest> => guarded(async (request) => handler(request, await plansOf(request), request.params.id));

  async function architecture(request: Request): Promise<Response> {
    const commit = new URL(request.url).searchParams.get("commit") || undefined;
    const model = await service.architecture(repositoryPath(request), commit);
    if (!acceptsGzip(request)) return Response.json(model.payload);
    const body = compressed.get(model) ?? Bun.gzipSync(JSON.stringify(model.payload));
    compressed.set(model, body);
    return new Response(body, { headers: { "content-type": "application/json", "content-encoding": "gzip", vary: "accept-encoding" } });
  }

  async function events(request: Request): Promise<Response> {
    const repository = await service.repository(repositoryPath(request));
    return eventStream(bus, repository.id, request.signal);
  }

  return {
    "/api/architecture": { GET: guarded(architecture) },
    "/api/plans": {
      GET: guarded(async (request) => json<PlanListResponse>(await (await plansOf(request)).list())),
      POST: guarded(async (request) => {
        const { title, goal } = await bodyOf(request, CreatePlanRequestSchema);
        const plan = await (await plansOf(request)).create({ title, goal, actor: "human" });
        return json<ArchitecturePlan>(plan, 201);
      }),
    },
    "/api/plans/:id": {
      GET: forPlan(async (_, plans, id) => {
        const plan = await plans.get(id);
        return json<PlanDetailResponse>({ plan, conformance: await plans.lastCheck(plan.id) });
      }),
    },
    "/api/plans/:id/operations": {
      POST: forPlan(async (request, plans, id) => {
        const { expectedRevision, operations, note } = await bodyOf(request, ApplyOperationsRequestSchema);
        const outcome = accepted(await plans.apply(id, { expectedRevision, operations, note, actor: "human" }), { invalid: 400 });
        return json<ApplyOperationsResponse>({ plan: outcome.plan, warnings: outcome.warnings });
      }),
    },
    "/api/plans/:id/lock": {
      POST: forPlan(async (request, plans, id) => {
        const { locked, expectedRevision } = await bodyOf(request, SetLockRequestSchema);
        const outcome = accepted(await plans.setLock(id, { locked, expectedRevision, actor: "human" }), { invalid: 409 });
        return json<SetLockResponse>({ plan: outcome.plan });
      }),
    },
    "/api/plans/:id/check": {
      POST: forPlan(async (request, plans, id) => {
        const { final } = await bodyOf(request, CheckPlanRequestSchema);
        return json<ConformanceResult>(await service.check(repositoryPath(request), id, { phase: final ? "final" : "progress" }));
      }),
    },
    "/api/events": { GET: guarded(events) },
  };
}

export function rejectForeignRequest(request: Request): Response | undefined {
  const host = validateHostHeader(request.headers.get("host"), localhostAllowedHostnames());
  const origin = validateOriginHeader(request.headers.get("origin"), localhostAllowedOrigins());
  const problem = !host.ok ? host.message : !origin.ok ? origin.message : undefined;
  return problem === undefined ? undefined : json<ErrorResponse>({ error: problem }, 403);
}

function guarded<Request_ extends Request>(handler: Handler<Request_>): Handler<Request_> {
  return async (request) => rejectForeignRequest(request) ?? handler(request).catch(failure);
}

function repositoryPath(request: Request): string {
  const path = new URL(request.url).searchParams.get("path");
  if (!path) throw new HttpFailure(400, "Pass ?path=<absolute path of a directory inside your repository>.");
  return path;
}

async function bodyOf<Schema extends z.ZodType>(request: Request, schema: Schema): Promise<z.output<Schema>> {
  if (!isJson(request)) throw new HttpFailure(415, "Send the request body as JSON with content-type: application/json.");
  const text = await request.text();
  let body: unknown;
  try {
    body = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    throw new HttpFailure(400, "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpFailure(400, z.prettifyError(parsed.error));
  return parsed.data;
}

type Accepted = Extract<ApplyOutcome, { ok: true }>;

function accepted(outcome: ApplyOutcome, statuses: { invalid: 400 | 409 }): Accepted {
  if (outcome.ok) return outcome;
  const status = outcome.reason === "not-found" ? 404 : outcome.reason === "invalid" ? statuses.invalid : 409;
  throw new HttpFailure(status, outcome.message, status === 409 ? outcome.plan : undefined);
}

function failure(error: unknown): Response {
  if (error instanceof HttpFailure) return json<ErrorResponse>(error.plan ? { error: error.message, plan: error.plan } : { error: error.message }, error.status);
  if (error instanceof ServiceError) return json<ErrorResponse>({ error: error.message }, error.reason === "plan-not-found" ? 404 : 400);
  console.error(error);
  return json<ErrorResponse>({ error: error instanceof Error ? error.message : String(error) }, 500);
}

function isJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() === "application/json";
}

function acceptsGzip(request: Request): boolean {
  return /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "");
}

function json<Body>(body: Body, status = 200): Response {
  return Response.json(body, { status });
}
