import { join } from "node:path";
import type { RepositoryIndexer } from "../../src/architecture/index/index.ts";
import { boundaryHygiene, type BoundaryHygiene } from "./boundary.ts";
import { buildSanity, type BuildSanity } from "./build-sanity.ts";
import { execute } from "./execute.ts";
import { focus, type Focus } from "./focus.ts";
import { indexViewOf } from "./index-view.ts";
import { parsePatch } from "./patch.ts";
import { withScratchWorktree } from "./scratch-worktree.ts";
import { parseTach } from "./tach.ts";

export type Application = "empty" | "clean" | "three-way" | "failed";

export type ArmMeasure = {
  application: Application;
  applyError?: string;
  boundary?: BoundaryHygiene;
  focus?: Focus;
  build?: BuildSanity;
};

export type MeasureRequest = { repository: string; base: string; patch: string; scratch: string; indexer: RepositoryIndexer };

export async function measureArm({ repository, base, patch, scratch, indexer }: MeasureRequest): Promise<ArmMeasure> {
  const files = parsePatch(patch);
  if (files.length === 0) return { application: "empty" };
  return withScratchWorktree(repository, scratch, base, async (worktree) => {
    const applied = await applyPatch(worktree, patch);
    if (applied.application === "failed") return applied;
    const [baseIndex, patchedIndex] = [indexViewOf(await indexer.index(worktree, { commit: base })), indexViewOf(await indexer.index(worktree, "working-tree"))];
    const tach = parseTach(await Bun.file(join(worktree, "tach.toml")).text());
    const present = files.filter(({ status }) => status !== "deleted").map(({ path }) => path);
    return {
      application: applied.application,
      boundary: boundaryHygiene(baseIndex, patchedIndex, tach, present),
      focus: focus(baseIndex, patchedIndex, tach, files),
      build: await buildSanity(worktree, present.filter(isPython)),
    };
  });
}

async function applyPatch(worktree: string, patch: string): Promise<Pick<ArmMeasure, "application" | "applyError">> {
  const clean = await execute(worktree, ["git", "apply", "--binary", "--whitespace=nowarn", "-"], patch);
  if (clean.code === 0) return { application: "clean" };
  const threeWay = await execute(worktree, ["git", "apply", "--binary", "--3way", "--whitespace=nowarn", "-"], patch);
  if (threeWay.code === 0) return { application: "three-way" };
  return { application: "failed", applyError: threeWay.stderr.trim() };
}

function isPython(path: string): boolean {
  return path.endsWith(".py");
}
