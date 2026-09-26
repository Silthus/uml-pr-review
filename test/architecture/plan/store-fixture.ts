import { afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "../../../src/architecture/contracts/index.ts";
import { ArchitectureModel } from "../../../src/architecture/model/index.ts";
import { openPlanStore, type PlanStore } from "../../../src/architecture/plan/index.ts";
import { architectureOf } from "../../support/architecture.ts";

export const baseCommit = "b0a1c2d3e4f5061728394a5b6c7d8e9f00112233";
export const base7 = "b0a1c2d";

export const logic = "products/error_tracking/backend/logic";
export const errorTrackingModels = "products/error_tracking/backend/models";
export const flags = "products/feature_flags";
export const flagsFacade = "products/feature_flags/backend/facade";
export const flagsModels = "products/feature_flags/backend/models";
export const flagsApi = `${flagsFacade}/api.py`;

export const base = new ArchitectureModel(
  architectureOf(
    {
      [`${logic}/issues.py`]: [`${errorTrackingModels}/issue.py`, flagsApi],
      [`${logic}/tests/test_issues.py`]: [`${flagsModels}/feature_flag.py`],
      [`${errorTrackingModels}/issue.py`]: [],
      [flagsApi]: [`${flagsModels}/feature_flag.py`],
      [`${flagsModels}/feature_flag.py`]: [],
      "posthog/models/team.py": [],
    },
    { commit: baseCommit },
  ),
);

export type StoreFixture = { store: PlanStore; directory: string };

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

export async function freshStore(): Promise<StoreFixture> {
  const directory = join(await mkdtemp(join(tmpdir(), "uml-pr-review-plans-")), "uml-pr-review", "plans");
  directories.push(join(directory, "..", ".."));
  return { store: openPlanStore(directory, minuteClock()), directory };
}

export function minuteClock(): () => Date {
  let minute = 0;
  return () => new Date(Date.UTC(2026, 8, 26, 10, minute++));
}

export function at(minute: number): string {
  return new Date(Date.UTC(2026, 8, 26, 10, minute)).toISOString();
}

export async function draft(store: PlanStore, actor: Actor = "agent") {
  return store.create({ title: "Feature flags on issues", goal: "Show feature flag usage on error tracking issues.", baseCommit, actor, client: "claude-code@2.1.0" });
}
