import { existsSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";

export type Language = "typescript" | "python";

export interface KitEnvironment {
  posthog: string;
  posthogRemote: string;
  coherenceRemote: string;
  seriesRoot: string;
  series: string[];
  oxlint: string;
  ruff: string[];
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
const STATE_FILE = "kit.json";
const BYPASS_STEM = "kitWitnessBypass";
const PYTHON_BYPASS_STEM = "kit_witness_bypass";

const kitState = z.object({ posthog: z.string(), fetchedRefs: z.array(z.string()) });
type KitState = z.infer<typeof kitState>;

export function defaultEnvironment(): KitEnvironment {
  const posthog = join(homedir(), "posthog");
  const uvx = Bun.which("uvx") ?? join(homedir(), ".local/bin/uvx");
  return {
    posthog,
    posthogRemote: "https://github.com/PostHog/posthog.git",
    coherenceRemote: "https://github.com/PostHog/coherence.git",
    seriesRoot: resolve(import.meta.dir, "../../../upstream/coherence"),
    series: ["ts-checker-rung", "lint-totality-oracle"],
    oxlint: join(posthog, "node_modules/.bin/oxlint"),
    ruff: [uvx, `ruff@${pinnedRuff(posthog)}`, "check", "--force-exclude", "--output-format", "json"],
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

function assertOutside(dir: string, posthog: string) {
  if (!relative(posthog, dir).startsWith("..")) throw new Error(`${dir} is inside ${posthog}, which the kit must never write to`);
}

function assertEmpty(dir: string) {
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} already exists and is not empty`);
}

function buildCoherence(target: string, environment: KitEnvironment) {
  git(dirname(target), "clone", "--quiet", environment.coherenceRemote, target);
  git(target, "checkout", "--quiet", "--detach", seriesBase(environment));
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

function checkOut(ref: string, worktree: string, posthog: string, remote: string): string[] {
  const fetched = hasCommit(posthog, ref) ? [] : [fetchRef(ref, posthog, remote)];
  git(posthog, "worktree", "add", "--quiet", "--detach", worktree, fetched[0] ?? ref);
  return fetched;
}

function fetchRef(ref: string, posthog: string, remote: string): string {
  const local = `${FETCHED_PREFIX}${ref}`;
  git(posthog, "fetch", "--quiet", "--no-tags", remote, `+${ref}:${local}`);
  return local;
}

function linkNodeModules(worktree: string, posthog: string) {
  for (const folder of NODE_MODULES) {
    const source = join(posthog, folder);
    const link = join(worktree, folder);
    if (existsSync(source) && !existsSync(link)) symlinkSync(source, link, "dir");
  }
}

function coherenceConfig(language: Language, environment: KitEnvironment) {
  const lint =
    language === "typescript"
      ? { oxlint: { command: [environment.oxlint, "-c", OXLINT_CONFIG, "--format", "json", NODEJS], format: "oxlint-json" } }
      : { ruff: { command: environment.ruff, format: "ruff-json" } };
  return { language, ignore: ["node_modules"], lint };
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const oxlintConfig = z.looseObject({
  ignorePatterns: z.array(z.string()).default([]),
  jsPlugins: z.array(z.unknown()).default([]),
  options: z.looseObject({}).default({}),
  rules: z.looseObject({}).default({}),
});

function fromRepositoryRoot(pattern: string): string {
  if (pattern.startsWith("!")) return `!${fromRepositoryRoot(pattern.slice(1))}`;
  return pattern.startsWith("**/") ? pattern : `${NODEJS}/${pattern}`;
}

function withoutTypeAwareness(options: Record<string, unknown>): Record<string, unknown> {
  const { reportUnusedDisableDirectives: _unusedOnceTypeAwareRulesAreOff, ...rest } = options;
  return { ...rest, typeAware: false };
}

function enableChokepointRule(worktree: string, coherence: string) {
  const path = join(worktree, OXLINT_CONFIG);
  const config = oxlintConfig.parse(Bun.JSONC.parse(readFileSync(path, "utf8")));
  writeJson(path, {
    ...config,
    ignorePatterns: config.ignorePatterns.map(fromRepositoryRoot),
    jsPlugins: [...config.jsPlugins, join(coherence, "src/adapters/lint.ts")],
    options: withoutTypeAwareness(config.options),
    rules: { ...config.rules, "coherence/chokepoint": ["error", { root: worktree }] },
  });
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
  const coherence = join(dir, "coherence");
  const worktree = join(dir, "posthog");
  await timed("coherence built", print, () => buildCoherence(coherence, environment));
  const fetchedRefs = await timed("worktree added", print, () => checkOut(options.ref, worktree, environment.posthog, environment.posthogRemote));
  writeJson(join(dir, STATE_FILE), { posthog: environment.posthog, fetchedRefs } satisfies KitState);
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
  for (const folder of NODE_MODULES) if (existsSync(join(worktree, folder))) unlinkSync(join(worktree, folder));
  if (existsSync(worktree)) git(state.posthog, "worktree", "remove", "--force", worktree);
  git(state.posthog, "worktree", "prune");
  for (const ref of state.fetchedRefs) git(state.posthog, "update-ref", "-d", ref);
  rmSync(root, { recursive: true, force: true });
  print(`removed ${root}`);
}

interface Bullet {
  component: string;
  name: string;
  fields: Record<string, string>;
}

interface Bypass {
  path: string;
  content: string;
}

function findBullet(worktree: string, target: string): Bullet {
  const slash = target.lastIndexOf("/");
  const component = slash === -1 ? "." : target.slice(0, slash);
  const name = target.slice(slash + 1);
  const folder = join(worktree, component);
  const specs = existsSync(folder) ? readdirSync(folder).filter((file) => file.endsWith(".spec.md")) : [];
  for (const spec of specs) {
    const fields = bulletFields(readFileSync(join(folder, spec), "utf8"), name);
    if (fields !== undefined) return { component, name, fields };
  }
  throw new Error(`no invariant "${name}" in ${component}`);
}

function bulletFields(spec: string, name: string): Record<string, string> | undefined {
  const lines = spec.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`- ${name}:`));
  if (start === -1) return undefined;
  const fields: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    const field = /^\s+([a-z]+):\s*(.*)$/.exec(line);
    if (field === null) break;
    fields[field[1]!] = field[2]!;
  }
  return fields;
}

function stageBypass(worktree: string, bullet: Bullet): Bypass {
  if (bullet.fields["protects"] !== undefined) return chokepointBypass(bullet.component, bullet.fields["protects"]);
  const via = /^lint (\w+):([\w/-]+) matching "([^"]+)"$/.exec(bullet.fields["via"] ?? "");
  if (via === null) throw new Error(`${bullet.component}/${bullet.name} is neither a chokepoint nor a lint totality oracle with matching text`);
  return lintBypass(worktree, bullet.component, via[1]!, via[2]!, via[3]!);
}

function chokepointBypass(component: string, protects: string): Bypass {
  const [, symbol, file] = /^(?:(\w+) in )?(\S+)$/.exec(protects) ?? [];
  if (file === undefined) throw new Error(`cannot read the protected thing "${protects}"`);
  return file.endsWith(".py") ? pythonImportBypass(component, pythonModule(file), symbol) : typescriptImportBypass(component, file, symbol);
}

function pythonModule(file: string): string {
  return file.replace(/\.py$/, "").replace(/\/__init__$/, "").split("/").join(".");
}

function pythonImportBypass(component: string, module: string, symbol: string | undefined): Bypass {
  const content = symbol === undefined ? `import ${module}  # noqa: F401\n` : `from ${module} import ${symbol}  # noqa: F401\n`;
  return { path: join(component, `${PYTHON_BYPASS_STEM}.py`), content };
}

function typescriptImportBypass(component: string, file: string, symbol: string | undefined): Bypass {
  const specifier = relative(component, file).replace(/\.tsx?$/, "");
  const from = specifier.startsWith(".") ? specifier : `./${specifier}`;
  const content = symbol === undefined ? `import * as bypass from "${from}";\nexport { bypass };\n` : `import { ${symbol} } from "${from}";\nexport { ${symbol} };\n`;
  return { path: join(component, `${BYPASS_STEM}.ts`), content };
}

function lintBypass(worktree: string, component: string, tool: string, rule: string, matching: string): Bypass {
  if (tool === "oxlint" && rule === "no-restricted-imports") return { path: join(component, `${BYPASS_STEM}.ts`), content: `import "${matching}";\n` };
  if (tool === "ruff" && rule === "TID251") return pythonImportBypass(component, ...bannedApi(worktree, matching));
  throw new Error(`the kit cannot stage a bypass for ${tool}:${rule}`);
}

function bannedApi(worktree: string, matching: string): [string, string] {
  const pyproject = Bun.TOML.parse(readFileSync(join(worktree, "pyproject.toml"), "utf8")) as { tool?: { ruff?: { lint?: { "flake8-tidy-imports"?: { "banned-api"?: Record<string, unknown> } } } } };
  const banned = Object.keys(pyproject.tool?.ruff?.lint?.["flake8-tidy-imports"]?.["banned-api"] ?? {}).find((api) => api.includes(matching));
  if (banned === undefined) throw new Error(`pyproject.toml bans no API matching "${matching}"`);
  const dot = banned.lastIndexOf(".");
  return [banned.slice(0, dot), banned.slice(dot + 1)];
}

interface EnforcerRun {
  verdict: string | undefined;
  output: string;
}

function enforce(coherence: string, worktree: string, bullet: Bullet, refuting: boolean): EnforcerRun {
  const target = `${bullet.component}/${bullet.name}`;
  const args = refuting
    ? ["refute", target, "--broke", "the kit staged a bypass", "--session", "kit-witness", "--agent", "kit"]
    : ["run", "--invariant", bullet.name, "--json", "--no-server", "--session", "kit-witness", "--agent", "kit"];
  const result = coherenceCli(coherence, args, worktree);
  const stdout = result.stdout.toString();
  const output = `$ coherence ${args.join(" ")}\n${stdout}${result.stderr.toString()}[exit ${result.exitCode}]`;
  const verdict = refuting ? (result.exitCode === 0 ? "fail" : "pass") : runVerdict(stdout, bullet);
  return { verdict, output };
}

const runRecord = z.object({ invariants: z.array(z.object({ component: z.string(), name: z.string(), verdict: z.string() })) });

function runVerdict(stdout: string, bullet: Bullet): string | undefined {
  const json = stdout.indexOf("{");
  if (json === -1) return undefined;
  const record = runRecord.parse(JSON.parse(stdout.slice(json)));
  return record.invariants.find((entry) => entry.component === bullet.component && entry.name === bullet.name)?.verdict;
}

export async function witness(dir: string, target: string, print: Print): Promise<boolean> {
  const root = resolve(dir);
  readState(root);
  const worktree = join(root, "posthog");
  const coherence = join(root, "coherence");
  const bullet = findBullet(worktree, target);
  const bypass = stageBypass(worktree, bullet);
  const bypassPath = join(worktree, bypass.path);
  writeFileSync(bypassPath, bypass.content);
  print(`staged ${bypass.path}: ${bypass.content.trim()}`);
  let red: EnforcerRun;
  try {
    red = await timed("red", print, () => enforce(coherence, worktree, bullet, bullet.fields["via"] !== undefined));
  } finally {
    rmSync(bypassPath, { force: true });
  }
  print(red.output);
  const green = await timed("green", print, () => enforce(coherence, worktree, bullet, false));
  print(green.output);
  if (red.verdict !== "fail") print("the enforcer stayed green with the bypass staged");
  if (green.verdict !== "pass") print(`the enforcer did not pass once the bypass was removed: ${green.verdict ?? "no verdict"}`);
  return red.verdict === "fail" && green.verdict === "pass";
}
