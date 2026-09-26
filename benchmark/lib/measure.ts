import { join } from "node:path";
import type { RepositoryIndexer } from "../../src/architecture/index/index.ts";
import { boundaryHygiene, type BoundaryHygiene } from "./boundary.ts";
import { buildSanity, type BuildSanity } from "./build-sanity.ts";
import { focus, type Focus } from "./focus.ts";
import { indexViewOf } from "./index-view.ts";
import { parsePatch, type PatchedFile } from "./patch.ts";
import { withPatchedWorktree, type Application } from "./scratch-worktree.ts";
import { staticQuality, type StaticQuality } from "./static-quality.ts";
import { parseTach } from "./tach.ts";
import { pytest, testAngle, type TestAngle } from "./test-angle.ts";

export type ArmMeasure = {
  application: Application;
  applyError?: string;
  files: string[];
  boundary?: BoundaryHygiene;
  focus?: Focus;
  build?: BuildSanity;
  staticQuality?: StaticQuality;
  tests?: TestAngle;
};

export type MeasureRequest = { repository: string; base: string; patch: string; scratch: string; indexer: RepositoryIndexer };

export async function measureArm({ repository, base, patch, scratch, indexer }: MeasureRequest): Promise<ArmMeasure> {
  const files = parsePatch(patch);
  const paths = files.map(({ path }) => path);
  if (files.length === 0) return { application: "empty", files: paths };
  return withPatchedWorktree(repository, scratch, base, patch, async (worktree, applied) => {
    if (applied.application === "failed") return { ...applied, files: paths };
    const quality = await staticQuality(worktree, base, files);
    return {
      application: applied.application,
      files: paths,
      ...(await architectureOf(worktree, base, files, indexer)),
      build: await buildSanity(worktree, present(files).filter(isPython)),
      staticQuality: quality,
      tests: await testAngle(worktree, files, quality.changedFunctions, await pytest(worktree, repository, files)),
    };
  });
}

async function architectureOf(worktree: string, base: string, files: PatchedFile[], indexer: RepositoryIndexer): Promise<Pick<ArmMeasure, "boundary" | "focus">> {
  const baseIndex = indexViewOf(await indexer.index(worktree, { commit: base }));
  const patchedIndex = indexViewOf(await indexer.index(worktree, "working-tree"));
  const tach = parseTach(await Bun.file(join(worktree, "tach.toml")).text());
  return { boundary: boundaryHygiene(baseIndex, patchedIndex, tach, present(files)), focus: focus(baseIndex, patchedIndex, tach, files) };
}

function present(files: PatchedFile[]): string[] {
  return files.filter(({ status }) => status !== "deleted").map(({ path }) => path);
}

function isPython(path: string): boolean {
  return path.endsWith(".py");
}
