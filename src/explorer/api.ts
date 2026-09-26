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
  type ArchitecturePlan,
  type CheckPlanRequest,
  type PlanOperation,
} from "../architecture/contracts/index.ts";
import type { EventStatus, ExplorerApi, RepositoryState } from "./types.ts";

export function createExplorerApi(path: string): ExplorerApi {
  const query = `path=${encodeURIComponent(path)}`;
  return {
    async load(repositoryPath, planId) {
      const loadQuery = `path=${encodeURIComponent(repositoryPath)}`;
      const [payload, plans] = await Promise.all([
        getJson(`/api/architecture?${loadQuery}`, ArchitecturePayloadSchema),
        getJson(`/api/plans?${loadQuery}`, PlanListResponseSchema),
      ]);
      const selectedPlan = planId ?? plans[0]?.id ?? null;
      if (!selectedPlan) return { path: repositoryPath, payload, plans, plan: null, conformance: null } satisfies RepositoryState;
      const detail = await getJson(`/api/plans/${selectedPlan}?${loadQuery}`, PlanDetailResponseSchema);
      return { path: repositoryPath, payload, plans, plan: detail.plan, conformance: detail.conformance } satisfies RepositoryState;
    },
    async applyOperations(planId, expectedRevision, operations, note) {
      const response = await fetch(`/api/plans/${planId}/operations?${query}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision, operations, note }),
      });
      if (response.status === 409) {
        const error = ErrorResponseSchema.parse(await response.json());
        throw new StalePlanError(error.error, error.plan);
      }
      return ApplyOperationsResponseSchema.parse(await response.json()).plan;
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
      if (!("EventSource" in globalThis)) {
        onStatus("offline");
        return () => {};
      }
      onStatus("connecting");
      const source = new EventSource(`/api/events?${query}`);
      const open = () => onStatus("live");
      const error = () => onStatus("offline");
      source.addEventListener("open", open);
      source.addEventListener("error", error);
      for (const type of ["agent_activity", "plan_patch", "conformance_result", "selection_hint", "index_ready"] as const) {
        source.addEventListener(type, (message) => onEvent(ArchitectureEventSchema.parse(JSON.parse((message as MessageEvent).data))));
      }
      return () => {
        source.removeEventListener("open", open);
        source.removeEventListener("error", error);
        source.close();
      };
    },
  };
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
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`);
  return schema.parse(await response.json());
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`POST ${url} failed with ${response.status}`);
  return response.json();
}

export type { ArchitectureEvent, EventStatus, PlanOperation };
