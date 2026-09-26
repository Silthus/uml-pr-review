import { homedir } from "node:os";
import { join } from "node:path";
import { git, run } from "../../src/git.ts";
import { execute } from "./execute.ts";

export const posthogRepository = process.env.BENCH_POSTHOG ?? join(homedir(), "dev", "posthog");

export type Application = "empty" | "clean" | "three-way" | "failed";
export type Applied = { application: Application; applyError?: string };

export async function addScratchWorktree(repository: string, path: string, commit: string): Promise<void> {
  if (await Bun.file(join(path, ".git")).exists()) throw new Error(`${path} already exists; remove it or pick another run index.`);
  await git(repository, ["worktree", "add", "--detach", "--quiet", path, commit]);
}

export async function removeScratchWorktree(repository: string, path: string): Promise<void> {
  await git(repository, ["worktree", "remove", "--force", path]).catch(() => undefined);
  await run("/", ["chmod", "-R", "u+w", path]).catch(() => undefined);
  await run("/", ["rm", "-rf", path]).catch(() => undefined);
  await git(repository, ["worktree", "prune"]);
}

export async function withPatchedWorktree<T>(repository: string, path: string, commit: string, patch: string, work: (path: string, applied: Applied) => Promise<T>): Promise<T> {
  await addScratchWorktree(repository, path, commit);
  try {
    return await work(path, await applyPatch(path, patch));
  } finally {
    await removeScratchWorktree(repository, path);
  }
}

export async function commonDir(repository: string): Promise<string> {
  return (await git(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
}

export async function workingTreeDiff(worktree: string, base: string): Promise<string> {
  await git(worktree, ["add", "--all", "--intent-to-add"]);
  return git(worktree, ["diff", "--binary", base]);
}

async function applyPatch(worktree: string, patch: string): Promise<Applied> {
  const clean = await execute(worktree, ["git", "apply", "--binary", "--whitespace=nowarn", "-"], patch);
  if (clean.code === 0) return { application: "clean" };
  const threeWay = await execute(worktree, ["git", "apply", "--binary", "--3way", "--whitespace=nowarn", "-"], patch);
  if (threeWay.code === 0) return { application: "three-way" };
  return { application: "failed", applyError: threeWay.stderr.trim() };
}
