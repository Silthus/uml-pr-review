import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubPushGuard } from "../../benchmark/lib/invocation.ts";
import { git } from "../../src/git.ts";
import type { LedgerEntry } from "../../coherence/loop/ledger.ts";
import type { Iteration, Question, Sense } from "../../coherence/loop/state.ts";
import type { Verification } from "../../coherence/loop/verification.ts";
import { temporaryRepository, type Files, type TemporaryRepository } from "../architecture/index/repository.ts";
import { fakeGh, type FakeGh } from "./loop-fake-gh.ts";

const toolTimeoutMs = 180_000;
const loop = join(import.meta.dir, "../../coherence/loop");
const inbox = join(import.meta.dir, "../../coherence/inbox.ts");
const day = new Date().toISOString().slice(0, 10);

const branchy = (name: string, branches: number) =>
  `def ${name}(value):\n${Array.from({ length: branches }, (_, index) => `    if value == ${index}:\n        return ${index}\n`).join("")}    return -1\n`;

const product: Files = {
  "products/__init__.py": "",
  "products/a/__init__.py": "",
  "products/a/backend/__init__.py": "",
  "products/a/backend/facade/__init__.py": "",
  "products/a/backend/facade/api.py": "from products.a.backend.store.rows import save\n\n\ndef run(value):\n    return save(value)\n",
  "products/a/backend/core/__init__.py": "",
  "products/a/backend/core/engine.py": branchy("step", 14),
  "products/a/backend/jobs/__init__.py": "",
  "products/a/backend/jobs/runner.py": branchy("dispatch", 14),
  "products/a/backend/store/__init__.py": "",
  "products/a/backend/store/rows.py": "def save(value):\n    return value\n",
  "products/a/backend/test/__init__.py": "",
  "products/a/backend/test/test_api.py": "from products.a.backend.facade.api import run\n\n\ndef test_run():\n    assert run(1) == 1\n",
  "products/a/backend/test/test_engine.py": "from products.a.backend.core.engine import step\n\n\ndef test_step():\n    assert step(1) == 1\n",
  "products/b/__init__.py": "",
  "products/b/backend/__init__.py": "",
  "products/b/backend/consumer.py": "from products.a.backend.core.engine import step\n\n\ndef consume():\n    return step(2)\n",
};

const rules = {
  components: [{ name: "Jobs", paths: ["products/a/backend/jobs/runner.py"] }],
  rules: [
    {
      id: "jobs-retry-once",
      statement: "Jobs retry once.",
      kind: "invariant",
      component: "Jobs",
      currentLevel: "review-only",
      proposedLevel: "linted",
      evidence: [{ url: "https://github.com/acme/app/pull/4#discussion_r4", source: "review" }],
    },
  ],
};

const characterisationTest = "from products.a.backend.jobs.runner import dispatch\n\n\ndef test_dispatch_returns_the_matching_branch():\n    assert dispatch(3) == 3\n\n\ndef test_dispatch_falls_back_to_minus_one():\n    assert dispatch(99) == -1\n";
const summary = "## What changed\n\nCharacterisation tests pin `dispatch`.\n\n## Review in 2 minutes\n\nRead the two tests; they call the public function only.\n";

const openPullRequest = "https://github.com/acme/app/pull/11";
const closedPullRequest = "https://github.com/acme/app/pull/12";
const mergedPullRequest = "https://github.com/acme/app/pull/13";
const mergedAfterTheBase = "https://github.com/acme/app/pull/14";
const draftPullRequest = "https://github.com/acme/app/pull/4242";

let repository: TemporaryRepository;
let fork: string;
let scratch: string;
let gh: FakeGh;
let senseTemplate: Sense;
const workspaces: { path: string; branch: string }[] = [];

type Cli<T> = { code: number; json: T };

async function cli<T>(command: string[], env: Record<string, string> = gh.env): Promise<Cli<T>> {
  const child = Bun.spawn(["bun", ...command], { stdout: "pipe", stderr: "pipe", env });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  try {
    return { code, json: JSON.parse(stdout) as T };
  } catch {
    throw new Error(`bun ${command.join(" ")} printed no JSON (${code}): ${stdout}\n${stderr}`);
  }
}

const step = <T>(script: string, args: string[], env?: Record<string, string>) => cli<T>([join(loop, script), ...args], env);

async function commitAs(author: string, changes: Files, daysAgo = 0): Promise<void> {
  await repository.write(changes);
  await repository.git("add", "--all");
  const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const child = Bun.spawn(["git", "-c", `user.name=${author}`, "-c", `user.email=${author}@example.com`, "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", `change by ${author}`], {
    cwd: repository.dir,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  if ((await child.exited) !== 0) throw new Error("commit failed");
}

async function freshRuns(change: (sense: Sense) => Sense = (sense) => sense, ledger: LedgerEntry[] = []): Promise<string> {
  const runs = await mkdtemp(join(scratch, "runs-"));
  const sense = change({ ...senseTemplate, id: new Date().toISOString() });
  const path = join(runs, day, "a.sense.json");
  await Bun.write(path, JSON.stringify(sense));
  await Bun.write(join(runs, "ledger.jsonl"), ledger.map((entry) => JSON.stringify({ ...entry, sense: entry.sense === "this run" ? sense.id : entry.sense })).join("\n"));
  return path;
}

function question(overrides: Partial<Question>): Question {
  return { number: 7, url: "https://github.com/Silthus/uml-pr-review/issues/7", title: "q", scope: "products/a", module: "products/a/backend/core", step: "facade", state: "open", answer: null, ...overrides };
}

function ledgerEntry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    at: new Date().toISOString(),
    sense: "earlier",
    scope: "products/a",
    module: "products/a/backend/jobs",
    step: "characterisation-tests",
    verification: "mechanical",
    outcome: "proposed",
    mode: "dry-run",
    indexDelta: null,
    questions: [],
    branch: "coherence/a/backend-jobs-characterisation-tests",
    pullRequest: `${day}/backend-jobs-characterisation-tests/pr.md`,
    note: null,
    ...overrides,
  };
}

async function readLedgerOf(iteration: string): Promise<LedgerEntry[]> {
  return (await Bun.file(join(iteration, "..", "..", "ledger.jsonl")).text()).split("\n").filter(Boolean).map((line) => JSON.parse(line) as LedgerEntry);
}

type Chosen = { iteration: string; action: "act" | "ask" | "done"; reason?: string; target: Iteration["target"]; answer?: Question | null; question?: Iteration["question"] };

async function committedChange(sensePath: string, files: Files): Promise<{ iteration: string; workspace: string; branch: string }> {
  const chosen = (await step<Chosen>("choose.ts", ["--sense", sensePath])).json;
  const workspace = await mkdtemp(join(scratch, "workspace-"));
  await rm(workspace, { recursive: true });
  const { json } = await step<{ path: string; branch: string }>("workspace.ts", ["--iteration", chosen.iteration, "--path", workspace]);
  workspaces.push(json);
  for (const [path, content] of Object.entries(files)) await (content === null ? rm(join(json.path, path)) : Bun.write(join(json.path, path), content));
  await git(json.path, ["add", "--all"]);
  await git(json.path, ["-c", "user.name=Loop", "-c", "user.email=loop@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Pin dispatch with characterisation tests"]);
  return { iteration: chosen.iteration, workspace: json.path, branch: json.branch };
}

async function summaryFile(): Promise<string> {
  const path = join(await mkdtemp(join(scratch, "summary-")), "summary.md");
  await writeFile(path, summary);
  return path;
}

async function forkBranches(): Promise<string> {
  return git(fork, ["branch", "--list"]);
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "coherence-loop-"));
  repository = await temporaryRepository({});
  await commitAs("old", product, 200);
  await commitAs("ada", { "products/a/backend/jobs/runner.py": branchy("dispatch", 15) });
  await commitAs("bob", { "products/a/backend/jobs/runner.py": branchy("dispatch", 16) });
  await commitAs("cy", { "products/a/backend/core/engine.py": branchy("step", 15) });
  await commitAs("dee", { "products/a/backend/core/engine.py": branchy("step", 16) });
  await commitAs("eve", { "products/a/backend/core/engine.py": branchy("step", 17) });
  await commitAs("fay", { "products/a/backend/store/rows.py": branchy("save", 12) });
  fork = join(scratch, "fork.git");
  await git(scratch, ["init", "--quiet", "--bare", fork]);
  await repository.git("remote", "add", "origin", "https://github.com/me/app.git");
  await repository.git("remote", "add", "upstream", "https://github.com/acme/app.git");
  await repository.git("config", `url.${fork}.insteadOf`, "https://github.com/me/app.git");
  await writeFile(join(scratch, "rules.json"), JSON.stringify(rules));
  gh = await fakeGh({
    pullRequestStates: {
      [openPullRequest]: { state: "OPEN", mergeCommit: null },
      [draftPullRequest]: { state: "OPEN", mergeCommit: null },
      [closedPullRequest]: { state: "CLOSED", mergeCommit: null },
      [mergedPullRequest]: { state: "MERGED", mergeCommit: { oid: (await repository.git("rev-parse", "HEAD")).trim() } },
      [mergedAfterTheBase]: { state: "MERGED", mergeCommit: { oid: (await repository.git("commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "merged after the base")).trim() } },
    },
  });
  const sensed = await step<{ sense: string; error?: string }>("sense.ts", ["--repo", repository.dir, "--scope", "products/a", "--base", "main", "--github", "acme/app", "--rules", join(scratch, "rules.json"), "--runs", join(scratch, "runs")]);
  if (sensed.code !== 0) throw new Error(`sense failed: ${sensed.json.error}`);
  senseTemplate = (await Bun.file(sensed.json.sense).json()) as Sense;
}, toolTimeoutMs);

afterEach(async () => {
  for (const { path, branch } of workspaces.splice(0)) {
    await repository.git("worktree", "remove", "--force", path);
    await repository.git("branch", "-D", branch);
    await git(fork, ["branch", "-D", branch]).catch(() => undefined);
  }
});

afterAll(async () => {
  await repository.cleanup();
  await gh.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

describe("one dry-run iteration", () => {
  test(
    "asks about the boundary target, then ends with a local branch, pr.md, and a ledger entry, pushing nothing",
    async () => {
      const sensePath = await freshRuns();

      const first = (await step<Chosen>("choose.ts", ["--sense", sensePath])).json;
      expect(first).toMatchObject({ action: "ask", target: { module: "products/a/backend/core", step: "facade", verification: "boundary" } });
      expect(first.question?.options).toHaveLength(3);
      expect((await cli<{ url: string }>([inbox, "raise", "--iteration", first.iteration])).json.url).toBe("https://github.com/Silthus/uml-pr-review/issues/100");
      expect((await step<{ entry: LedgerEntry }>("record.ts", ["--iteration", first.iteration, "--outcome", "question"])).json.entry.questions).toEqual(["https://github.com/Silthus/uml-pr-review/issues/100"]);

      const change = await committedChange(sensePath, { "products/a/backend/test/test_runner.py": characterisationTest });
      expect(change.branch).toBe("coherence/a/backend-jobs-characterisation-tests");

      const verified = await step<Verification>("verify.ts", ["--iteration", change.iteration]);
      expect(verified.json).toMatchObject({ verdict: "pass", problems: [], changes: { files: ["products/a/backend/test/test_runner.py"], lines: 9 } });
      expect(verified.json.tests).toEqual([expect.objectContaining({ runner: "pytest", status: "not run", reason: expect.stringContaining("no Python test environment") })]);
      expect(verified.json.index.scope).toBe("products/a/backend");
      expect(verified.json.index.dimensions.tests!.after!).toBeGreaterThan(verified.json.index.dimensions.tests!.before!);

      const proposed = await step<{ mode: string; body: string; pullRequest: string | null }>("propose.ts", ["--iteration", change.iteration, "--summary", await summaryFile()]);
      expect(proposed.json).toMatchObject({ mode: "dry-run", body: join(change.iteration, "pr.md"), pullRequest: null });
      const body = await Bun.file(proposed.json.body).text();
      expect(body).toStartWith("# Pin dispatch with characterisation tests\n");
      expect(body).toContain("## Review in 2 minutes");
      expect(body).toContain("Step: **characterisation-tests**. Verification class: **mechanical**.");
      expect(body).toMatch(/\| \*\*tests\*\* \| [\d.]+ \| [\d.]+ \| \+[\d.]+ \|/);
      expect(body).toContain("- pytest on `products/a/backend/test/test_runner.py`: not run locally: no Python test environment");

      const recorded = await step<{ entry: LedgerEntry }>("record.ts", ["--iteration", change.iteration, "--outcome", "proposed"]);
      expect(recorded.json.entry).toMatchObject({ outcome: "proposed", branch: change.branch, pullRequest: `${day}/backend-jobs-characterisation-tests/pr.md`, indexDelta: { scope: "products/a/backend" } });

      expect((await step<unknown>("choose.ts", ["--sense", sensePath])).json).toEqual({ action: "done", reason: "budget spent: 1 of 1 pull requests proposed" });
      expect((await gh.calls()).map(({ args }) => args.slice(0, 2).join(" "))).not.toContain("pr create");
      expect(await forkBranches()).toBe("");
    },
    toolTimeoutMs,
  );
});

describe("choosing the target", () => {
  test("acts on a boundary step once a human answered its question", async () => {
    const answered = question({ state: "resolved", answer: "A: go ahead, the facade is products/a/backend/core/api.py" });
    const choice = (await step<Chosen>("choose.ts", ["--sense", await freshRuns((sense) => ({ ...sense, questions: [answered] }))])).json;

    expect(choice).toMatchObject({ action: "act", target: { module: "products/a/backend/core", step: "facade" }, answer: { answer: answered.answer } });
  });

  test("moves past a boundary target whose question was closed without an answer", async () => {
    const declined = question({ state: "resolved", answer: null });
    const choice = (await step<Chosen>("choose.ts", ["--sense", await freshRuns((sense) => ({ ...sense, questions: [declined] }))])).json;

    expect(choice).toMatchObject({ action: "act", target: { module: "products/a/backend/jobs" } });
  });

  test("moves past a module with an open question", async () => {
    const choice = (await step<Chosen>("choose.ts", ["--sense", await freshRuns((sense) => ({ ...sense, questions: [question({})] }))])).json;

    expect(choice).toMatchObject({ action: "act", target: { module: "products/a/backend/jobs" } });
  });

  test(
    "hands back the unrecorded iteration, workspace included, when choose runs again",
    async () => {
      const sensePath = await freshRuns((sense) => ({ ...sense, maxQuestions: 0 }));
      const change = await committedChange(sensePath, { "products/a/backend/test/test_runner.py": characterisationTest });

      const again = (await step<Chosen & { reused: boolean; workspace: { branch: string } }>("choose.ts", ["--sense", sensePath])).json;

      expect(again).toMatchObject({ iteration: change.iteration, reused: true, workspace: { branch: change.branch } });
    },
    toolTimeoutMs,
  );

  test("acts instead of asking once the run has raised --max-questions questions", async () => {
    const choice = (await step<Chosen>("choose.ts", ["--sense", await freshRuns((sense) => ({ ...sense, maxQuestions: 0 }))])).json;

    expect(choice).toMatchObject({ action: "act", target: { module: "products/a/backend/jobs", step: "characterisation-tests" } });
  });
});

describe("an earlier proposal holds its module only while it is pending", () => {
  const jobs = "products/a/backend/jobs";
  const jobsBranch = "coherence/a/backend-jobs-characterisation-tests";

  async function choiceAfter(earlier: LedgerEntry): Promise<Chosen> {
    return (await step<Chosen>("choose.ts", ["--sense", await freshRuns((sense) => ({ ...sense, maxQuestions: 0 }), [earlier])])).json;
  }

  test("a dry run whose branch is gone gives its module back", async () => {
    expect((await choiceAfter(ledgerEntry({ branch: jobsBranch }))).target.module).toBe(jobs);
  });

  test("a dry run holds its module while its branch exists", async () => {
    await repository.git("branch", jobsBranch, "main");
    try {
      expect((await choiceAfter(ledgerEntry({ branch: jobsBranch }))).target.module).not.toBe(jobs);
    } finally {
      await repository.git("branch", "-D", jobsBranch);
    }
  });

  test("a draft pull request holds its module while it is open", async () => {
    expect((await choiceAfter(ledgerEntry({ mode: "draft", pullRequest: openPullRequest }))).target.module).not.toBe(jobs);
  });

  test("a draft pull request closed without merging gives its module back", async () => {
    expect((await choiceAfter(ledgerEntry({ mode: "draft", pullRequest: closedPullRequest }))).target.module).toBe(jobs);
  });

  test("a merged pull request gives its module back once the sensed base contains the merge", async () => {
    const choice = await choiceAfter(ledgerEntry({ mode: "draft", pullRequest: mergedPullRequest }));

    expect(choice).toMatchObject({ action: "act", target: { module: jobs, step: "characterisation-tests" } });
  });

  test("a merged pull request holds its module until the sensed base contains the merge", async () => {
    expect((await choiceAfter(ledgerEntry({ mode: "draft", pullRequest: mergedAfterTheBase }))).target.module).not.toBe(jobs);
  });
});

describe("verification gates the proposal", () => {
  test(
    "refuses to propose a change that exceeds the line budget",
    async () => {
      const change = await committedChange(await freshRuns((sense) => ({ ...sense, maxQuestions: 0 })), { "products/a/backend/test/test_runner.py": characterisationTest });

      const verified = await step<Verification>("verify.ts", ["--iteration", change.iteration, "--max-lines", "5"]);
      const proposed = await step<{ error: string }>("propose.ts", ["--iteration", change.iteration, "--summary", await summaryFile()]);

      expect(verified.json).toMatchObject({ verdict: "fail", problems: ["9 changed lines exceed the budget of 5; split the change"] });
      expect(proposed).toEqual({ code: 1, json: { error: "the last verification failed: 9 changed lines exceed the budget of 5; split the change" } });
    },
    toolTimeoutMs,
  );
});

describe("verification checks", () => {
  const mechanical = (sense: Sense) => ({ ...sense, maxQuestions: 0 });

  test(
    "fails a change that touches a file an active pull request touches anywhere in the scope",
    async () => {
      const busy = (sense: Sense) => ({ ...mechanical(sense), report: { ...sense.report, busyFiles: [{ path: "products/a/backend/test/test_runner.py", pullRequests: [9] }] } });
      const change = await committedChange(await freshRuns(busy), { "products/a/backend/test/test_runner.py": characterisationTest });

      const verified = await step<Verification>("verify.ts", ["--iteration", change.iteration]);

      expect(verified.json.problems).toEqual(["the change touches files that active pull requests touch: products/a/backend/test/test_runner.py"]);
    },
    toolTimeoutMs,
  );

  test(
    "counts a renamed file only by its edits against the line budget",
    async () => {
      const change = await committedChange(await freshRuns(mechanical), {
        "products/a/backend/test/test_runner.py": characterisationTest,
        "products/a/backend/test/test_engine.py": null,
        "products/a/backend/test/test_engine_steps.py": product["products/a/backend/test/test_engine.py"]!,
      });

      const verified = await step<Verification>("verify.ts", ["--iteration", change.iteration]);

      expect(verified.json.changes).toMatchObject({ lines: 9, files: ["products/a/backend/test/test_engine.py", "products/a/backend/test/test_engine_steps.py", "products/a/backend/test/test_runner.py"] });
    },
    toolTimeoutMs,
  );

  test(
    "lets a facade re-route its callers outside the scope, and only those",
    async () => {
      const approved = (sense: Sense) => ({ ...sense, questions: [question({ state: "resolved", answer: "A: go ahead" })] });
      const change = await committedChange(await freshRuns(approved), {
        "products/a/backend/core/api.py": "from products.a.backend.core.engine import step\n\n__all__ = [\"step\"]\n",
        "products/b/backend/consumer.py": "from products.a.backend.core.api import step\n\n\ndef consume():\n    return step(2)\n",
        "products/b/backend/unrelated.py": "VALUE = 1\n",
      });

      const verified = await step<Verification>("verify.ts", ["--iteration", change.iteration]);

      expect(verified.json.outsideScope).toEqual(["products/b/backend/unrelated.py"]);
    },
    toolTimeoutMs,
  );

  test(
    "reports pytest as not run when a service it needs is unreachable, and as failing otherwise",
    async () => {
      const pytest = join(repository.dir, ".flox", "cache", "venv", "bin", "pytest");
      await Bun.write(pytest, '#!/bin/sh\necho "$FAKE_PYTEST_OUTPUT"\nexit 1\n');
      await chmod(pytest, 0o755);
      try {
        const change = await committedChange(await freshRuns(mechanical), { "products/a/backend/test/test_runner.py": characterisationTest });
        const refused = 'psycopg.OperationalError: connection to server at "localhost" (127.0.0.1), port 5432 failed: Connection refused';

        const unreachable = await step<Verification>("verify.ts", ["--iteration", change.iteration], { ...gh.env, FAKE_PYTEST_OUTPUT: refused });
        const failing = await step<Verification>("verify.ts", ["--iteration", change.iteration], { ...gh.env, FAKE_PYTEST_OUTPUT: "1 failed, 1 passed in 0.12s" });

        expect(unreachable.json.tests).toEqual([expect.objectContaining({ status: "not run", reason: expect.stringContaining("not reachable locally") })]);
        expect(unreachable.json.verdict).toBe("pass");
        expect(failing.json.tests).toEqual([expect.objectContaining({ status: "failed" })]);
        expect(failing.json.problems).toEqual(["pytest fails on products/a/backend/test/test_runner.py"]);
      } finally {
        await rm(join(repository.dir, ".flox"), { recursive: true });
      }
    },
    toolTimeoutMs,
  );
});

describe("the dry-run and draft switch", () => {
  async function verifiedChange() {
    const change = await committedChange(await freshRuns((sense) => ({ ...sense, maxQuestions: 0 })), { "products/a/backend/test/test_runner.py": characterisationTest });
    expect((await step<Verification>("verify.ts", ["--iteration", change.iteration])).json.verdict).toBe("pass");
    return change;
  }

  test(
    "--draft pushes the branch to the fork and opens a draft pull request on upstream",
    async () => {
      const change = await verifiedChange();

      const proposed = await step<{ mode: string; pullRequest: string }>("propose.ts", ["--iteration", change.iteration, "--summary", await summaryFile(), "--draft"]);
      const create = (await gh.calls()).find(({ args }) => args[0] === "pr" && args[1] === "create" && args.includes(`me:${change.branch}`));

      expect(proposed.json).toMatchObject({ mode: "draft", pullRequest: "https://github.com/acme/app/pull/4242" });
      expect(await forkBranches()).toContain(change.branch);
      expect(create?.args).toEqual(["pr", "create", "--draft", "--repo", "acme/app", "--base", "main", "--head", `me:${change.branch}`, "--title", "Pin dispatch with characterisation tests", "--body-file", join(change.iteration, "pr.md")]);
      expect((await step<{ entry: LedgerEntry }>("record.ts", ["--iteration", change.iteration, "--outcome", "proposed"])).json.entry).toMatchObject({ mode: "draft", pullRequest: draftPullRequest });
    },
    toolTimeoutMs,
  );

  test(
    "promoting a recorded dry run with --draft puts the pull request in its ledger entry",
    async () => {
      const change = await verifiedChange();
      await step("propose.ts", ["--iteration", change.iteration, "--summary", await summaryFile()]);
      await step("record.ts", ["--iteration", change.iteration, "--outcome", "proposed"]);

      await step("propose.ts", ["--iteration", change.iteration, "--summary", await summaryFile(), "--draft"]);

      expect(await readLedgerOf(change.iteration)).toEqual([expect.objectContaining({ module: "products/a/backend/jobs", outcome: "proposed", mode: "draft", pullRequest: draftPullRequest })]);
    },
    toolTimeoutMs,
  );

  test(
    "the dry-run session guard stops a --draft push before any pull request opens",
    async () => {
      const change = await verifiedChange();
      const earlierCalls = (await gh.calls()).length;

      const proposed = await step<{ error: string }>("propose.ts", ["--iteration", change.iteration, "--summary", await summaryFile(), "--draft"], { ...gh.env, ...githubPushGuard });

      expect(proposed.code).toBe(1);
      expect(proposed.json.error).toContain("pushes-are-blocked");
      expect(await forkBranches()).not.toContain(change.branch);
      expect((await gh.calls()).slice(earlierCalls)).toEqual([]);
    },
    toolTimeoutMs,
  );
});
