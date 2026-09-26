import { randomUUID } from "node:crypto";
import { copyFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, hasRevision } from "./git.ts";

export type Snapshotter = (worktree: string) => Promise<string>;

type IndexEntryState = { path: string; assumeUnchanged: boolean; skipWorktree: boolean };
type TemporaryIndex = { worktree: string; env: Record<string, string>; sparse: string[] };

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
  const temporaryIndexFile = join(tmpdir(), `uml-pr-review-${randomUUID()}.index`);
  const env = { GIT_INDEX_FILE: temporaryIndexFile };
  try {
    await seedIndex(worktree, temporaryIndexFile, env);
    const index: TemporaryIndex = { worktree, env, sparse: (await isSparseCheckout(worktree)) ? ["--sparse"] : [] };
    await revealHiddenFiles(index);
    await git(worktree, ["add", "--all", ...index.sparse], { env });
    return (await git(worktree, ["write-tree"], { env })).trim();
  } finally {
    await rm(temporaryIndexFile, { force: true });
    await rm(`${temporaryIndexFile}.lock`, { force: true });
  }
}

async function seedIndex(worktree: string, temporaryIndexFile: string, env: Record<string, string>) {
  const realIndex = (await git(worktree, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim();
  if (await Bun.file(realIndex).exists()) await copyFile(realIndex, temporaryIndexFile);
  else if (await hasRevision(worktree, "HEAD")) await git(worktree, ["read-tree", "HEAD"], { env });
  else await git(worktree, ["read-tree", "--empty"], { env });
}

function isSparseCheckout(worktree: string): Promise<boolean> {
  return git(worktree, ["config", "--bool", "core.sparseCheckout"]).then(
    (value) => value.trim() === "true",
    () => false,
  );
}

async function revealHiddenFiles(index: TemporaryIndex) {
  const entries = await flaggedEntries(index);
  const skippedButPresent = await filterAsync(
    entries.filter(({ skipWorktree }) => skipWorktree),
    ({ path }) => existsInWorktree(index.worktree, path),
  );
  await clearFlag(index, "--no-assume-unchanged", entries.filter(({ assumeUnchanged }) => assumeUnchanged));
  await clearFlag(index, "--no-skip-worktree", skippedButPresent);
}

async function flaggedEntries(index: TemporaryIndex): Promise<IndexEntryState[]> {
  const entries = await listedEntries(index, index.sparse);
  const collapsed = entries.filter(isSparseDirectory);
  const expandable = await filterAsync(collapsed, ({ path }) => existsInWorktree(index.worktree, path));
  const expanded = expandable.length === 0 ? [] : await listedEntries(index, ["--", ...expandable.map(({ path }) => path)]);
  return [...entries.filter((entry) => !isSparseDirectory(entry)), ...expanded].filter(({ assumeUnchanged, skipWorktree }) => assumeUnchanged || skipWorktree);
}

async function listedEntries({ worktree, env }: TemporaryIndex, options: string[]): Promise<IndexEntryState[]> {
  const output = await git(worktree, ["ls-files", "-v", "-z", ...options], { env });
  return output.split("\0").filter(Boolean).map(entryState);
}

function entryState(record: string): IndexEntryState {
  const tag = record.slice(0, record.indexOf(" "));
  return { path: record.slice(tag.length + 1), assumeUnchanged: tag !== tag.toUpperCase(), skipWorktree: skipWorktreeTags.has(tag) };
}

function isSparseDirectory({ path }: IndexEntryState): boolean {
  return path.endsWith("/");
}

async function clearFlag({ worktree, env }: TemporaryIndex, flag: string, entries: IndexEntryState[]) {
  if (entries.length === 0) return;
  const input = entries.map(({ path }) => `${path}\0`).join("");
  await git(worktree, ["update-index", flag, "-z", "--stdin"], { env, input });
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
