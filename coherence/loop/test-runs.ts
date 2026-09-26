import { existsSync, readdirSync, readFileSync } from "node:fs";
import { rm, symlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { execute } from "../../benchmark/lib/execute.ts";
import type { ArchitecturePayload } from "../../src/architecture/contracts/index.ts";

export type TestRun = { runner: "pytest" | "jest"; files: string[]; status: "passed" | "failed" | "not run"; reason: string | null; output: string };

const python = /\.py$/;
const script = /\.[jt]sx?$/;
const unreachableService = /(could not connect to server|connection refused|connection to server at .* failed|is the server running|error 61 connecting)/i;
const failingTestsSummary = /\b\d+ failed\b.* in \d+(\.\d+)?s\b/;
const noTestsFound = /No tests found/;
const jestConfigs = ["jest.config.ts", "jest.config.js", "jest.config.mjs", "jest.config.cjs"];
const outputTail = 2_000;
const testTimeoutMs = 10 * 60_000;

export function testsFor(head: ArchitecturePayload, changed: string[]): string[] {
  const changedFiles = new Set(changed);
  const isTest = (file: number) => head.files[file]![3] === "test";
  const touched = head.files.flatMap(([path], file) => (isTest(file) && changedFiles.has(path) ? [path] : []));
  const covering = head.imports.flatMap(([from, to]) => (isTest(from) && changedFiles.has(head.files[to]![0]) ? [head.files[from]![0]] : []));
  return [...new Set([...touched, ...covering])].sort();
}

export async function runTests(workspace: string, mainCheckout: string, tests: string[]): Promise<TestRun[]> {
  const pythonTests = tests.filter((file) => python.test(file));
  const scriptTests = tests.filter((file) => script.test(file));
  return [
    ...(pythonTests.length > 0 ? [await pytest(workspace, mainCheckout, pythonTests)] : []),
    ...(scriptTests.length > 0 ? await jest(workspace, mainCheckout, scriptTests) : []),
  ];
}

async function pytest(workspace: string, mainCheckout: string, files: string[]): Promise<TestRun> {
  const command = pytestCommand(workspace, mainCheckout);
  if (command === null) return notRun("pytest", files, `no Python test environment: no uv to sync ${join(workspace, "uv.lock")}, and none of ${borrowedPytests(workspace, mainCheckout).join(", ")} exists`);
  const result = await execute(workspace, [...command, "-q", "-p", "no:cacheprovider", ...files], undefined, testTimeoutMs);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code === 0) return { runner: "pytest", files, status: "passed", reason: null, output: tail(output) };
  const service = unreachableService.exec(output)?.[0];
  if (service !== undefined) return notRun("pytest", files, `a service the tests need is not reachable locally (${service})`, output);
  if (result.code === 1 && failingTestsSummary.test(output)) return { runner: "pytest", files, status: "failed", reason: null, output: tail(output) };
  return notRun("pytest", files, result.code === 5 ? "pytest collected no tests" : `pytest ran no test (exit ${result.code}): ${lastLine(output)}`, output);
}

function pytestCommand(workspace: string, mainCheckout: string): string[] | null {
  const uv = existsSync(join(workspace, "uv.lock")) ? uvBinary(workspace, mainCheckout) : null;
  if (uv !== null) return ["env", "-u", "VIRTUAL_ENV", `UV_PROJECT_ENVIRONMENT=${join(workspace, ".venv")}`, "GIT_CONFIG_GLOBAL=/dev/null", uv, "run", "--quiet", "--frozen", "pytest"];
  const borrowed = borrowedPytests(workspace, mainCheckout).find((candidate) => existsSync(candidate));
  return borrowed === undefined ? null : [borrowed];
}

function uvBinary(workspace: string, mainCheckout: string): string | null {
  const floxUv = [workspace, mainCheckout].flatMap(floxEnvironments).map((environment) => join(environment, "bin", "uv"));
  return floxUv.find((candidate) => existsSync(candidate)) ?? Bun.which("uv");
}

function floxEnvironments(root: string): string[] {
  const environments = join(root, ".flox", "run");
  return existsSync(environments) ? readdirSync(environments).map((name) => join(environments, name)) : [];
}

function borrowedPytests(workspace: string, mainCheckout: string): string[] {
  return [workspace, mainCheckout].map((root) => join(root, ".flox", "cache", "venv", "bin", "pytest"));
}

async function jest(workspace: string, mainCheckout: string, files: string[]): Promise<TestRun[]> {
  const byPackage = Map.groupBy(files, (file) => jestPackage(workspace, dirname(file)));
  return Promise.all([...byPackage].map(([packageDirectory, packageFiles]) => jestIn(workspace, mainCheckout, packageDirectory, packageFiles)));
}

async function jestIn(workspace: string, mainCheckout: string, packageDirectory: string | null, files: string[]): Promise<TestRun> {
  if (packageDirectory === null) return notRun("jest", files, `no jest config above ${dirname(files[0]!)} or at the top level of the repository covers it`);
  const installed = join(workspace, packageDirectory, "node_modules");
  const borrowed = join(mainCheckout, packageDirectory, "node_modules");
  const linked = !existsSync(join(installed, ".bin", "jest")) && existsSync(join(borrowed, ".bin", "jest"));
  if (!linked && !existsSync(join(installed, ".bin", "jest"))) return notRun("jest", files, `jest is installed in neither ${installed} nor ${borrowed}`);
  if (linked) await symlink(borrowed, installed);
  try {
    const root = join(workspace, packageDirectory);
    const result = await execute(root, [join(installed, ".bin", "jest"), "--ci", ...files.map((file) => relative(root, join(workspace, file)))], undefined, testTimeoutMs);
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.code !== 0 && noTestsFound.test(output)) return notRun("jest", files, `jest in ${packageDirectory} found none of these tests`, output);
    return { runner: "jest", files, status: result.code === 0 ? "passed" : "failed", reason: null, output: tail(output) };
  } finally {
    if (linked) await rm(installed);
  }
}

function jestPackage(workspace: string, directory: string): string | null {
  for (let current = directory; current !== "."; current = dirname(current)) {
    if (jestConfigIn(workspace, current) !== null) return current;
  }
  const topLevel = `/${directory.split("/")[0]}`;
  return topLevelDirectories(workspace).find((candidate) => jestConfigIn(workspace, candidate)?.includes(topLevel)) ?? null;
}

function jestConfigIn(workspace: string, directory: string): string | null {
  const name = jestConfigs.find((config) => existsSync(join(workspace, directory, config)));
  return name === undefined ? null : readFileSync(join(workspace, directory, name), "utf8");
}

function topLevelDirectories(workspace: string): string[] {
  return readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
}

function notRun(runner: TestRun["runner"], files: string[], reason: string, output = ""): TestRun {
  return { runner, files, status: "not run", reason, output: tail(output) };
}

function lastLine(output: string): string {
  return output.trim().split("\n").at(-1) ?? "no output";
}

function tail(output: string): string {
  return output.trim().slice(-outputTail);
}
