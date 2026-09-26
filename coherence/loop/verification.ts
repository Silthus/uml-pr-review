import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { execute } from "../../benchmark/lib/execute.ts";
import { createRepositoryIndexer } from "../../src/architecture/index/index.ts";
import { git, readBlobs } from "../../src/git.ts";
import { BlobCache } from "../blob-cache.ts";
import type { CoherenceReport } from "../contract.ts";
import { lintFindings, oxlint, ruff } from "../lint.ts";
import { measureCoherence } from "../measure.ts";
import type { ScopeFile } from "../scope.ts";
import { withToolbox } from "../tools.ts";
import type { RecipeStep } from "../signals/recipe.ts";
import type { IndexDelta } from "./ledger.ts";
import type { Iteration } from "./state.ts";

export type TestRun = { runner: "pytest" | "jest"; files: string[]; status: "passed" | "failed" | "not run"; reason: string | null; output: string };
export type LintPass = { status: "run"; files: number; before: number; after: number } | { status: "not run"; reason: string };
export type Changes = { commits: number; files: string[]; added: number; deleted: number; lines: number; maxLines: number; movedLines: number };
export type IndexCheck = IndexDelta & { targeted: Dimension[]; regressed: Dimension[] };

export type Verification = {
  head: string;
  changes: Changes;
  busyFilesTouched: string[];
  outsideScope: string[];
  lint: LintPass;
  tests: TestRun[];
  index: IndexCheck;
  verdict: "pass" | "fail";
  problems: string[];
};

type Dimension = "architecture" | "complexity" | "smells" | "tests";

export const defaultMaxLines = 300;

const dimensions: Dimension[] = ["architecture", "complexity", "smells", "tests"];
const targetedDimensions: Record<RecipeStep, Dimension[]> = {
  facade: ["architecture"],
  "characterisation-tests": ["tests"],
  "ratchet-rule": ["architecture", "smells"],
  "internal-cleanup": ["complexity", "smells"],
};
const python = /\.py$/;
const script = /\.[jt]sx?$/;
const unavailableService = /(could not connect to server|connection refused|OperationalError|ClickHouse.*(refused|unavailable)|Redis.*(refused|Error 61)|kafka.*(refused|unavailable))/i;
const outputTail = 2_000;
const testTimeoutMs = 10 * 60_000;

export async function verify(iteration: Iteration, maxLines = defaultMaxLines): Promise<Verification> {
  const workspace = iteration.workspace;
  if (workspace === null) throw new Error("this iteration has no workspace yet; run bun coherence/loop/workspace.ts first");
  const base = iteration.base.commit;
  const head = (await git(workspace.path, ["rev-parse", "HEAD"])).trim();
  const changes = await changesOf(workspace.path, base, head, maxLines);
  if (changes.commits === 0) throw new Error(`${workspace.branch} has no commit on top of ${iteration.base.ref}; commit the change first`);
  const busy = new Set(iteration.target.busyFiles.map(({ path }) => path));
  const busyFilesTouched = changes.files.filter((file) => busy.has(file));
  const outsideScope = changes.files.filter((file) => !file.startsWith(`${iteration.scope}/`));
  const [dirty, lint, tests, index] = await Promise.all([
    git(workspace.path, ["status", "--porcelain"]),
    lintPass(workspace.path, base, head, changes.files),
    testRuns(workspace.path, head, changes.files),
    indexCheck(iteration, workspace.path, head, changes.files),
  ]);
  const problems = [
    ...(dirty.trim() === "" ? [] : ["the workspace has uncommitted changes; commit or discard them"]),
    ...(changes.lines > maxLines ? [`${changes.lines} changed lines exceed the budget of ${maxLines}; split the change`] : []),
    ...(busyFilesTouched.length > 0 ? [`the change touches files that active pull requests touch: ${busyFilesTouched.join(", ")}`] : []),
    ...(outsideScope.length > 0 ? [`the change leaves ${iteration.scope}: ${outsideScope.join(", ")}`] : []),
    ...(lint.status === "run" && lint.after > lint.before ? [`the change adds ${lint.after - lint.before} lint findings in the files it touches`] : []),
    ...tests.filter(({ status }) => status === "failed").map(({ runner, files }) => `${runner} fails on ${files.join(", ")}`),
    ...index.regressed.map((dimension) => `the ${dimension} score of ${index.scope} drops from ${index.dimensions[dimension]!.before} to ${index.dimensions[dimension]!.after}`),
  ];
  return { head, changes, busyFilesTouched, outsideScope, lint, tests, index, verdict: problems.length === 0 ? "pass" : "fail", problems };
}

async function changesOf(workspace: string, base: string, head: string, maxLines: number): Promise<Changes> {
  const [count, numstat, patch] = await Promise.all([
    git(workspace, ["rev-list", "--count", `${base}..${head}`]),
    git(workspace, ["diff", "--no-renames", "--numstat", base, head]),
    git(workspace, ["diff", "--no-renames", "--unified=0", base, head]),
  ]);
  const rows = numstat.split("\n").filter(Boolean).map((line) => line.split("\t"));
  const added = rows.reduce((total, [lines]) => total + (Number(lines) || 0), 0);
  const deleted = rows.reduce((total, [, lines]) => total + (Number(lines) || 0), 0);
  return { commits: Number(count.trim()), files: rows.map(([, , path]) => path!), added, deleted, lines: added + deleted, maxLines, movedLines: movedLines(patch) };
}

function movedLines(patch: string): number {
  const lines = patch.split("\n").filter((line) => !line.startsWith("+++") && !line.startsWith("---"));
  const added = new Map<string, number>();
  for (const line of lines.filter((candidate) => candidate.startsWith("+"))) {
    const text = line.slice(1).trim();
    if (text !== "") added.set(text, (added.get(text) ?? 0) + 1);
  }
  let moved = 0;
  for (const line of lines.filter((candidate) => candidate.startsWith("-"))) {
    const text = line.slice(1).trim();
    const left = added.get(text) ?? 0;
    if (text !== "" && left > 0) {
      added.set(text, left - 1);
      moved += 1;
    }
  }
  return moved;
}

async function lintPass(workspace: string, base: string, head: string, files: string[]): Promise<LintPass> {
  const linted = files.filter((file) => python.test(file) || script.test(file));
  try {
    const [before, after] = [await findingsAt(workspace, base, linted), await findingsAt(workspace, head, linted)];
    return { status: "run", files: linted.length, before, after };
  } catch (error) {
    return { status: "not run", reason: error instanceof Error ? error.message : String(error) };
  }
}

async function findingsAt(workspace: string, commit: string, paths: string[]): Promise<number> {
  const files = await scopeFilesAt(workspace, commit, paths);
  if (files.length === 0) return 0;
  const cache = new BlobCache((await git(workspace, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim());
  try {
    return await withToolbox(workspace, files, async (toolbox) => {
      const pythonFindings = await lintFindings(files.filter(({ path }) => python.test(path)), toolbox, cache, ruff);
      const scriptFindings = await lintFindings(files.filter(({ path }) => script.test(path)), toolbox, cache, oxlint);
      return pythonFindings.count + scriptFindings.count;
    });
  } finally {
    cache.close();
  }
}

async function scopeFilesAt(workspace: string, commit: string, paths: string[]): Promise<ScopeFile[]> {
  if (paths.length === 0) return [];
  const listing = await git(workspace, ["ls-tree", commit, "--", ...paths]);
  const shas = new Map(listing.split("\n").filter(Boolean).map((line) => [line.slice(line.indexOf("\t") + 1), line.split(/\s+/)[2]!]));
  const texts = await readBlobs(workspace, commit, [...shas.keys()]);
  return [...shas].map(([path, sha]) => {
    const text = texts.get(path) ?? "";
    return { path, sha, original: text, text, lines: text.split("\n").filter((line) => line.trim() !== "").length, generatedLines: 0 };
  });
}

async function testRuns(workspace: string, head: string, changed: string[]): Promise<TestRun[]> {
  const tests = await testsFor(workspace, head, changed);
  const pythonTests = tests.filter((file) => python.test(file));
  const scriptTests = tests.filter((file) => script.test(file));
  return [...(pythonTests.length > 0 ? [await pytest(workspace, pythonTests)] : []), ...(scriptTests.length > 0 ? [await jest(workspace, scriptTests)] : [])];
}

async function testsFor(workspace: string, head: string, changed: string[]): Promise<string[]> {
  const payload = await createRepositoryIndexer().index(workspace, { commit: head });
  const changedFiles = new Set(changed);
  const isTest = (file: number) => payload.files[file]![3] === "test";
  const touched = payload.files.flatMap(([path], file) => (isTest(file) && changedFiles.has(path) ? [path] : []));
  const covering = payload.imports.flatMap(([from, to]) => (isTest(from) && changedFiles.has(payload.files[to]![0]) ? [payload.files[from]![0]] : []));
  return [...new Set([...touched, ...covering])].sort();
}

async function pytest(workspace: string, files: string[]): Promise<TestRun> {
  const commonDir = (await git(workspace, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
  const candidates = [workspace, dirname(commonDir)].map((root) => join(root, ".flox", "cache", "venv", "bin", "pytest"));
  const binary = candidates.find((candidate) => existsSync(candidate));
  if (binary === undefined) return notRun("pytest", files, `no Python test environment: none of ${candidates.join(", ")} exists`);
  const result = await execute(workspace, [binary, "-q", "-p", "no:cacheprovider", ...files], undefined, testTimeoutMs);
  const output = `${result.stdout}\n${result.stderr}`;
  const service = unavailableService.exec(output)?.[0];
  if (result.code !== 0 && service !== undefined) return notRun("pytest", files, `a service the tests need is not running locally (${service})`, output);
  if (result.code === 5) return notRun("pytest", files, "pytest collected no tests", output);
  return { runner: "pytest", files, status: result.code === 0 ? "passed" : "failed", reason: null, output: tail(output) };
}

async function jest(workspace: string, files: string[]): Promise<TestRun> {
  const packageRoot = nearestJestPackage(workspace, dirname(files[0]!));
  if (packageRoot === null) return notRun("jest", files, `no node_modules/.bin/jest between ${dirname(files[0]!)} and the workspace root; install the dependencies in ${workspace} to run jest`);
  const paths = files.map((file) => join(workspace, file));
  const result = await execute(packageRoot, [join(packageRoot, "node_modules", ".bin", "jest"), "--ci", ...paths], undefined, testTimeoutMs);
  return { runner: "jest", files, status: result.code === 0 ? "passed" : "failed", reason: null, output: tail(`${result.stdout}\n${result.stderr}`) };
}

function nearestJestPackage(workspace: string, directory: string): string | null {
  for (let current = directory; ; current = dirname(current)) {
    if (existsSync(join(workspace, current, "node_modules", ".bin", "jest"))) return join(workspace, current);
    if (current === "." || current === "/") return null;
  }
}

function notRun(runner: TestRun["runner"], files: string[], reason: string, output = ""): TestRun {
  return { runner, files, status: "not run", reason, output: tail(output) };
}

function tail(output: string): string {
  return output.trim().slice(-outputTail);
}

async function indexCheck(iteration: Iteration, workspace: string, head: string, changed: string[]): Promise<IndexCheck> {
  const scope = indexScope(iteration.scope, iteration.target.module, changed);
  const rules = (await Bun.file(iteration.rules).exists()) ? iteration.rules : undefined;
  const before = await measureCoherence({ repository: workspace, scope, commit: iteration.base.commit, rules });
  const after = await measureCoherence({ repository: workspace, scope, commit: head, rules });
  const scores = (report: CoherenceReport, dimension: Dimension) => report.index.dimensions[dimension].score;
  const targeted = targetedDimensions[iteration.target.step];
  const rounded = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);
  return {
    scope,
    composite: { before: rounded(before.index.composite.score), after: rounded(after.index.composite.score) },
    dimensions: Object.fromEntries(dimensions.map((dimension) => [dimension, { before: rounded(scores(before, dimension)), after: rounded(scores(after, dimension)) }])),
    targeted,
    regressed: targeted.filter((dimension) => {
      const [was, is] = [rounded(scores(before, dimension)), rounded(scores(after, dimension))];
      return was !== null && is !== null && is < was;
    }),
  };
}

function indexScope(scope: string, module: string, changed: string[]): string {
  const inside = changed.filter((file) => file.startsWith(`${scope}/`)).map((file) => dirname(file));
  const parts = [module, ...inside].map((path) => path.split("/"));
  const common: string[] = [];
  for (const [index, part] of parts[0]!.entries()) {
    if (parts.every((path) => path[index] === part)) common.push(part);
    else break;
  }
  const directory = common.join("/");
  return directory.startsWith(scope) ? directory : scope;
}
