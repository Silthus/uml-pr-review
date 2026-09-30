import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { bypassFor, isChokepoint } from "./bypass.ts";
import { findBullet, type Bullet } from "./spec.ts";

export type Language = "typescript" | "python";

export interface KitEnvironment {
  posthog: string;
  posthogRemote: string;
  coherenceRemote: string;
  seriesRoot: string;
  series: string[];
  oxlint: string;
  ruff: () => string[];
}

export interface SetUpOptions {
  dir: string;
  ref: string;
  language: Language;
  hooks: boolean;
}

type Print = (line: string) => void;

const FETCHED_PREFIX = "refs/uml-pr-review/";
const NODE_MODULES = ["node_modules", "nodejs/node_modules"];
const NODEJS = "nodejs";
const OXLINT_CONFIG = `${NODEJS}/.oxlintrc.nodejs.json`;
const CHOKEPOINT_RULE = "coherence(chokepoint)";
const STATE_FILE = "kit.json";

const kitState = z.object({ posthog: z.string(), language: z.enum(["typescript", "python"]), fetchedRefs: z.array(z.string()) });
type KitState = z.infer<typeof kitState>;

export function defaultEnvironment(): KitEnvironment {
  const posthog = join(homedir(), "posthog");
  return {
    posthog,
    posthogRemote: "https://github.com/PostHog/posthog.git",
    coherenceRemote: "https://github.com/PostHog/coherence.git",
    seriesRoot: resolve(import.meta.dir, "../../../upstream/coherence"),
    series: ["ts-checker-rung", "lint-totality-oracle"],
    oxlint: join(posthog, "node_modules/.bin/oxlint"),
    ruff: () => [Bun.which("uvx") ?? join(homedir(), ".local/bin/uvx"), `ruff@${pinnedRuff(posthog)}`, "check", "--force-exclude", "--output-format", "json"],
  };
}

function pinnedRuff(posthog: string): string {
  const lock = readFileSync(join(posthog, "uv.lock"), "utf8");
  const pinned = /\[\[package\]\]\nname = "ruff"\nversion = "([^"]+)"/.exec(lock)?.[1];
  if (pinned === undefined) throw new Error(`${posthog}/uv.lock pins no ruff version`);
  return pinned;
}

function run(argv: string[], cwd: string): string {
  const result = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${argv.join(" ")} (in ${cwd}) exited ${result.exitCode}: ${result.stderr.toString().trim()}`);
  return result.stdout.toString().trim();
}

function git(cwd: string, ...args: string[]): string {
  return run(["git", ...args], cwd);
}

function hasCommit(repo: string, ref: string): boolean {
  return Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: repo, stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

function realOrSelf(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(realOrSelf(parent), basename(path));
}

function assertOutside(dir: string, posthog: string) {
  const inside = relative(realOrSelf(posthog), realOrSelf(dir));
  if (inside === "" || !(inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))) throw new Error(`${dir} is inside ${posthog}, which the kit must never write to`);
}

function assertEmpty(dir: string) {
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} already exists and is not empty`);
}

function buildCoherence(target: string, environment: KitEnvironment) {
  const base = seriesBase(environment);
  git(dirname(target), "clone", "--quiet", environment.coherenceRemote, target);
  git(target, "checkout", "--quiet", "--detach", base);
  git(target, "-c", "user.name=uml-pr-review kit", "-c", "user.email=kit@uml-pr-review.invalid", "-c", "commit.gpgsign=false", "am", "--quiet", ...seriesPatches(environment));
  run(["bun", "install", "--ignore-scripts", "--silent"], target);
}

function seriesBase(environment: KitEnvironment): string {
  const bases = new Set(environment.series.map((series) => readFileSync(join(environment.seriesRoot, series, "BASE"), "utf8").trim()));
  if (bases.size !== 1) throw new Error(`the series ${environment.series.join(", ")} name different BASE commits`);
  return [...bases][0]!;
}

function seriesPatches(environment: KitEnvironment): string[] {
  return environment.series.flatMap((series) => {
    const folder = join(environment.seriesRoot, series);
    return readdirSync(folder)
      .filter((name) => name.endsWith(".patch"))
      .sort()
      .map((name) => join(folder, name));
  });
}

function fetchRef(ref: string, posthog: string, remote: string) {
  git(posthog, "fetch", "--quiet", "--no-tags", remote, `+${ref}:${FETCHED_PREFIX}${ref}`);
}

function addWorktree(posthog: string, worktree: string, commit: string) {
  git(posthog, "-c", "core.hooksPath=/dev/null", "worktree", "add", "--quiet", "--detach", worktree, commit);
}

function isSymlink(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
}

function linkNodeModules(worktree: string, posthog: string) {
  for (const folder of NODE_MODULES) {
    const source = join(posthog, folder);
    const link = join(worktree, folder);
    if (lstatSync(link, { throwIfNoEntry: false }) !== undefined) throw new Error(`${link} already exists, so it cannot be linked to ${source}`);
    if (existsSync(source)) symlinkSync(source, link, "dir");
  }
}

function coherenceConfig(language: Language, environment: KitEnvironment) {
  const lint =
    language === "typescript"
      ? { oxlint: { command: [environment.oxlint, "-c", OXLINT_CONFIG, "--format", "json", NODEJS], format: "oxlint-json" } }
      : { ruff: { command: environment.ruff(), format: "ruff-json" } };
  return { language, ignore: ["node_modules"], lint };
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const oxlintConfig = z.looseObject({
  ignorePatterns: z.array(z.string()).optional(),
  jsPlugins: z.array(z.unknown()).default([]),
  options: z.looseObject({}).optional(),
  rules: z.looseObject({}).default({}),
});

function fromRepositoryRoot(pattern: string): string {
  if (pattern.startsWith("!")) return `!${fromRepositoryRoot(pattern.slice(1))}`;
  return pattern.startsWith("**/") ? pattern : `${NODEJS}/${pattern}`;
}

function withoutTypeAwareRules(options: Record<string, unknown>): Record<string, unknown> {
  const withoutDirectiveReports: Record<string, unknown> = { ...options, typeAware: false };
  delete withoutDirectiveReports["reportUnusedDisableDirectives"];
  return withoutDirectiveReports;
}

function readOxlintConfig(path: string) {
  return oxlintConfig.parse(Bun.JSONC.parse(readFileSync(path, "utf8")));
}

function withChokepointRule(config: z.infer<typeof oxlintConfig>, worktree: string, coherence: string) {
  return {
    ...config,
    jsPlugins: [...config.jsPlugins, join(coherence, "src/adapters/lint.ts")],
    rules: { ...config.rules, "coherence/chokepoint": ["error", { root: worktree }] },
  };
}

function nestedOxlintConfigs(worktree: string): string[] {
  return [...new Bun.Glob("**/.oxlintrc.json").scanSync({ cwd: join(worktree, NODEJS), dot: true })].filter((path) => !path.split("/").includes("node_modules")).map((path) => join(worktree, NODEJS, path));
}

function enableChokepointRule(worktree: string, coherence: string) {
  const path = join(worktree, OXLINT_CONFIG);
  const config = readOxlintConfig(path);
  writeJson(path, { ...withChokepointRule(config, worktree, coherence), ignorePatterns: (config.ignorePatterns ?? []).map(fromRepositoryRoot), options: withoutTypeAwareRules(config.options ?? {}) });
  for (const nested of nestedOxlintConfigs(worktree)) writeJson(nested, withChokepointRule(readOxlintConfig(nested), worktree, coherence));
}

function coherenceCli(coherence: string, args: string[], cwd: string) {
  return Bun.spawnSync(["node", "--disable-warning=ExperimentalWarning", join(coherence, "src/cli.ts"), ...args], { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
}

function installHooks(worktree: string, coherence: string) {
  const result = coherenceCli(coherence, ["hooks", "install", "--host", "claude"], worktree);
  if (result.exitCode !== 0) throw new Error(`hooks install exited ${result.exitCode}: ${result.stderr.toString().trim()}`);
}

function readState(dir: string): KitState {
  const path = join(dir, STATE_FILE);
  if (!existsSync(path)) throw new Error(`${dir} is not a kit folder: it holds no ${STATE_FILE}`);
  return kitState.parse(JSON.parse(readFileSync(path, "utf8")));
}

async function timed<T>(label: string, print: Print, step: () => T | Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await step();
  print(`${label}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
  return result;
}

export async function setUp(options: SetUpOptions, environment: KitEnvironment, print: Print): Promise<void> {
  const dir = resolve(options.dir);
  assertOutside(dir, environment.posthog);
  assertEmpty(dir);
  mkdirSync(dir, { recursive: true });
  const missing = hasCommit(environment.posthog, options.ref) ? undefined : options.ref;
  const fetchedRefs = missing === undefined ? [] : [`${FETCHED_PREFIX}${missing}`];
  writeJson(join(dir, STATE_FILE), { posthog: environment.posthog, language: options.language, fetchedRefs } satisfies KitState);
  try {
    await prepare(dir, options, environment, missing, print);
  } catch (error) {
    await tearDown(dir, print);
    throw error;
  }
}

async function prepare(dir: string, options: SetUpOptions, environment: KitEnvironment, missing: string | undefined, print: Print) {
  const coherence = join(dir, "coherence");
  const worktree = join(dir, "posthog");
  await timed("coherence built", print, () => buildCoherence(coherence, environment));
  if (missing !== undefined) await timed(`fetched ${missing}`, print, () => fetchRef(missing, environment.posthog, environment.posthogRemote));
  await timed("worktree added", print, () => addWorktree(environment.posthog, worktree, missing === undefined ? options.ref : `${FETCHED_PREFIX}${missing}`));
  linkNodeModules(worktree, environment.posthog);
  writeJson(join(worktree, "coherence.config.json"), coherenceConfig(options.language, environment));
  if (options.language === "typescript") enableChokepointRule(worktree, coherence);
  if (options.hooks) await timed("hooks installed", print, () => installHooks(worktree, coherence));
  print(`export COHERENCE_HOME=${coherence}`);
}

export async function tearDown(dir: string, print: Print): Promise<void> {
  const root = resolve(dir);
  const state = readState(root);
  const worktree = join(root, "posthog");
  for (const folder of NODE_MODULES) if (isSymlink(join(worktree, folder))) unlinkSync(join(worktree, folder));
  if (existsSync(worktree)) git(state.posthog, "worktree", "remove", "--force", worktree);
  git(state.posthog, "worktree", "prune");
  for (const ref of state.fetchedRefs) if (hasCommit(state.posthog, ref)) git(state.posthog, "update-ref", "-d", ref);
  rmSync(root, { recursive: true, force: true });
  print(`removed ${root}`);
}

type Verdict = string | undefined;

interface EnforcerRun {
  verdict: Verdict;
  output: string;
}

const runRecord = z.object({ invariants: z.array(z.object({ component: z.string(), name: z.string(), verdict: z.string() })) });

function runVerdict(stdout: string, bullet: Bullet): Verdict {
  const json = stdout.indexOf("{");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(json));
  } catch {
    return undefined;
  }
  const record = runRecord.safeParse(parsed);
  return record.success ? record.data.invariants.find((entry) => entry.component === bullet.component && entry.name === bullet.name)?.verdict : undefined;
}

function transcript(command: string, result: { stdout: Buffer; stderr: Buffer; exitCode: number }): string {
  return `$ ${command}\n${result.stdout.toString()}${result.stderr.toString()}[exit ${result.exitCode}]`;
}

function coherenceRun(coherence: string, worktree: string, bullet: Bullet): EnforcerRun {
  const args = ["run", "--invariant", bullet.name, "--json", "--no-server", "--session", "kit-witness", "--agent", "kit"];
  const result = coherenceCli(coherence, args, worktree);
  return { verdict: runVerdict(result.stdout.toString(), bullet), output: transcript(`coherence ${args.join(" ")}`, result) };
}

const REFUTE_VERDICTS: Record<number, Verdict> = { 0: "fail", 1: "pass" };

function coherenceRefute(coherence: string, worktree: string, bullet: Bullet): EnforcerRun {
  const args = ["refute", `${bullet.component}/${bullet.name}`, "--broke", "the kit staged a bypass", "--session", "kit-witness", "--agent", "kit"];
  const result = coherenceCli(coherence, args, worktree);
  return { verdict: REFUTE_VERDICTS[result.exitCode], output: transcript(`coherence ${args.join(" ")}`, result) };
}

const oxlintReport = z.object({ diagnostics: z.array(z.object({ code: z.string().nullish(), filename: z.string() })) });

function chokepointLint(worktree: string, path: string): EnforcerRun {
  const config = JSON.parse(readFileSync(join(worktree, "coherence.config.json"), "utf8")) as { lint: { oxlint: { command: string[] } } };
  const argv = [...config.lint.oxlint.command, path];
  const result = Bun.spawnSync(argv, { cwd: worktree, stdout: "pipe", stderr: "pipe", env: process.env });
  const report = oxlintReport.safeParse(safeJson(result.stdout.toString()));
  const findings = report.success ? report.data.diagnostics.filter((d) => d.code === CHOKEPOINT_RULE && (d.filename === path || d.filename.startsWith(`${path}/`))) : undefined;
  const verdict: Verdict = findings === undefined ? undefined : findings.length > 0 ? "fail" : "pass";
  const summary = findings === undefined ? "(no oxlint report)" : `${findings.length} ${CHOKEPOINT_RULE} finding(s) under ${path}: ${findings.map((d) => d.filename).join(", ")}`;
  return { verdict, output: `$ ${argv.join(" ")}\n${summary}\n[exit ${result.exitCode}]` };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function lintsChokepoint(state: KitState, bullet: Bullet): boolean {
  return state.language === "typescript" && isChokepoint(bullet);
}

function red(state: KitState, coherence: string, worktree: string, bullet: Bullet, bypassPath: string): EnforcerRun {
  if (lintsChokepoint(state, bullet)) return chokepointLint(worktree, bypassPath);
  return isChokepoint(bullet) ? coherenceRun(coherence, worktree, bullet) : coherenceRefute(coherence, worktree, bullet);
}

function green(state: KitState, coherence: string, worktree: string, bullet: Bullet): EnforcerRun {
  return lintsChokepoint(state, bullet) ? chokepointLint(worktree, bullet.component) : coherenceRun(coherence, worktree, bullet);
}

export async function witness(dir: string, target: string, print: Print): Promise<boolean> {
  const root = resolve(dir);
  const state = readState(root);
  const worktree = join(root, "posthog");
  const coherence = join(root, "coherence");
  const bullet = findBullet(worktree, target);
  const bypass = bypassFor(worktree, bullet, state.language);
  writeFileSync(join(worktree, bypass.path), bypass.content, { flag: "wx" });
  print(`staged ${bypass.path}: ${bypass.content.trim()}`);
  let staged: EnforcerRun;
  try {
    staged = await timed("red", print, () => red(state, coherence, worktree, bullet, bypass.path));
  } finally {
    rmSync(join(worktree, bypass.path), { force: true });
  }
  print(staged.output);
  const restored = await timed("green", print, () => green(state, coherence, worktree, bullet));
  print(restored.output);
  if (staged.verdict !== "fail") print(`the enforcer did not go red with the bypass staged: ${staged.verdict ?? "no verdict"}`);
  if (restored.verdict !== "pass") print(`the enforcer did not pass once the bypass was removed: ${restored.verdict ?? "no verdict"}`);
  return staged.verdict === "fail" && restored.verdict === "pass";
}
