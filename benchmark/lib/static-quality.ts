import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../src/git.ts";
import { mean, round } from "./metric-scores.ts";
import { execute } from "./execute.ts";
import type { PatchedFile } from "./patch.ts";
import { uvxTool } from "./tools.ts";

export type FunctionMetric = { file: string; name: string; signature: string; ccn: number; nloc: number; params: number; tokens: number };

export type Complexity = { changedFunctions: number; maxCcn: number; meanCcn: number; overTen: number; ccnDelta: number };
export type Duplication = { clones: number; duplicatedLines: number; percentage: number };

export type StaticQuality = {
  complexity: Complexity | "unavailable";
  changedFunctions: FunctionMetric[];
  duplication: Duplication | "unavailable";
};

const complexityThreshold = 10;
const measuredSource = /\.(py|tsx?)$/;

export async function staticQuality(worktree: string, base: string, files: PatchedFile[]): Promise<StaticQuality> {
  const lizard = uvxTool("lizard");
  const present = files.filter(({ status, path }) => status !== "deleted" && measuredSource.test(path)).map(({ path }) => path);
  const previous = files.filter(({ status, previousPath }) => status !== "added" && measuredSource.test(previousPath)).map(({ previousPath }) => previousPath);
  const patched = lizard && (await functionMetrics(lizard, worktree, present));
  const before = lizard && (await withBaseFiles(worktree, base, previous, (directory) => functionMetrics(lizard, directory, previous)));
  if (!patched || !before) return { complexity: "unavailable", changedFunctions: [], duplication: await duplication(worktree, present) };
  const changed = changedFunctions(before, patched, renames(files));
  return { complexity: complexityOf(changed, before, renames(files)), changedFunctions: changed, duplication: await duplication(worktree, present) };
}

export function changedFunctions(before: FunctionMetric[], after: FunctionMetric[], renamed: Map<string, string> = new Map()): FunctionMetric[] {
  const previous = new Map(before.map((metric) => [functionKey(metric.file, metric.signature), metric]));
  return after.filter((metric) => {
    const old = previous.get(functionKey(renamed.get(metric.file) ?? metric.file, metric.signature));
    return !old || old.tokens !== metric.tokens || old.ccn !== metric.ccn || old.nloc !== metric.nloc;
  });
}

export function complexityOf(changed: FunctionMetric[], before: FunctionMetric[], renamed: Map<string, string> = new Map()): Complexity {
  const previous = new Map(before.map((metric) => [functionKey(metric.file, metric.signature), metric.ccn]));
  const ccns = changed.map(({ ccn }) => ccn);
  return {
    changedFunctions: changed.length,
    maxCcn: ccns.length > 0 ? Math.max(...ccns) : 0,
    meanCcn: ccns.length > 0 ? round(mean(ccns)) : 0,
    overTen: ccns.filter((ccn) => ccn > complexityThreshold).length,
    ccnDelta: changed.reduce((total, metric) => total + metric.ccn - (previous.get(functionKey(renamed.get(metric.file) ?? metric.file, metric.signature)) ?? 0), 0),
  };
}

export function parseLizardCsv(csv: string, root: string): FunctionMetric[] {
  return csv.split("\n").flatMap((line) => {
    const fields = [...line.matchAll(/"([^"]*)"|([^,]+)/g)].map((match) => match[1] ?? match[2]!);
    if (fields.length < 9 || !/^\d+$/.test(fields[0]!)) return [];
    const [nloc, ccn, tokens, params, , , file, name, signature] = fields;
    return [{ file: file!.replace(`${root}/`, ""), name: name!, signature: signature!, ccn: Number(ccn), nloc: Number(nloc), params: Number(params), tokens: Number(tokens) }];
  });
}

async function functionMetrics(lizard: string[], root: string, files: string[]): Promise<FunctionMetric[] | undefined> {
  if (files.length === 0) return [];
  const result = await execute(root, [...lizard, "--csv", ...files]);
  return result.code === 0 ? parseLizardCsv(result.stdout, root) : undefined;
}

async function withBaseFiles<T>(worktree: string, base: string, files: string[], work: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "bench-base-"));
  try {
    for (const file of files) await Bun.write(join(directory, file), await git(worktree, ["show", `${base}:${file}`]));
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function duplication(worktree: string, files: string[]): Promise<StaticQuality["duplication"]> {
  if (files.length === 0) return { clones: 0, duplicatedLines: 0, percentage: 0 };
  const output = await mkdtemp(join(tmpdir(), "bench-jscpd-"));
  try {
    const result = await execute(worktree, ["bunx", "jscpd", "--silent", "--reporters", "json", "--output", output, ...files]);
    const report = Bun.file(join(output, "jscpd-report.json"));
    if (result.code !== 0 || !(await report.exists())) return "unavailable";
    const { clones, duplicatedLines, percentage } = ((await report.json()) as { statistics: { total: Duplication } }).statistics.total;
    return { clones, duplicatedLines, percentage: round(percentage) };
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

function renames(files: PatchedFile[]): Map<string, string> {
  return new Map(files.filter(({ status }) => status === "renamed").map(({ path, previousPath }) => [path, previousPath]));
}

function functionKey(file: string, signature: string): string {
  return `${file}\0${signature}`;
}
