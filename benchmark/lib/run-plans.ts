import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { commonDir } from "./scratch-worktree.ts";

export async function plansDirectory(repository: string): Promise<string> {
  return join(await commonDir(repository), "uml-pr-review", "plans");
}

export async function planFiles(directory: string): Promise<Set<string>> {
  return new Set(await readdir(directory).catch(() => [] as string[]));
}

export async function removeRunPlans(directory: string, before: Set<string>, transcript: string): Promise<string[]> {
  const created = [...(await planFiles(directory))].filter((file) => !before.has(file));
  const ownIds = new Set(created.map(planIdOf).filter((id) => transcript.includes(id)));
  await Promise.all(created.filter((file) => ownIds.has(planIdOf(file))).map((file) => rm(join(directory, file), { force: true })));
  return [...ownIds].sort();
}

function planIdOf(file: string): string {
  return file.split(".")[0]!;
}
