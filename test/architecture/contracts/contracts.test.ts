import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import {
  ApplyOperationsRequestSchema,
  ApplyOperationsResponseSchema,
  ArchitectureEventSchema,
  ArchitecturePayloadSchema,
  ArchitecturePlanSchema,
  ChangedFileSchema,
  CheckPlanRequestSchema,
  ConformanceResultSchema,
  CreatePlanRequestSchema,
  ErrorResponseSchema,
  PlanContextSchema,
  PlanDetailResponseSchema,
  PlanListResponseSchema,
  PlanSummarySchema,
  PlanViewSchema,
  SearchHitSchema,
  SetLockRequestSchema,
  type ArchitecturePlan,
  type ConformanceResult,
  type PlanComment,
  type Revision,
} from "../../../src/architecture/contracts/index.ts";
import { architectureOf } from "../../support/architecture.ts";

const logic = "products/error_tracking/backend/logic";
const facade = "products/feature_flags/backend/facade";
const at = "2026-09-26T10:15:00.000Z";
const baseCommit = "3f2a9c01d4e5b6a7980c1d2e3f4a5b6c7d8e9f00";

const comment: PlanComment = {
  id: "c1",
  target: { kind: "seam", from: logic, to: facade },
  author: "human",
  body: "Go through the facade, not the models.",
  at,
  revision: 2,
};

const revisions: Revision[] = [
  { number: 1, at, actor: "agent", client: "claude-code@2.1.0", kind: "create", operations: [] },
  { number: 2, at, actor: "human", kind: "edit", operations: [{ op: "add_comment", target: comment.target, body: comment.body }] },
];

const plan: ArchitecturePlan = {
  version: 1,
  id: "feature-flags-on-issues-3f2a",
  title: "Feature flags on issues",
  goal: "Show feature flag usage on error tracking issues.",
  baseCommit,
  status: "draft",
  revision: 2,
  modules: [{ path: "products/error_tracking/backend/facade", action: "modify", responsibility: "Expose flags for an issue.", origin: "agent" }],
  seams: [
    {
      from: logic,
      to: facade,
      action: "add",
      interface: { files: [`${facade}/api.py`], symbols: ["flags_for"] },
      rationale: "Issues need the flags evaluated for them.",
      origin: "agent",
    },
  ],
  comments: [comment],
  revisions,
  createdAt: at,
  updatedAt: at,
};

const { revisions: _, ...planView } = plan;

const result: ConformanceResult = {
  verdict: "violating",
  modules: [{ path: "products/error_tracking/backend/facade", action: "modify", status: "pending" }],
  seams: [{ from: logic, to: facade, action: "add", status: "violating", imports: 0 }],
  findings: [
    {
      id: `bypasses-seam|${logic}/service.py|3|products/feature_flags/backend/models/flag.py`,
      rule: "bypasses-seam",
      severity: "violation",
      file: `${logic}/service.py`,
      line: 3,
      subject: { kind: "seam", from: logic, to: facade },
      target: "products/feature_flags/backend/models/flag.py",
      test: false,
      message: "It bypasses the seam.",
      fix: "Import it through the interface.",
    },
  ],
  counts: { violations: 1, pending: 1, warnings: 0 },
  planId: plan.id,
  planRevision: 2,
  planStatus: "locked",
  phase: "progress",
  worktree: "/tmp/posthog-proof",
  baseCommit,
  snapshotTree: "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d",
  checkedAt: at,
};

const payload = architectureOf({ [`${logic}/service.py`]: [{ to: `${facade}/api.py`, line: 3, names: ["flags_for"] }, { unresolved: "posthog.gone", line: 7 }] });

const event = { seq: 7, at, repositoryId: "/repo/.git" };

type Case = { name: string; schema: z.ZodType; valid: unknown; invalid: unknown; path: PropertyKey[] };

const cases: Case[] = [
  { name: "ArchitecturePayload", schema: ArchitecturePayloadSchema, valid: payload, invalid: { ...payload, files: [[`${logic}/service.py`, 0, "go", "production"]] }, path: ["files", 0, 2] },
  { name: "ChangedFile", schema: ChangedFileSchema, valid: { path: `${logic}/service.py`, status: "modified", firstChangedLine: 3 }, invalid: { path: "x.py", status: "deleted", firstChangedLine: 0 }, path: ["firstChangedLine"] },
  { name: "ArchitecturePlan", schema: ArchitecturePlanSchema, valid: plan, invalid: { ...plan, seams: [{ ...plan.seams[0], from: "products/" }] }, path: ["seams", 0, "from"] },
  { name: "PlanView", schema: PlanViewSchema, valid: planView, invalid: { ...planView, comments: [{ ...comment, id: "comment-1" }] }, path: ["comments", 0, "id"] },
  { name: "PlanSummary", schema: PlanSummarySchema, valid: { id: plan.id, title: plan.title, status: "draft", revision: 2, baseCommit, updatedAt: at, pendingHumanComments: 1 }, invalid: { id: plan.id, title: plan.title, status: "draft", revision: 2, baseCommit: "HEAD", updatedAt: at, pendingHumanComments: 1 }, path: ["baseCommit"] },
  { name: "ConformanceResult", schema: ConformanceResultSchema, valid: result, invalid: { ...result, findings: [{ ...result.findings[0], rule: "bypass" }] }, path: ["findings", 0, "rule"] },
  { name: "SearchHit", schema: SearchHitSchema, valid: { module: { path: facade, label: "facade", kind: "layer", parent: "products/feature_flags/backend", childCount: 0, directFiles: 2, totalFiles: 2 }, files: [] }, invalid: { module: { path: facade, label: "facade", kind: "layer", parent: undefined, childCount: 0, directFiles: 2, totalFiles: 2 }, files: [] }, path: ["module", "parent"] },
  { name: "agent_activity event", schema: ArchitectureEventSchema, valid: { ...event, type: "agent_activity", id: "call-1", client: "claude-code@2.1.0", tool: "describe_module", status: "ok", summary: `describe_module ${facade}`, durationMs: 42 }, invalid: { ...event, type: "agent_activity", id: "call-1", client: "codex", tool: "check_plan", status: "done", summary: "check_plan", durationMs: 1 }, path: ["status"] },
  { name: "plan_patch event", schema: ArchitectureEventSchema, valid: { ...event, type: "plan_patch", planId: plan.id, revision: revisions[1], plan }, invalid: { ...event, type: "plan_patch", planId: plan.id, revision: { ...revisions[1], kind: "merge" }, plan }, path: ["revision", "kind"] },
  { name: "conformance_result event", schema: ArchitectureEventSchema, valid: { ...event, type: "conformance_result", planId: plan.id, result }, invalid: { ...event, type: "conformance_result", planId: plan.id, result: { ...result, checkedAt: "yesterday" } }, path: ["result", "checkedAt"] },
  { name: "selection_hint event", schema: ArchitectureEventSchema, valid: { ...event, type: "selection_hint", client: "codex", tool: "get_dependency_evidence", target: { kind: "seam", from: logic, to: facade } }, invalid: { ...event, type: "selection_hint", client: "codex", tool: "describe_module", target: { kind: "module" } }, path: ["target", "path"] },
  { name: "index_ready event", schema: ArchitectureEventSchema, valid: { ...event, type: "index_ready", root: "/repo", commit: null, tree: payload.tree, stats: payload.stats }, invalid: { ...event, type: "index_ready", root: "/repo", commit: null, tree: payload.tree, stats: { ...payload.stats, parsed: 1.5 } }, path: ["stats", "parsed"] },
  { name: "PlanList response", schema: PlanListResponseSchema, valid: [], invalid: [{ id: plan.id }], path: [0, "title"] },
  { name: "CreatePlan request", schema: CreatePlanRequestSchema, valid: { title: plan.title, goal: plan.goal }, invalid: { title: "", goal: plan.goal }, path: ["title"] },
  { name: "PlanDetail response", schema: PlanDetailResponseSchema, valid: { plan, conformance: null }, invalid: { plan }, path: ["conformance"] },
  { name: "ApplyOperations request", schema: ApplyOperationsRequestSchema, valid: { expectedRevision: 2, operations: [{ op: "upsert_module", path: ".", action: "modify", responsibility: "Wire it up." }, { op: "resolve_comment", commentId: "c1", reply: "Done." }], note: "Answer the review." }, invalid: { expectedRevision: 2, operations: [{ op: "drop_seam", from: logic }] }, path: ["operations", 0, "to"] },
  { name: "ApplyOperations response", schema: ApplyOperationsResponseSchema, valid: { plan, warnings: ["Interface file does not exist yet."] }, invalid: { plan, warnings: "none" }, path: ["warnings"] },
  { name: "SetLock request", schema: SetLockRequestSchema, valid: { locked: true, expectedRevision: 3 }, invalid: { locked: "yes", expectedRevision: 3 }, path: ["locked"] },
  { name: "CheckPlan request", schema: CheckPlanRequestSchema, valid: { final: true }, invalid: { final: 1 }, path: ["final"] },
  { name: "Error response", schema: ErrorResponseSchema, valid: { error: "The plan is at revision 3, not 2.", plan }, invalid: { message: "nope" }, path: ["error"] },
  { name: "PlanContext", schema: PlanContextSchema, valid: { pendingHumanComments: [comment], humanChanges: [revisions[1]], explorerUrl: "http://127.0.0.1:4477/?path=%2Frepo&plan=feature-flags-on-issues-3f2a" }, invalid: { pendingHumanComments: [comment], humanChanges: [] }, path: ["explorerUrl"] },
];

describe.each(cases)("$name", ({ schema, valid, invalid, path }) => {
  test("survives a JSON round trip unchanged", () => {
    expect(schema.parse(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  test("rejects an invalid document at the offending path", () => {
    const parsed = schema.safeParse(invalid);

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toContainEqual(path);
  });
});

test("an interface without symbols reads as an empty symbol list", () => {
  const seam = { ...plan.seams[0], interface: { files: [`${facade}/api.py`] } };

  expect(ArchitecturePlanSchema.parse({ ...plan, seams: [seam] }).seams[0]?.interface?.symbols).toEqual([]);
});
