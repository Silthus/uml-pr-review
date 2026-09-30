import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const language = process.argv[2];
if (language !== "typescript" && language !== "python") throw new Error("usage: bun acceptance.ts typescript|python");

const repo = resolve(import.meta.dir, "../../..");
const posthog = join(homedir(), "posthog");
const dir = `/tmp/kit117-accept-${language}`;
const worktree = join(dir, "posthog");
const log: string[] = [];

function say(line: string) {
  console.log(line);
  log.push(line);
}

const identity = (out: string) => out;

function sh(argv: string[], cwd: string, allowFailure = false, summarize = identity): { code: number; out: string; seconds: number } {
  const started = performance.now();
  const result = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const seconds = (performance.now() - started) / 1000;
  const out = `${result.stdout.toString()}${result.stderr.toString()}`.trimEnd();
  say(`$ ${argv.join(" ")}   # ${seconds.toFixed(1)} s, exit ${result.exitCode}`);
  if (out !== "") say(summarize === identity ? out : summarize(result.stdout.toString()));
  if (result.exitCode !== 0 && !allowFailure) throw new Error(`${argv[0]} failed`);
  return { code: result.exitCode, out, seconds };
}

function findingsByRule(out: string): string {
  const report = JSON.parse(out);
  const findings: { code?: string | null }[] = Array.isArray(report) ? report : report.diagnostics;
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.code ?? "(no rule)", (counts.get(finding.code ?? "(no rule)") ?? 0) + 1);
  return `${findings.length} findings: ${[...counts].map(([code, count]) => `${code} ${count}`).join(", ") || "none"}${out.includes("~/cdp") || out.includes("is_impersonated_session") ? "" : "; none names the invariant"}`;
}

function posthogState() {
  const quiet = (argv: string[]) => Bun.spawnSync(argv, { cwd: posthog, stdout: "pipe" }).stdout.toString();
  return {
    worktrees: quiet(["git", "worktree", "list", "--porcelain"]).split("\n").filter((line) => line.startsWith("worktree ")),
    status: quiet(["git", "status", "--porcelain"]),
    settings: new Bun.CryptoHasher("sha256").update(readFileSync(join(posthog, ".claude/settings.json"))).digest("hex"),
  };
}

function write(path: string, content: string) {
  mkdirSync(dirname(join(worktree, path)), { recursive: true });
  writeFileSync(join(worktree, path), content);
}

function declareTypeScript(): string {
  write(
    "nodejs/src/ingestion/pipelines/Pipelines.spec.md",
    `# Pipelines

The ingestion pipelines: how events move from the consumer to their outputs.

## invariants
- pipelines never reach cdp: Ingestion pipelines depend on CDP only through the contracts in ~/common.
  over: every import under nodejs/src/ingestion/pipelines
  via: lint oxlint:no-restricted-imports matching "~/cdp"
  because: ingestion and CDP deploy apart, and a direct import couples their releases
  kinds: none
`,
  );
  const path = join(worktree, "nodejs/.oxlintrc.nodejs.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  const ingestion = config.overrides.find((override: { files: string[] }) => override.files.includes("src/ingestion/**/*.ts"));
  const [level, options] = ingestion.rules["eslint/no-restricted-imports"];
  const cdp = { group: ["~/cdp", "~/cdp/**"], message: "pipelines never reach cdp (nodejs/src/ingestion/pipelines/Pipelines.spec.md): depend on the contracts in ~/common" };
  config.overrides.push({ files: ["src/ingestion/pipelines/**/*.ts"], rules: { "eslint/no-restricted-imports": [level, { ...options, patterns: [...options.patterns, cdp] }] } });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return "nodejs/src/ingestion/pipelines/pipelines never reach cdp";
}

const RESIDUAL = ["posthog/event_usage.py", "posthog/api/file_system/file_system_logging.py"];
const FIXED_BEFORE_DECLARING = ["products/signals/backend/views.py", "products/experiments/backend/experiment_service.py"];

function fixBeforeDeclaring(file: string) {
  const path = join(worktree, file);
  writeFileSync(path, readFileSync(path, "utf8").replace("from posthog.models.activity_logging.model_activity import is_impersonated_session", "from posthog.helpers.impersonation import is_impersonated as is_impersonated_session"));
  say(`fixed before declaring: ${file} reads impersonation through is_impersonated`);
}

function declarePython(): string {
  FIXED_BEFORE_DECLARING.forEach(fixBeforeDeclaring);
  write(
    "posthog/helpers/Helpers.spec.md",
    `# Helpers

Shared request helpers, impersonation among them.

## invariants
- impersonation read through is_impersonated: Code asks whether a request is impersonated only through is_impersonated, which also sees MCP impersonation.
  over: every Python file ruff lints except the listed residual: ${RESIDUAL.join(", ")}
  via: lint ruff:TID251 matching "is_impersonated_session"
  because: is_impersonated_session misses MCP impersonation
  kinds: none
`,
  );
  const path = join(worktree, "pyproject.toml");
  const ban = `"posthog.models.activity_logging.model_activity.is_impersonated_session".msg = "impersonation read through is_impersonated (posthog/helpers/Helpers.spec.md): call posthog.helpers.impersonation.is_impersonated"`;
  const residual = RESIDUAL.map((file) => `"${file}" = ["TID251"]`).join("\n");
  const pyproject = readFileSync(path, "utf8")
    .replace("[tool.ruff.lint.flake8-tidy-imports]\n", `[tool.ruff.lint.flake8-tidy-imports.banned-api]\n${ban}\n\n[tool.ruff.lint.flake8-tidy-imports]\n`)
    .replace("[tool.ruff.lint.per-file-ignores]\n", `[tool.ruff.lint.per-file-ignores]\n${residual}\n`)
    .replace("[tool.ruff.lint]\n", `[tool.ruff.lint]\nextend-select = ["TID251"]\n`);
  writeFileSync(path, pyproject);
  return "posthog/helpers/impersonation read through is_impersonated";
}

const before = posthogState();
say(`# ${language}: kit acceptance on ~/posthog at ${Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: posthog }).stdout.toString().trim()}`);
say(`~/posthog/.claude/settings.json sha256 before: ${before.settings}`);
const setup = sh(["bun", "benchmark/replay/kit/setup.ts", dir, "--ref", "master", "--language", language, "--hooks"], repo);
const target = language === "typescript" ? declareTypeScript() : declarePython();
say(`declared ${target} in the /tmp worktree`);
const lint =
  language === "typescript"
    ? sh([join(worktree, "node_modules/.bin/oxlint"), "-c", "nodejs/.oxlintrc.nodejs.json", "--format", "json", "nodejs/src/ingestion/pipelines"], worktree, true, findingsByRule)
    : sh(JSON.parse(readFileSync(join(worktree, "coherence.config.json"), "utf8")).lint.ruff.command.concat(["posthog/helpers"]), worktree, true, findingsByRule);
sh(["node", "--disable-warning=ExperimentalWarning", join(dir, "coherence/src/cli.ts"), "spec", "--check"], worktree, true);
const witnessed = sh(["bun", "benchmark/replay/kit/witness.ts", dir, target], repo, true);
const teardown = sh(["bun", "benchmark/replay/kit/teardown.ts", dir], repo);
const after = posthogState();
const leftover = after.worktrees.filter((line) => line.includes(dir));
say(`~/posthog/.claude/settings.json sha256 after:  ${after.settings} (${after.settings === before.settings ? "identical" : "CHANGED"})`);
say(`~/posthog git status: ${after.status === before.status ? "unchanged" : "CHANGED"} (${after.status === "" ? "clean" : after.status})`);
say(`~/posthog worktrees under ${dir}: ${leftover.length} (before setup: ${before.worktrees.filter((line) => line.includes(dir)).length}); entries added or removed meanwhile by other sessions: ${after.worktrees.filter((line) => !before.worktrees.includes(line)).length + before.worktrees.filter((line) => !after.worktrees.includes(line)).length}`);
say(`timings: setup ${setup.seconds.toFixed(1)} s, one ${language === "typescript" ? "oxlint" : "ruff"} run ${lint.seconds.toFixed(1)} s, witness ${witnessed.seconds.toFixed(1)} s, teardown ${teardown.seconds.toFixed(1)} s`);
say(`witness: ${witnessed.code === 0 ? "red, then green" : "FAILED"}`);
writeFileSync(join(import.meta.dir, `acceptance-${language}.log`), `${log.join("\n")}\n`);
process.exit(witnessed.code === 0 && leftover.length === 0 && after.settings === before.settings && after.status === before.status ? 0 : 1);
