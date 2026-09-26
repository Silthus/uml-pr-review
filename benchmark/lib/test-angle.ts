import { join } from "node:path";
import { isTestPath } from "../../src/analyzer/extract.ts";
import { round } from "./metric-scores.ts";
import { execute } from "./execute.ts";
import type { PatchedFile } from "./patch.ts";
import type { FunctionMetric } from "./static-quality.ts";

export type DynamicTests = { status: "passed" | "failed"; output: string } | { status: "not run"; reason: string };

export type TestAngle = {
  testLinesAdded: number;
  productionLinesAdded: number;
  testRatio: number | null;
  subjects: string[];
  unreferenced: string[];
  referenceCoverage: number | null;
  dynamic: DynamicTests;
};

const declaredClass = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_]\w*)/;
const anonymous = new Set(["(anonymous)", "__init__", "constructor"]);

export async function testAngle(worktree: string, files: PatchedFile[], changedFunctions: FunctionMetric[], dynamic: DynamicTests): Promise<TestAngle> {
  const tests = files.filter(({ path, status }) => status !== "deleted" && isTestPath(path));
  const production = files.filter(({ path }) => !isTestPath(path));
  const testText = (await Promise.all(tests.map(({ path }) => Bun.file(join(worktree, path)).text()))).join("\n");
  const subjects = subjectsOf(production, changedFunctions);
  const unreferenced = subjects.filter((subject) => !new RegExp(`\\b${subject}\\b`).test(testText));
  const testLinesAdded = sum(tests.map(({ added }) => added));
  const productionLinesAdded = sum(production.map(({ added }) => added));
  return {
    testLinesAdded,
    productionLinesAdded,
    testRatio: productionLinesAdded > 0 ? round(testLinesAdded / productionLinesAdded, 2) : null,
    subjects,
    unreferenced,
    referenceCoverage: subjects.length > 0 ? round((subjects.length - unreferenced.length) / subjects.length, 2) : null,
    dynamic,
  };
}

export function subjectsOf(production: PatchedFile[], changedFunctions: FunctionMetric[]): string[] {
  const productionPaths = new Set(production.map(({ path }) => path));
  const functions = changedFunctions.filter(({ file }) => productionPaths.has(file)).map(({ name }) => name.split(/::|\./).at(-1)!);
  const classes = production.flatMap(({ addedLines }) => addedLines.flatMap((line) => declaredClass.exec(line)?.[1] ?? []));
  return [...new Set([...functions, ...classes])].filter((name) => !anonymous.has(name) && /^[A-Za-z_]\w*$/.test(name)).sort();
}

export async function pytest(worktree: string, repository: string, files: PatchedFile[]): Promise<DynamicTests> {
  const tests = files.filter(({ path, status }) => status !== "deleted" && isTestPath(path) && path.endsWith(".py")).map(({ path }) => path);
  if (tests.length === 0) return { status: "not run", reason: "no changed Python test files" };
  const services = await execute("/", ["docker", "ps", "--format", "{{.Names}}"]);
  if (services.code !== 0 || !/postgres|-db-/.test(services.stdout) || !/clickhouse/.test(services.stdout)) return { status: "not run", reason: "PostHog's postgres and clickhouse services are not running" };
  const python = join(repository, ".venv", "bin", "python");
  if (!(await Bun.file(python).exists())) return { status: "not run", reason: `no PostHog Python environment at ${python}` };
  const result = await execute(worktree, [python, "-m", "pytest", "-q", "-x", ...tests]);
  return { status: result.code === 0 ? "passed" : "failed", output: result.stdout.trim().split("\n").slice(-5).join("\n") };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
