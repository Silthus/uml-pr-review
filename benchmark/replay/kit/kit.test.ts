import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setUp, tearDown, witness, type KitEnvironment } from "./kit.ts";

const scratch = mkdtempSync(join(tmpdir(), "kit-test-"));
const posthog = join(scratch, "posthog");
const posthogRemote = join(scratch, "posthog-remote");
const coherenceRemote = join(scratch, "coherence-remote");
const seriesRoot = join(scratch, "series");

const environment: KitEnvironment = {
  posthog,
  posthogRemote,
  coherenceRemote,
  seriesRoot,
  series: ["first", "second"],
  oxlint: join(posthog, "node_modules/.bin/oxlint"),
  ruff: ["ruff", "check", "--force-exclude", "--output-format", "json"],
};

const FAKE_COHERENCE = `
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [command, ...rest] = process.argv.slice(2);
const cwd = process.cwd();
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".git" || name.endsWith(".spec.md")) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const seen = (text, allowed = []) => process.env.FAKE_COHERENCE_BLIND !== "1" && files(cwd).some((f) => !allowed.includes(f) && readFileSync(f, "utf8").includes(text));
if (command === "hooks") {
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  writeFileSync(join(cwd, ".claude/settings.json"), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "coherence hook PostToolUse" }] }] } }));
} else if (command === "refute") {
  console.log("refute " + rest[0]);
  process.exit(seen('"~/cdp"') ? 0 : 1);
} else if (command === "run") {
  const name = rest[rest.indexOf("--invariant") + 1];
  const verdict = seen("./secrets", [join(cwd, "src/store/door.ts")]) ? "fail" : "pass";
  console.log(JSON.stringify({ invariants: [{ component: "src/store", name, verdict }] }));
  process.exit(verdict === "fail" ? 1 : 0);
}
`;

const SPEC = `# Store

## invariants
- one door: The store is read only through the door.
  protects: src/store/secrets.ts
  chokepoint: seal in src/store/door.ts
  because: the door seals

- no cdp: The store never imports cdp.
  over: every import under src/store
  via: lint oxlint:no-restricted-imports matching "~/cdp"
  because: they deploy apart
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

function makeCoherence() {
  mkdirSync(coherenceRemote);
  git(coherenceRemote, "init", "-q");
  write(coherenceRemote, "package.json", JSON.stringify({ name: "fake-coherence", type: "module" }));
  write(coherenceRemote, "src/cli.ts", FAKE_COHERENCE);
  const base = commitAll(coherenceRemote, "base");
  environment.series.forEach((series, index) => {
    write(coherenceRemote, `series-${index}.txt`, series);
    commitAll(coherenceRemote, series);
    mkdirSync(join(seriesRoot, series), { recursive: true });
    writeFileSync(join(seriesRoot, series, "BASE"), `${base}\n`);
    git(coherenceRemote, "format-patch", "-q", "-1", "-o", join(seriesRoot, series));
    git(coherenceRemote, "reset", "-q", "--hard", base);
  });
}

function makePostHog() {
  mkdirSync(posthog);
  git(posthog, "init", "-q", "-b", "master");
  write(posthog, ".gitignore", "node_modules\n");
  write(posthog, ".claude/settings.json", "{}\n");
  write(posthog, "nodejs/.oxlintrc.nodejs.json", '{\n  // the nodejs lint\n  "ignorePatterns": ["dist", "**/dev/**", "!.eslintrc.js"],\n  "jsPlugins": ["eslint-plugin-no-only-tests"],\n  "options": { "typeAware": true, "reportUnusedDisableDirectives": "error" },\n  "rules": { "no-console": "error" },\n}\n');
  write(posthog, "src/store/Store.spec.md", SPEC);
  write(posthog, "src/store/secrets.ts", "export const secret = 1;\n");
  write(posthog, "src/store/door.ts", 'import { secret } from "./secrets";\nexport const seal = () => secret;\n');
  commitAll(posthog, "master");
  write(posthog, "node_modules/.bin/oxlint", "#!/bin/sh\n");
  write(posthog, "nodejs/node_modules/marker", "");
  git(scratch, "clone", "-q", "--bare", posthog, posthogRemote);
  git(posthogRemote, "update-ref", "refs/pull/7/head", git(posthogRemote, "rev-parse", "master"));
}

function posthogState() {
  return { worktrees: git(posthog, "worktree", "list", "--porcelain"), status: git(posthog, "status", "--porcelain"), settings: readFileSync(join(posthog, ".claude/settings.json"), "utf8") };
}

async function captured<T>(run: (print: (line: string) => void) => Promise<T>): Promise<{ result: T; output: string }> {
  const lines: string[] = [];
  const result = await run((line) => lines.push(line));
  return { result, output: lines.join("\n") };
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
      lint: { ruff: { command: environment.ruff, format: "ruff-json" } },
    });
    expect(readFileSync(join(dir, "posthog/nodejs/.oxlintrc.nodejs.json"), "utf8")).toContain("// the nodejs lint");
    expect(readFileSync(join(dir, "posthog/.claude/settings.json"), "utf8")).toBe("{}\n");

    await tearDown(dir, () => {});
  });

  test("fetches a ref PostHog lacks into refs/uml-pr-review, and teardown deletes it", async () => {
    const dir = join(scratch, "kit-pull");

    await setUp({ dir, ref: "pull/7/head", language: "typescript", hooks: false }, environment, () => {});

    expect(git(posthog, "rev-parse", "refs/uml-pr-review/pull/7/head")).toBe(git(posthog, "rev-parse", "master"));
    expect(git(join(dir, "posthog"), "rev-parse", "HEAD")).toBe(git(posthog, "rev-parse", "master"));

    await tearDown(dir, () => {});

    expect(git(posthog, "for-each-ref", "refs/uml-pr-review")).toBe("");
  });

  test("refuses to tear down a folder the kit did not set up", async () => {
    const stranger = join(scratch, "stranger");
    mkdirSync(stranger);

    await expect(tearDown(stranger, () => {})).rejects.toThrow("not a kit folder");
    expect(lstatSync(stranger).isDirectory()).toBe(true);
  });

  describe("witnessing an invariant's enforcer", () => {
    const dir = join(scratch, "kit-witness");
    beforeAll(() => setUp({ dir, ref: "master", language: "typescript", hooks: false }, environment, () => {}));
    afterAll(() => tearDown(dir, () => {}));

    test("a chokepoint goes red on a staged import of the protected module, then green once it is removed", async () => {
      const { result, output } = await captured((print) => witness(dir, "src/store/one door", print));

      expect(result).toBe(true);
      expect(output).toContain('staged src/store/kitWitnessBypass.ts: import * as bypass from "./secrets";');
      expect(output).toMatch(/red[^]*"verdict":"fail"[^]*green[^]*"verdict":"pass"/);
      expect(existsSync(join(dir, "posthog/src/store/kitWitnessBypass.ts"))).toBe(false);
    });

    test("a lint totality oracle is refuted with the matching import staged, then passes the run", async () => {
      const { result, output } = await captured((print) => witness(dir, "src/store/no cdp", print));

      expect(result).toBe(true);
      expect(output).toContain('staged src/store/kitWitnessBypass.ts: import "~/cdp";');
      expect(output).toMatch(/red[^]*refute src\/store\/no cdp[^]*green/);
    });

    test("an enforcer that never goes red fails the witness", async () => {
      process.env["FAKE_COHERENCE_BLIND"] = "1";
      try {
        const { result, output } = await captured((print) => witness(dir, "src/store/one door", print));

        expect(result).toBe(false);
        expect(output).toContain("the enforcer stayed green with the bypass staged");
      } finally {
        delete process.env["FAKE_COHERENCE_BLIND"];
      }
    });

    test("an invariant the specs do not declare is named in the error", async () => {
      await expect(witness(dir, "src/store/no such thing", () => {})).rejects.toThrow('no invariant "no such thing" in src/store');
    });
  });
});
