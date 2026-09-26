import { randomUUID } from "node:crypto";
import { copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, hasRevision } from "./git.ts";

export type Snapshotter = (worktree: string) => Promise<string>;

export function createSnapshotter(): Snapshotter {
  const queues = new Map<string, Promise<unknown>>();
  return (worktree) => {
    const snapshot = (queues.get(worktree) ?? Promise.resolve()).catch(() => undefined).then(() => writeWorkingTree(worktree));
    queues.set(worktree, snapshot);
    return snapshot;
  };
}

async function writeWorkingTree(worktree: string): Promise<string> {
  const temporaryIndex = join(tmpdir(), `uml-pr-review-${randomUUID()}.index`);
  const environment = { GIT_INDEX_FILE: temporaryIndex };
  try {
    await seedIndex(worktree, temporaryIndex, environment);
    await git(worktree, ["add", "--all"], environment);
    return (await git(worktree, ["write-tree"], environment)).trim();
  } finally {
    await rm(temporaryIndex, { force: true });
    await rm(`${temporaryIndex}.lock`, { force: true });
  }
}

async function seedIndex(worktree: string, temporaryIndex: string, environment: Record<string, string>) {
  const realIndex = (await git(worktree, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim();
  if (await Bun.file(realIndex).exists()) await copyFile(realIndex, temporaryIndex);
  else if (await hasRevision(worktree, "HEAD")) await git(worktree, ["read-tree", "HEAD"], environment);
  else await git(worktree, ["read-tree", "--empty"], environment);
}
