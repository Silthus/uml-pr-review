import {
  ArchitecturePlanSchema,
  type ArchitecturePlan,
  type ChangedFile,
  type Interface,
  type PlannedModule,
  type Seam,
} from "../../../src/architecture/contracts/index.ts";

type ModuleSpec = { path: string; action: PlannedModule["action"]; responsibility?: string };
type SeamSpec = { from: string; to: string; action: Seam["action"]; interface?: { files: string[]; symbols?: Interface["symbols"] } };

export function planOf({ status = "locked", modules = [], seams = [] }: { status?: ArchitecturePlan["status"]; modules?: ModuleSpec[]; seams?: SeamSpec[] }): ArchitecturePlan {
  const at = "2026-09-26T10:00:00.000Z";
  return ArchitecturePlanSchema.parse({
    version: 1,
    id: "feature-flags-on-issues-3f2a",
    title: "Feature flags on issues",
    goal: "Show feature flag usage on error tracking issues.",
    baseCommit: "b".repeat(40),
    status,
    revision: 1,
    modules: modules
      .map(({ path, action, responsibility = "show feature flag usage on issues" }) => ({ path, action, responsibility, origin: "agent" }))
      .sort((a, b) => compare(a.path, b.path)),
    seams: seams.map((seam) => ({ ...seam, origin: "agent" })).sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to)),
    comments: [],
    revisions: [{ number: 1, at, actor: "agent", kind: "create", operations: [] }],
    createdAt: at,
    updatedAt: at,
  });
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function modified(path: string, firstChangedLine = 1): ChangedFile {
  return { path, status: "modified", firstChangedLine };
}

export function added(path: string): ChangedFile {
  return { path, status: "added", firstChangedLine: 1 };
}

export function deleted(path: string): ChangedFile {
  return { path, status: "deleted", firstChangedLine: 1 };
}
