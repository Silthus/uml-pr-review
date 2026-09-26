import {
  ApplyOperationsResponseSchema,
  ArchitectureEventSchema,
  ArchitecturePayloadSchema,
  ConformanceResultSchema,
  ErrorResponseSchema,
  PlanDetailResponseSchema,
  PlanListResponseSchema,
  SetLockResponseSchema,
  type ArchitectureEvent,
  type ArchitecturePayload,
  type ArchitecturePlan,
  type CheckPlanRequest,
  type ConformanceResult,
  type PlanOperation,
  type PlanSummary,
} from "../architecture/contracts/index.ts";

export type EventStatus = "connecting" | "live" | "offline";

export type RepositoryState = {
  path: string;
  payload: ArchitecturePayload;
  plans: PlanSummary[];
  plan: ArchitecturePlan | null;
  conformance: ConformanceResult | null;
};

export type ExplorerApi = {
  load(planId: string | null | undefined): Promise<RepositoryState>;
  applyOperations(planId: string, expectedRevision: number, operations: PlanOperation[], note?: string): Promise<ArchitecturePlan>;
  setLock(planId: string, expectedRevision: number, locked: boolean): Promise<ArchitecturePlan>;
  check(planId: string, final: boolean): Promise<ConformanceResult>;
  events(onEvent: (event: ArchitectureEvent) => void, onStatus: (status: EventStatus) => void): () => void;
};

const eventTypes = ["agent_activity", "plan_patch", "conformance_result", "selection_hint", "index_ready"] as const;

export function createExplorerApi(path: string): ExplorerApi {
  const query = `path=${encodeURIComponent(path)}`;
  return {
    async load(planId) {
      const [payload, plans] = await Promise.all([getJson(`/api/architecture?${query}`, ArchitecturePayloadSchema), getJson(`/api/plans?${query}`, PlanListResponseSchema)]);
      const selectedPlan = planId === null ? null : planId && plans.some((plan) => plan.id === planId) ? planId : (plans[0]?.id ?? null);
      if (!selectedPlan) return { path, payload, plans, plan: null, conformance: null };
      const detail = await getJson(`/api/plans/${selectedPlan}?${query}`, PlanDetailResponseSchema);
      return { path, payload, plans, plan: detail.plan, conformance: detail.conformance };
    },
    async applyOperations(planId, expectedRevision, operations, note) {
      const response = await postJson(`/api/plans/${planId}/operations?${query}`, { expectedRevision, operations, note });
      return ApplyOperationsResponseSchema.parse(response).plan;
    },
    async setLock(planId, expectedRevision, locked) {
      const response = await postJson(`/api/plans/${planId}/lock?${query}`, { locked, expectedRevision });
      return SetLockResponseSchema.parse(response).plan;
    },
    async check(planId, final) {
      const body: CheckPlanRequest = { final };
      return ConformanceResultSchema.parse(await postJson(`/api/plans/${planId}/check?${query}`, body));
    },
    events(onEvent, onStatus) {
      onStatus("connecting");
      const source = new EventSource(`/api/events?${query}`);
      source.addEventListener("open", () => onStatus("live"));
      source.addEventListener("error", () => onStatus("offline"));
      for (const type of eventTypes) {
        source.addEventListener(type, (message) => onEvent(ArchitectureEventSchema.parse(JSON.parse((message as MessageEvent<string>).data))));
      }
      return () => source.close();
    },
  };
}

export async function chooseFolder(): Promise<string | null> {
  const response = await fetch("/api/choose-folder", { method: "POST" });
  if (!response.ok) throw new Error(`Choosing a folder failed with ${response.status}`);
  const { path } = (await response.json()) as { path: string | null };
  return path;
}

export class StalePlanError extends Error {
  readonly plan: ArchitecturePlan | undefined;

  constructor(message: string, plan: ArchitecturePlan | undefined) {
    super(message);
    this.name = "StalePlanError";
    this.plan = plan;
  }
}

async function getJson<T>(url: string, schema: { parse(value: unknown): T }): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await errorMessage(response));
  return schema.parse(await response.json());
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (response.status === 409) {
    const error = ErrorResponseSchema.parse(await response.json());
    throw new StalePlanError(error.error, error.plan);
  }
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json();
}

async function errorMessage(response: Response): Promise<string> {
  const parsed = ErrorResponseSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error : `${response.status} ${response.statusText}`.trim();
}
