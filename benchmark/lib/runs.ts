import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadTask, type Task } from "./task.ts";

export const benchmarkDir = join(import.meta.dir, "..");
export const runsRoot = join(benchmarkDir, "runs");

export type ArmRun = { name: string; arm: string; dir: string };

export function taskRunsDir(key: string): string {
  return join(runsRoot, key);
}

export async function snapshotTask(taskDir: string, task: Task): Promise<void> {
  await mkdir(taskDir, { recursive: true });
  await writeJson(join(taskDir, "task.json"), task);
}

export function loadRunTask(taskDir: string): Promise<Task> {
  return loadTask(join(taskDir, "task.json"));
}

export async function armRuns(taskDir: string): Promise<ArmRun[]> {
  const entries = await readdir(taskDir, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const withDiffs = await Promise.all(names.map(async (name) => ((await Bun.file(join(taskDir, name, "diff.patch")).exists()) ? [name] : [])));
  return withDiffs
    .flat()
    .sort()
    .map((name) => ({ name, arm: name.split("-")[0]!, dir: join(taskDir, name) }));
}

export async function taskDirs(): Promise<string[]> {
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("_")).map((entry) => join(runsRoot, entry.name));
  const withTasks = await Promise.all(dirs.map(async (dir) => ((await Bun.file(join(dir, "task.json")).exists()) ? [dir] : [])));
  return withTasks.flat().sort();
}

export async function nextRunIndex(taskDir: string, arm: string): Promise<number> {
  const entries = await readdir(taskDir).catch(() => [] as string[]);
  const used = entries.flatMap((name) => new RegExp(`^${arm}-(\\d+)$`).exec(name)?.[1] ?? []).map(Number);
  return Math.max(0, ...used) + 1;
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  const file = Bun.file(path);
  return (await file.exists()) ? ((await file.json()) as T) : undefined;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}
