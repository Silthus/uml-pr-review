import { dirname } from "node:path";
import { createRepositoryIndexer } from "../../src/architecture/index/index.ts";
import { git, readBlobs } from "../../src/git.ts";
import { BlobCache } from "../blob-cache.ts";
import type { CoherenceReport } from "../contract.ts";
import { lintFindings, oxlint, ruff } from "../lint.ts";
import { measureCoherence } from "../measure.ts";
import type { ScopeFile } from "../scope.ts";
import type { RecipeStep } from "../signals/recipe.ts";
import { withToolbox } from "../tools.ts";
import type { IndexDelta } from "./ledger.ts";
import type { Iteration } from "./state.ts";
import { runTests, testsFor, type TestRun } from "./test-runs.ts";

export type { TestRun } from "./test-runs.ts";
export type LintPass = { status: "run"; files: number; before: number; after: number } | { status: "not run"; reason: string };
export type Changes = { commits: number; files: string[]; added: number; deleted: number; lines: number; maxLines: number };
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

export async function verify(iteration: Iteration, maxLines = defaultMaxLines): Promise<Verification> {
  const workspace = iteration.workspace;
  if (workspace === null) throw new Error("this iteration has no workspace yet; run bun coherence/loop/workspace.ts first");
  const base = iteration.base.commit;
  const head = (await git(workspace.path, ["rev-parse", "HEAD"])).trim();
  const changes = await changesOf(workspace.path, base, head, maxLines);
  if (changes.commits === 0) throw new Error(`${workspace.branch} has no commit on top of ${iteration.base.ref}; commit the change first`);
  const busy = new Set(iteration.busyFiles.map(({ path }) => path));
  const busyFilesTouched = changes.files.filter((file) => busy.has(file));
  const dirty = await git(workspace.path, ["status", "--porcelain"]);
  const mainCheckout = dirname((await git(workspace.path, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim());
  const indexer = createRepositoryIndexer();
  const outsideScope = await filesLeavingScope(iteration, workspace.path, changes.files);
  const tests = testsFor(await indexer.index(workspace.path, { commit: head }), changes.files);
  const [lint, testRuns, index] = await Promise.all([
    lintPass(workspace.path, base, head, changes.files),
    runTests(workspace.path, mainCheckout, tests),
    indexCheck(iteration, workspace.path, head, changes.files),
  ]);
  const problems = [
    ...(dirty.trim() === "" ? [] : ["the workspace has uncommitted changes; commit or discard them"]),
    ...(changes.lines > maxLines ? [`${changes.lines} changed lines exceed the budget of ${maxLines}; split the change`] : []),
    ...(busyFilesTouched.length > 0 ? [`the change touches files that active pull requests touch: ${busyFilesTouched.join(", ")}`] : []),
    ...(outsideScope.length > 0 ? [`the change leaves ${iteration.scope}: ${outsideScope.join(", ")}`] : []),
    ...(lint.status === "run" && lint.after > lint.before ? [`the change adds ${lint.after - lint.before} lint findings in the files it touches`] : []),
    ...testRuns.filter(({ status }) => status === "failed").map(({ runner, files }) => `${runner} fails on ${files.join(", ")}`),
    ...index.regressed.map((dimension) => `the ${dimension} score of ${index.scope} drops from ${index.dimensions[dimension]!.before} to ${index.dimensions[dimension]!.after}`),
  ];
  return { head, changes, busyFilesTouched, outsideScope, lint, tests: testRuns, index, verdict: problems.length === 0 ? "pass" : "fail", problems };
}

async function changesOf(workspace: string, base: string, head: string, maxLines: number): Promise<Changes> {
  const [count, numstat] = await Promise.all([git(workspace, ["rev-list", "--count", `${base}..${head}`]), git(workspace, ["diff", "-M", "--numstat", "-z", base, head])]);
  const tokens = numstat.split("\0");
  const files: string[] = [];
  let [added, deleted] = [0, 0];
  for (let index = 0; index < tokens.length; index += 1) {
    const [addedLines, deletedLines, path] = tokens[index]!.split("\t");
    if (path === undefined) continue;
    added += Number(addedLines) || 0;
    deleted += Number(deletedLines) || 0;
    if (path !== "") files.push(path);
    else files.push(tokens[++index]!, tokens[++index]!);
  }
  return { commits: Number(count.trim()), files: [...new Set(files)], added, deleted, lines: added + deleted, maxLines };
}

async function filesLeavingScope(iteration: Iteration, workspace: string, files: string[]): Promise<string[]> {
  const outside = files.filter((file) => !file.startsWith(`${iteration.scope}/`));
  if (outside.length === 0 || iteration.target.step !== "facade") return outside;
  const callers = await callersOf(workspace, iteration.base.commit, iteration.target.module);
  return outside.filter((file) => !callers.has(file));
}

async function callersOf(workspace: string, commit: string, module: string): Promise<Set<string>> {
  const payload = await createRepositoryIndexer().index(workspace, { commit });
  const path = (file: number) => payload.files[file]![0];
  const inModule = (file: number) => path(file).startsWith(`${module}/`);
  return new Set(payload.imports.flatMap(([from, to]) => (inModule(to) && !inModule(from) ? [path(from)] : [])));
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
