import { randomUUID } from "node:crypto";
import { copyFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, hasRevision } from "./git.ts";

export type Snapshotter = (worktree: string) => Promise<string>;

type IndexEntryState = { path: string; assumeUnchanged: boolean; skipWorktree: boolean };

const skipWorktreeTags = new Set(["S", "s"]);

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
  const env = { GIT_INDEX_FILE: temporaryIndex };
  try {
    await seedIndex(worktree, temporaryIndex, env);
    await revealHiddenFiles(worktree, env);
    await git(worktree, ["add", "--all", "--sparse"], { env });
    return (await git(worktree, ["write-tree"], { env })).trim();
  } finally {
    await rm(temporaryIndex, { force: true });
    await rm(`${temporaryIndex}.lock`, { force: true });
  }
}

async function seedIndex(worktree: string, temporaryIndex: string, env: Record<string, string>) {
  const realIndex = (await git(worktree, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim();
  if (await Bun.file(realIndex).exists()) await copyFile(realIndex, temporaryIndex);
  else if (await hasRevision(worktree, "HEAD")) await git(worktree, ["read-tree", "HEAD"], { env });
  else await git(worktree, ["read-tree", "--empty"], { env });
}

async function revealHiddenFiles(worktree: string, env: Record<string, string>) {
  const entries = await flaggedEntries(worktree, env);
  const skippedButPresent = await filterAsync(
    entries.filter(({ skipWorktree }) => skipWorktree),
    ({ path }) => existsInWorktree(worktree, path),
  );
  await clearFlag(worktree, env, "--no-assume-unchanged", entries.filter(({ assumeUnchanged }) => assumeUnchanged));
  await clearFlag(worktree, env, "--no-skip-worktree", skippedButPresent);
}

async function clearFlag(worktree: string, env: Record<string, string>, flag: string, entries: IndexEntryState[]) {
  if (entries.length === 0) return;
  const input = entries.map(({ path }) => `${path}\0`).join("");
  await git(worktree, ["update-index", flag, "-z", "--stdin"], { env, input });
}

async function flaggedEntries(worktree: string, env: Record<string, string>): Promise<IndexEntryState[]> {
  const output = await git(worktree, ["ls-files", "-v", "-z"], { env });
  return output
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const tag = record.slice(0, record.indexOf(" "));
      return { path: record.slice(tag.length + 1), assumeUnchanged: tag !== tag.toUpperCase(), skipWorktree: skipWorktreeTags.has(tag) };
    })
    .filter(({ assumeUnchanged, skipWorktree }) => assumeUnchanged || skipWorktree);
}

function existsInWorktree(worktree: string, path: string): Promise<boolean> {
  return lstat(join(worktree, path)).then(
    () => true,
    () => false,
  );
}

async function filterAsync<Item>(items: Item[], keep: (item: Item) => Promise<boolean>): Promise<Item[]> {
  const kept = await Promise.all(items.map(keep));
  return items.filter((_, index) => kept[index]);
}
