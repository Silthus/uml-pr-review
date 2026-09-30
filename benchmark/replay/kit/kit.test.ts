import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setUp, tearDown, witness, type KitEnvironment } from "./kit.ts";

const scratch = mkdtempSync(join(tmpdir(), "kit-test-"));
const posthog = join(scratch, "posthog");
const posthogRemote = join(scratch, "posthog-remote");
const coherenceRemote = join(scratch, "coherence-remote");
const seriesRoot = join(scratch, "series");
const RUFF = ["ruff", "check", "--force-exclude", "--output-format", "json"];

const environment: KitEnvironment = {
  posthog,
  posthogRemote,
  coherenceRemote,
  seriesRoot,
  series: ["first", "second"],
  oxlint: join(posthog, "node_modules/.bin/oxlint"),
  ruff: () => RUFF,
};

const FAKE_ENFORCERS = `
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const blind = process.env.FAKE_ENFORCER_BLIND === "1";
export function files(dir) {
  if (!statSync(dir).isDirectory()) return [dir];
  return readdirSync(dir).flatMap((name) => (name === "node_modules" || name === ".git" || name.endsWith(".spec.md") ? [] : files(join(dir, name))));
}
export const offenders = (root, text, allowed = []) => (blind ? [] : files(root).filter((f) => !allowed.includes(relative(process.cwd(), f)) && readFileSync(f, "utf8").includes(text)));
`;

const FAKE_COHERENCE = `
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { offenders } from "./enforcers.js";
const [command, ...rest] = process.argv.slice(2);
const cwd = process.cwd();
const detectors = {
  "one door": ["src/store", 'from "./secrets"', "src/store/door.ts"],
  "one impersonation check": ["posthog/helpers", "model_activity import is_impersonated_session", "posthog/helpers/impersonation.py"],
  "never reaches ~/cdp": ["src/store", 'import "~/cdp"', ""],
  "no requests": ["posthog/helpers", "import requests", ""],
};
if (command === "hooks") {
  if (process.env.FAKE_HOOKS_FAIL === "1") process.exit(3);
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  writeFileSync(join(cwd, ".claude/settings.json"), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "coherence hook PostToolUse" }] }] } }));
} else if (command === "refute") {
  const name = rest[0].slice(rest[0].indexOf("/", rest[0].indexOf("/") + 1) + 1);
  const [, text, allowed] = detectors[name];
  console.log("refute " + rest[0]);
  process.exit(offenders(cwd, text, [allowed]).length > 0 ? 0 : 1);
} else if (command === "run") {
  const name = rest[rest.indexOf("--invariant") + 1];
  const [component, text, allowed] = detectors[name];
  const verdict = offenders(cwd, text, [allowed]).length > 0 ? "fail" : "pass";
  console.log(JSON.stringify({ invariants: [{ component, name, verdict }] }));
  process.exit(verdict === "fail" ? 1 : 0);
}
`;

const FAKE_OXLINT = `#!/usr/bin/env node
import("${join(scratch, "enforcers.mjs")}").then(({ offenders }) => {
  const paths = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith("-") && all[i - 1] !== "-c" && all[i - 1] !== "--format");
  const diagnostics = paths.flatMap((path) => offenders(path, 'from "./secrets"', ["src/store/door.ts"])).map((filename) => ({ code: "coherence(chokepoint)", filename, message: "bypass" }));
  console.log(JSON.stringify({ diagnostics, number_of_files: 1 }));
  process.exit(diagnostics.length > 0 ? 1 : 0);
});
`;

const SPEC = `# Store

The store.

## invariants
- one door: The store is read only through the door.
  protects: src/store/secrets.ts
  chokepoint: src/store/door.ts
  because: the door seals

- never reaches ~/cdp: The store never imports cdp.
  over: every import under src/store
  via: lint oxlint:no-restricted-imports matching "~/cdp"
  because: they deploy apart
`;

const PYTHON_SPEC = `# Helpers

Request helpers.

## invariants
- one impersonation check: Impersonation is read only through is_impersonated.
  protects: is_impersonated_session in posthog/models/activity_logging/model_activity.py
  chokepoint: is_impersonated in posthog/helpers/impersonation.py
  because: is_impersonated_session misses MCP impersonation

- no requests: Helpers call out through the request util.
  over: every Python file ruff lints
  via: lint ruff:TID251 matching "requests"
  because: the util retries
`;

const PYPROJECT = `[tool.ruff.lint.flake8-tidy-imports.banned-api]
"requests".msg = "use the request util"
"loginas.utils.is_impersonated_session".msg = "use is_impersonated"
`;

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-c", "user.name=kit-test", "-c", "user.email=kit@test", "-c", "commit.gpgsign=false", ...args], { cwd, stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function commitAll(root: string, message: string): string {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

function makeSeries(root: string, names: string[], base: (name: string, real: string) => string) {
  names.forEach((series, index) => {
    write(coherenceRemote, `series-${index}.txt`, series);
    commitAll(coherenceRemote, series);
    mkdirSync(join(root, series), { recursive: true });
    const real = git(coherenceRemote, "rev-parse", "HEAD~1");
    writeFileSync(join(root, series, "BASE"), `${base(series, real)}\n`);
    git(coherenceRemote, "format-patch", "-q", "-1", "-o", join(root, series));
    git(coherenceRemote, "reset", "-q", "--hard", real);
  });
}

function makeCoherence() {
  mkdirSync(coherenceRemote);
  git(coherenceRemote, "init", "-q");
  write(coherenceRemote, "package.json", JSON.stringify({ name: "fake-coherence", type: "module" }));
  write(coherenceRemote, "src/cli.ts", FAKE_COHERENCE);
  write(coherenceRemote, "src/enforcers.js", FAKE_ENFORCERS);
  commitAll(coherenceRemote, "base");
  makeSeries(seriesRoot, environment.series, (_name, real) => real);
  write(scratch, "enforcers.mjs", FAKE_ENFORCERS);
}

function makePostHog() {
  mkdirSync(posthog);
  git(posthog, "init", "-q", "-b", "master");
  write(posthog, ".gitignore", "node_modules\n");
  write(posthog, ".claude/settings.json", "{}\n");
  write(posthog, "nodejs/.oxlintrc.nodejs.json", '{\n  // the nodejs lint\n  "ignorePatterns": ["dist", "**/dev/**", "!.eslintrc.js"],\n  "jsPlugins": ["eslint-plugin-no-only-tests"],\n  "options": { "typeAware": true, "reportUnusedDisableDirectives": "error" },\n  "rules": { "no-console": "error" },\n}\n');
  write(posthog, "nodejs/src/sidecar/.oxlintrc.json", '{ "categories": { "correctness": "error" } }\n');
  write(posthog, "pyproject.toml", PYPROJECT);
  write(posthog, "src/store/Store.spec.md", SPEC);
  write(posthog, "src/store/secrets.ts", "export const secret = 1;\n");
  write(posthog, "src/store/door.ts", 'import { secret } from "./secrets";\nexport const seal = () => secret;\n');
  write(posthog, "posthog/helpers/Helpers.spec.md", PYTHON_SPEC);
  write(posthog, "posthog/models/activity_logging/model_activity.py", "def is_impersonated_session(request):\n    return False\n");
  write(posthog, "posthog/helpers/impersonation.py", "from posthog.models.activity_logging.model_activity import is_impersonated_session\n\n\ndef is_impersonated(request):\n    return is_impersonated_session(request)\n");
  write(posthog, ".hooks/post-checkout", "#!/bin/sh\nmkdir -p node_modules/installed-by-the-hook\n");
  chmodSync(join(posthog, ".hooks/post-checkout"), 0o755);
  commitAll(posthog, "master");
  git(posthog, "config", "core.hooksPath", ".hooks");
  write(posthog, "node_modules/.bin/oxlint", FAKE_OXLINT);
  chmodSync(join(posthog, "node_modules/.bin/oxlint"), 0o755);
  write(posthog, "nodejs/node_modules/marker", "");
  git(scratch, "clone", "-q", "--bare", posthog, posthogRemote);
  git(posthogRemote, "update-ref", "refs/pull/7/head", git(posthogRemote, "rev-parse", "master"));
}

function posthogState() {
  return {
    worktrees: git(posthog, "worktree", "list", "--porcelain"),
    status: git(posthog, "status", "--porcelain"),
    refs: git(posthog, "for-each-ref"),
    settings: readFileSync(join(posthog, ".claude/settings.json"), "utf8"),
  };
}

async function captured<T>(run: (print: (line: string) => void) => Promise<T>): Promise<{ result: T; output: string }> {
  const lines: string[] = [];
  const result = await run((line) => lines.push(line));
  return { result, output: lines.join("\n") };
}

async function withEnv<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.env[name] = "1";
  try {
    return await run();
  } finally {
    delete process.env[name];
  }
}

beforeAll(() => {
  makeCoherence();
  makePostHog();
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the dogfood kit", () => {
  test("sets up a patched Coherence and a one-language worktree, and tears it down without a trace", async () => {
    const before = posthogState();
    const dir = join(scratch, "kit-ts");

    const { output } = await captured((print) => setUp({ dir, ref: "master", language: "typescript", hooks: true }, environment, print));

    expect(git(join(dir, "coherence"), "log", "--format=%s", "-3").split("\n")).toEqual(["second", "first", "base"]);
    expect(readlinkSync(join(dir, "posthog/node_modules"))).toBe(join(posthog, "node_modules"));
    expect(readlinkSync(join(dir, "posthog/nodejs/node_modules"))).toBe(join(posthog, "nodejs/node_modules"));
    expect(JSON.parse(readFileSync(join(dir, "posthog/coherence.config.json"), "utf8"))).toEqual({
      language: "typescript",
      ignore: ["node_modules"],
      lint: { oxlint: { command: [environment.oxlint, "-c", "nodejs/.oxlintrc.nodejs.json", "--format", "json", "nodejs"], format: "oxlint-json" } },
    });
    expect(JSON.parse(readFileSync(join(dir, "posthog/nodejs/.oxlintrc.nodejs.json"), "utf8"))).toEqual({
      ignorePatterns: ["nodejs/dist", "**/dev/**", "!nodejs/.eslintrc.js"],
      jsPlugins: ["eslint-plugin-no-only-tests", join(dir, "coherence/src/adapters/lint.ts")],
      options: { typeAware: false },
      rules: { "no-console": "error", "coherence/chokepoint": ["error", { root: join(dir, "posthog") }] },
    });
    expect(JSON.parse(readFileSync(join(dir, "posthog/nodejs/src/sidecar/.oxlintrc.json"), "utf8"))).toEqual({
      categories: { correctness: "error" },
      jsPlugins: [join(dir, "coherence/src/adapters/lint.ts")],
      rules: { "coherence/chokepoint": ["error", { root: join(dir, "posthog") }] },
    });
    expect(readFileSync(join(dir, "posthog/.claude/settings.json"), "utf8")).toContain("coherence hook PostToolUse");
    expect(output).toContain(`export COHERENCE_HOME=${join(dir, "coherence")}`);
    expect(posthogState().settings).toBe(before.settings);

    await tearDown(dir, () => {});

    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(posthog, "node_modules/.bin/oxlint"))).toBe(true);
    expect(posthogState()).toEqual(before);
  });

  test("a Python worktree lints with ruff, leaves the oxlint config alone, and installs no hooks unasked", async () => {
    const dir = join(scratch, "kit-py");

    await setUp({ dir, ref: "master", language: "python", hooks: false }, environment, () => {});

    expect(JSON.parse(readFileSync(join(dir, "posthog/coherence.config.json"), "utf8"))).toEqual({
      language: "python",
      ignore: ["node_modules"],
      lint: { ruff: { command: RUFF, format: "ruff-json" } },
    });
    expect(readFileSync(join(dir, "posthog/nodejs/.oxlintrc.nodejs.json"), "utf8")).toContain("// the nodejs lint");
    expect(readFileSync(join(dir, "posthog/.claude/settings.json"), "utf8")).toBe("{}\n");

    await tearDown(dir, () => {});
  });

  test("fetches a ref PostHog lacks into refs/uml-pr-review, and teardown deletes it", async () => {
    const before = posthogState();
    const dir = join(scratch, "kit-pull");

    await setUp({ dir, ref: "pull/7/head", language: "typescript", hooks: false }, environment, () => {});

    expect(git(posthog, "rev-parse", "refs/uml-pr-review/pull/7/head")).toBe(git(posthog, "rev-parse", "master"));
    expect(git(join(dir, "posthog"), "rev-parse", "HEAD")).toBe(git(posthog, "rev-parse", "master"));

    await tearDown(dir, () => {});

    expect(posthogState()).toEqual(before);
  });

  test("a setup that fails after fetching removes its worktree, its fetched ref, and its folder", async () => {
    const before = posthogState();
    const dir = join(scratch, "kit-broken");

    await withEnv("FAKE_HOOKS_FAIL", async () => {
      await expect(setUp({ dir, ref: "pull/7/head", language: "typescript", hooks: true }, environment, () => {})).rejects.toThrow("hooks install exited 3");
    });

    expect(existsSync(dir)).toBe(false);
    expect(posthogState()).toEqual(before);
  });

  test("a setup whose series disagree on BASE fails before touching PostHog", async () => {
    const before = posthogState();
    const dir = join(scratch, "kit-bases");
    const disagreeing = join(scratch, "disagreeing-series");
    makeSeries(disagreeing, ["one", "two"], (name, real) => (name === "one" ? real : "0".repeat(40)));

    await expect(setUp({ dir, ref: "master", language: "typescript", hooks: false }, { ...environment, seriesRoot: disagreeing, series: ["one", "two"] }, () => {})).rejects.toThrow("name different BASE commits");

    expect(existsSync(dir)).toBe(false);
    expect(posthogState()).toEqual(before);
  });

  test("refuses to set up inside PostHog", async () => {
    await expect(setUp({ dir: join(posthog, "kit"), ref: "master", language: "typescript", hooks: false }, environment, () => {})).rejects.toThrow("which the kit must never write to");
  });

  test("refuses to tear down a folder the kit did not set up", async () => {
    const stranger = join(scratch, "stranger");
    mkdirSync(stranger);

    await expect(tearDown(stranger, () => {})).rejects.toThrow("not a kit folder");
    expect(lstatSync(stranger).isDirectory()).toBe(true);
  });

  describe("witnessing an invariant's enforcer", () => {
    const typescript = join(scratch, "kit-witness-ts");
    const python = join(scratch, "kit-witness-py");
    beforeAll(async () => {
      await setUp({ dir: typescript, ref: "master", language: "typescript", hooks: false }, environment, () => {});
      await setUp({ dir: python, ref: "master", language: "python", hooks: false }, environment, () => {});
    });
    afterAll(async () => {
      await tearDown(typescript, () => {});
      await tearDown(python, () => {});
    });

    test("a TypeScript chokepoint goes red when oxlint's coherence/chokepoint flags the staged import, then green", async () => {
      const { result, output } = await captured((print) => witness(typescript, "src/store/one door", print));

      expect(result).toBe(true);
      expect(output).toContain('staged src/store/kitWitnessBypass.ts: import * as bypass from "./secrets";');
      expect(output).toMatch(/red[^]*1 coherence\(chokepoint\) finding\(s\) under src\/store\/kitWitnessBypass\.ts[^]*green[^]*0 coherence\(chokepoint\) finding\(s\) under src\/store:/);
      expect(existsSync(join(typescript, "posthog/src/store/kitWitnessBypass.ts"))).toBe(false);
    });

    test("a Python chokepoint goes red in Coherence's run on a staged import of the protected name", async () => {
      const { result, output } = await captured((print) => witness(python, "posthog/helpers/one impersonation check", print));

      expect(result).toBe(true);
      expect(output).toContain("staged posthog/helpers/kit_witness_bypass.py: from posthog.models.activity_logging.model_activity import is_impersonated_session");
      expect(output).toMatch(/red[^]*"verdict":"fail"[^]*green[^]*"verdict":"pass"/);
    });

    test("a lint totality oracle whose name holds a slash is refuted with the matching import staged, then passes", async () => {
      const { result, output } = await captured((print) => witness(typescript, "src/store/never reaches ~/cdp", print));

      expect(result).toBe(true);
      expect(output).toContain('staged src/store/kitWitnessBypass.ts: import "~/cdp";');
      expect(output).toMatch(/red[^]*refute src\/store\/never reaches ~\/cdp[^]*\[exit 0\][^]*green[^]*"verdict":"pass"/);
    });

    test("a ruff banned-api oracle over a top-level module stages an import of that module", async () => {
      const { result, output } = await captured((print) => witness(python, "posthog/helpers/no requests", print));

      expect(result).toBe(true);
      expect(output).toContain("staged posthog/helpers/kit_witness_bypass.py: import requests");
    });

    test("an enforcer that never goes red fails the witness", async () => {
      const { result, output } = await withEnv("FAKE_ENFORCER_BLIND", () => captured((print) => witness(typescript, "src/store/one door", print)));

      expect(result).toBe(false);
      expect(output).toContain("the enforcer did not go red with the bypass staged: pass");
    });

    test("an invariant the specs do not declare is named in the error", async () => {
      await expect(witness(typescript, "src/store/no such thing", () => {})).rejects.toThrow('no invariant declared as "src/store/no such thing"');
    });
  });
});
