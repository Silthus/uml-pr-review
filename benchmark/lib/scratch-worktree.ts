import { homedir } from "node:os";
import { join } from "node:path";
import { git, run } from "../../src/git.ts";

export const posthogRepository = process.env.BENCH_POSTHOG ?? join(homedir(), "dev", "posthog");

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

export async function withScratchWorktree<T>(repository: string, path: string, commit: string, work: (path: string) => Promise<T>): Promise<T> {
  await addScratchWorktree(repository, path, commit);
  try {
    return await work(path);
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
