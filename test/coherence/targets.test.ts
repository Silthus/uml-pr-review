import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rankTargets, type Target, type TargetReport, type TargetRequest } from "../../coherence/signals/rank.ts";
import type { SignalReport } from "../../coherence/signals/report.ts";
import { temporaryRepository, type Files, type TemporaryRepository } from "../architecture/index/repository.ts";

const toolTimeoutMs = 120_000;
const scope = "products/a";

const branchy = (name: string, branches: number) =>
  `def ${name}(value):\n${Array.from({ length: branches }, (_, index) => `    if value == ${index}:\n        return ${index}\n`).join("")}    return -1\n`;

const product: Files = {
  "products/__init__.py": "",
  "products/a/__init__.py": "",
  "products/a/backend/__init__.py": "",
  "products/a/backend/facade/__init__.py": "",
  "products/a/backend/facade/api.py": "from products.a.backend.store.rows import save\n\n\ndef run(value):\n    return save(value)\n",
  "products/a/backend/core/__init__.py": "",
  "products/a/backend/core/engine.py": "def step(value):\n    return value + 1\n",
  "products/a/backend/jobs/__init__.py": "",
  "products/a/backend/jobs/runner.py": branchy("dispatch", 14),
  "products/a/backend/store/__init__.py": "",
  "products/a/backend/store/rows.py": "def save(value):\n    return value\n",
  "products/a/backend/limits/__init__.py": "",
  "products/a/backend/limits/check.py": branchy("allowed", 12),
  "products/a/backend/wip/__init__.py": "",
  "products/a/backend/wip/draft.py": "def draft():\n    return 1\n",
  "products/a/backend/test/__init__.py": "",
  "products/a/backend/test/test_api.py": "from products.a.backend.facade.api import run\n\n\ndef test_run():\n    assert run(1) == 1\n",
  "products/a/backend/test/test_engine.py": "from products.a.backend.core.engine import step\n\n\ndef test_step():\n    assert step(1) == 2\n",
  "products/a/backend/test/test_rows.py": "from products.a.backend.store.rows import save\n\n\ndef test_save():\n    assert save(1) == 1\n",
  "products/a/backend/test/test_check.py": "from products.a.backend.limits.check import allowed\n\n\ndef test_allowed():\n    assert allowed(1) == 1\n",
  "products/b/__init__.py": "",
  "products/b/backend/__init__.py": "",
  "products/b/backend/consumer.py": "from products.a.backend.core.engine import step\n\n\ndef consume():\n    return step(2)\n",
  "lint/receivers_baseline.txt": "post_save:products.a.backend.limits.check.allowed\n",
};

const rules = {
  components: [
    { name: "Store", paths: ["products/a/backend/store/"] },
    { name: "Jobs", paths: ["products/a/backend/jobs/runner.py"] },
  ],
  rules: [
    {
      id: "writes-fence-on-the-stamp",
      statement: "Every write checks the loaded stamp.",
      kind: "invariant",
      component: "Store",
      currentLevel: "review-only",
      proposedLevel: "structural",
      evidence: [
        { url: "https://github.com/acme/app/pull/1#discussion_r1", source: "review" },
        { url: "https://github.com/acme/app/pull/2#discussion_r2", source: "review" },
        { url: "https://github.com/acme/app/pull/3#discussion_r3", source: "bot-review" },
        { url: "https://acme.dev/docs/stamps", source: "doc" },
      ],
    },
    {
      id: "jobs-retry-once",
      statement: "Jobs retry once.",
      kind: "invariant",
      component: "Jobs",
      currentLevel: "linted",
      proposedLevel: "linted",
      evidence: [{ url: "https://github.com/acme/app/pull/4#discussion_r4", source: "review" }],
    },
  ],
};

const ciSignals: SignalReport = {
  provider: "posthog",
  source: { host: "us.posthog.com", projectId: 347861 },
  scope,
  collectedAt: "2026-09-26T20:31:00Z",
  rows: [
    {
      path: "products/a/backend/limits/test_limits_flaky.py",
      signal: "ci.test_failures",
      value: 9,
      window: "30d",
      attribution: "exact",
      evidence: [{ kind: "test_file", id: "products/a/backend/limits/test_limits_flaky.py", count: 300 }],
    },
  ],
  unavailable: [{ signal: "errors.occurrences", reason: "project 2 not reachable: switch-project returned 404" }],
};

let repository: TemporaryRepository;
let fixtures: string;
let head: string;

async function commitAs(author: string, changes: Files, daysAgo = 0): Promise<string> {
  await repository.write(changes);
  await repository.git("add", "--all");
  const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const child = Bun.spawn(["git", "-c", `user.name=${author}`, "-c", `user.email=${author}@example.com`, "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", `change by ${author}`], {
    cwd: repository.dir,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  if ((await child.exited) !== 0) throw new Error("commit failed");
  return (await repository.git("rev-parse", "HEAD")).trim();
}

function request(overrides: Partial<TargetRequest> = {}): TargetRequest {
  return {
    repository: repository.dir,
    scope,
    commit: head,
    rules: join(fixtures, "rules.json"),
    signals: ciSignals,
    openPullRequests: async () => ({ repository: "acme/app", pullRequests: [{ number: 42, files: ["products/a/backend/wip/draft.py"] }] }),
    ...overrides,
  };
}

function targetFor(report: TargetReport, module: string): Target {
  const target = report.targets.find((candidate) => candidate.module === module);
  if (!target) throw new Error(`${module} is not ranked: ${report.targets.map(({ module: ranked }) => ranked).join(", ")}`);
  return target;
}

beforeAll(async () => {
  repository = await temporaryRepository({});
  await commitAs("old", product, 200);
  await commitAs("ada", { "products/a/backend/jobs/runner.py": branchy("dispatch", 15) });
  await commitAs("bob", { "products/a/backend/jobs/runner.py": branchy("dispatch", 16) });
  await commitAs("cy", { "products/a/backend/limits/check.py": branchy("allowed", 13) });
  head = await commitAs("dee", { "products/a/backend/wip/draft.py": "def draft():\n    return 2\n" });
  fixtures = await mkdtemp(join(tmpdir(), "coherence-targets-"));
  await writeFile(join(fixtures, "rules.json"), JSON.stringify(rules));
});

afterAll(async () => {
  await repository.cleanup();
  await rm(fixtures, { recursive: true, force: true });
});

describe("ranking", () => {
  test(
    "scores a module as pressure × pain × safety from its churn, findings, complexity, and tests",
    async () => {
      const jobs = targetFor(await rankTargets(request()), "products/a/backend/jobs");

      expect(jobs.factors.pressure.components.map(({ name, raw }) => [name, raw])).toEqual([
        ["commits", 2],
        ["lines", 4],
        ["authors", 2],
      ]);
      expect(jobs.factors.pressure.value).toBeCloseTo((2 / 12 + 4 / 1004 + 2 / 5) / 3, 4);
      expect(jobs.factors.pain.components).toContainEqual(expect.objectContaining({ name: "complexity", raw: 1, evidence: [expect.stringContaining("runner.py:dispatch")] }));
      expect(jobs.factors.pain.components).toContainEqual(expect.objectContaining({ name: "review findings", raw: 1, evidence: [expect.stringContaining("jobs-retry-once")] }));
      expect(jobs.factors.pain.value).toBeCloseTo(1 - (1 - 1 / 11) * (1 - 1 / 6), 4);
      expect(jobs.factors.safety.value).toBe(0.5);
      expect(jobs.score).toBeCloseTo(jobs.factors.pressure.value * jobs.factors.pain.value * 0.5, 4);
    },
    toolTimeoutMs,
  );

  test(
    "ranks a module with pressure above an equally painful module nobody touched",
    async () => {
      const report = await rankTargets(request());
      const ranks = report.targets.map(({ module }) => module);

      expect(targetFor(report, "products/a/backend/store").factors.pain.value).toBeGreaterThan(0);
      expect(targetFor(report, "products/a/backend/store").score).toBe(0);
      expect(ranks.indexOf("products/a/backend/jobs")).toBeLessThan(ranks.indexOf("products/a/backend/store"));
    },
    toolTimeoutMs,
  );

  test(
    "skips modules that open pull requests touch, and says which pull requests",
    async () => {
      const report = await rankTargets(request());

      expect(report.openPullRequests).toEqual({ repository: "acme/app", open: 1 });
      expect(report.skipped).toEqual([{ module: "products/a/backend/wip", pullRequests: [42] }]);
      expect(report.targets.map(({ module }) => module)).not.toContain("products/a/backend/wip");
    },
    toolTimeoutMs,
  );

  test(
    "lifts PostHog signal rows to the module that owns their path",
    async () => {
      const report = await rankTargets(request());
      const ci = targetFor(report, "products/a/backend/limits").factors.pain.components.find(({ name }) => name === "ci flakiness");

      expect(ci).toMatchObject({ raw: 9, evidence: ["products/a/backend/limits/test_limits_flaky.py: ci.test_failures 9 (30d, exact)"] });
      expect(targetFor(report, "products/a/backend/jobs").factors.pain.components.find(({ name }) => name === "ci flakiness")).toMatchObject({ raw: 0 });
    },
    toolTimeoutMs,
  );

  test(
    "counts only the widest window of a signal and service rows at half weight",
    async () => {
      const row = (value: number, window: "30d" | "90d", attribution: "exact" | "service") => ({
        path: "products/a/backend/limits/check.py",
        signal: "errors.occurrences" as const,
        value,
        window,
        attribution,
        evidence: [{ kind: "error_issue" as const, id: `issue-${window}` }],
      });
      const errors: SignalReport = { ...ciSignals, rows: [row(40, "30d", "exact"), row(100, "90d", "exact"), row(20, "90d", "service")], unavailable: [] };
      const limits = targetFor(await rankTargets(request({ signals: errors })), "products/a/backend/limits");

      expect(limits.factors.pain.components.find(({ name }) => name === "production errors")).toMatchObject({ raw: 110 });
    },
    toolTimeoutMs,
  );

  test(
    "rejects a signal report collected for another scope",
    async () => {
      await expect(rankTargets(request({ signals: { ...ciSignals, scope: "products/b" } }))).rejects.toThrow("the signal report covers products/b, not products/a");
    },
    toolTimeoutMs,
  );

  test(
    "lowers the safety of a module that carries heavy traffic",
    async () => {
      const traffic: SignalReport = {
        ...ciSignals,
        rows: [{ path: "products/a/backend/jobs/runner.py", signal: "apm.requests", value: 2_000_000, window: "30d", attribution: "route", evidence: [{ kind: "route", id: "POST api/jobs/" }] }],
      };
      const quiet = targetFor(await rankTargets(request()), "products/a/backend/jobs");
      const busy = targetFor(await rankTargets(request({ signals: traffic })), "products/a/backend/jobs");

      expect(busy.factors.safety.value).toBeLessThan(quiet.factors.safety.value);
      expect(busy.factors.safety.components).toContainEqual(expect.objectContaining({ name: "traffic", raw: 2_000_000, evidence: ["products/a/backend/jobs/runner.py: apm.requests 2000000 (30d, route)"] }));
    },
    toolTimeoutMs,
  );

  test(
    "reports every missing provider as unavailable and still ranks the modules",
    async () => {
      const report = await rankTargets(request({ signals: null, rules: join(fixtures, "missing.json"), openPullRequests: async () => Promise.reject(new Error("gh: not logged in")) }));

      expect(report.targets.map(({ module }) => module)).toContain("products/a/backend/wip");
      expect(report.skipped).toEqual([]);
      expect(report.unavailable).toContainEqual({ signal: "open pull requests", reason: "gh: not logged in" });
      expect(report.unavailable).toContainEqual({ signal: "review findings", reason: expect.stringContaining("missing.json") });
      expect(report.unavailable).toContainEqual({ signal: "errors.occurrences", reason: "no --posthog-signals report given" });
      expect(targetFor(report, "products/a/backend/jobs").factors.pain.components.find(({ name }) => name === "production errors")).toMatchObject({ value: null });
      expect(targetFor(report, "products/a/backend/jobs").score).toBeGreaterThan(0);
    },
    toolTimeoutMs,
  );

  test(
    "keeps a provider's own unavailable signals with its reason",
    async () => {
      const report = await rankTargets(request());

      expect(report.unavailable).toContainEqual({ signal: "errors.occurrences", reason: "project 2 not reachable: switch-project returned 404" });
      expect(report.available).toContain("ci.test_failures");
    },
    toolTimeoutMs,
  );
});

describe("next recipe step", () => {
  test(
    "puts a facade in front of a module that other products import directly",
    async () => {
      const { recommendation } = targetFor(await rankTargets(request()), "products/a/backend/core");

      expect(recommendation).toMatchObject({ step: "facade", verification: "boundary" });
      expect(recommendation.reason).toContain("products/b/backend/consumer.py -> products/a/backend/core/engine.py");
    },
    toolTimeoutMs,
  );

  test(
    "writes characterisation tests for a module that no test references",
    async () => {
      const { recommendation } = targetFor(await rankTargets(request()), "products/a/backend/jobs");

      expect(recommendation).toMatchObject({ step: "characterisation-tests", verification: "mechanical" });
      expect(recommendation.reason).toContain("products/a/backend/jobs/runner.py");
    },
    toolTimeoutMs,
  );

  test(
    "ratchets the harvested rule once the module is tested",
    async () => {
      const { recommendation } = targetFor(await rankTargets(request()), "products/a/backend/store");

      expect(recommendation).toMatchObject({ step: "ratchet-rule", verification: "mechanical" });
      expect(recommendation.reason).toContain("writes-fence-on-the-stamp");
    },
    toolTimeoutMs,
  );

  test(
    "cleans up internals once a tested module sits under a baseline",
    async () => {
      const { recommendation } = targetFor(await rankTargets(request()), "products/a/backend/limits");

      expect(recommendation).toMatchObject({ step: "internal-cleanup", verification: "behaviour-adjacent" });
      expect(recommendation.reason).toContain("lint/receivers_baseline.txt:1");
      expect(recommendation.reason).toContain("allowed");
    },
    toolTimeoutMs,
  );
});

describe("command line", () => {
  test(
    "reads the signal report file and prints the ranking as JSON",
    async () => {
      const signals = join(fixtures, "signals.json");
      await writeFile(signals, JSON.stringify(ciSignals));
      const cli = Bun.spawn(
        ["bun", join(import.meta.dir, "../../coherence/targets.ts"), "--repo", repository.dir, "--scope", scope, "--commit", head, "--rules", join(fixtures, "rules.json"), "--posthog-signals", signals, "--json"],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [output, exitCode] = await Promise.all([new Response(cli.stdout).text(), cli.exited]);
      const report = JSON.parse(output) as TargetReport;

      expect(exitCode).toBe(0);
      expect(report.targets.map(({ module }) => module)).toContain("products/a/backend/jobs");
      expect(report.unavailable).toContainEqual({ signal: "open pull requests", reason: expect.any(String) });
    },
    toolTimeoutMs,
  );

  test(
    "prints the ranking, the missing providers, and the evidence for the top targets",
    async () => {
      const cli = Bun.spawn(["bun", join(import.meta.dir, "../../coherence/targets.ts"), "--repo", repository.dir, "--scope", scope, "--commit", head, "--rules", join(fixtures, "rules.json")], { stdout: "pipe", stderr: "pipe" });
      const [output, exitCode] = await Promise.all([new Response(cli.stdout).text(), cli.exited]);

      expect(exitCode).toBe(0);
      expect(output).toContain("Unavailable: open pull requests (no GitHub upstream or origin remote");
      expect(output).toContain("Unavailable: errors.occurrences (no --posthog-signals report given)");
      expect(output).toMatch(/^ {2}1\. .*products\/a\/backend\/\w+ .*-> [a-z-]+ \((mechanical|behaviour-adjacent|boundary)\)$/m);
      expect(output).toContain("  next: characterisation-tests, mechanical: tests import 0 of 1 files; untested: products/a/backend/jobs/runner.py");
    },
    toolTimeoutMs,
  );

  test("rejects a signal report that does not match the provider shape", async () => {
    const signals = join(fixtures, "broken.json");
    await writeFile(signals, JSON.stringify({ ...ciSignals, rows: [{ path: "x", signal: "ci.flakes", value: 1 }] }));
    const cli = Bun.spawn(["bun", join(import.meta.dir, "../../coherence/targets.ts"), "--repo", repository.dir, "--scope", scope, "--posthog-signals", signals], { stdout: "pipe", stderr: "pipe" });
    const [errors, exitCode] = await Promise.all([new Response(cli.stderr).text(), cli.exited]);

    expect(exitCode).not.toBe(0);
    expect(errors).toContain("broken.json");
  });
});
