import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Iteration } from "../../coherence/loop/state.ts";
import { fakeGh, type FakeGh } from "./loop-fake-gh.ts";

const inbox = join(import.meta.dir, "../../coherence/inbox.ts");

let gh: FakeGh;
let directory: string;

function iteration(overrides: Partial<Iteration> = {}): Iteration {
  return {
    sense: join(directory, "a.sense.json"),
    senseId: "2026-09-26T20:00:00.000Z",
    repository: "/repos/app",
    scope: "products/a",
    scopeName: "a",
    rules: "/repos/rules.json",
    base: { ref: "upstream/master", commit: "abc123abc123abc123" },
    slug: "backend-core-facade",
    busyFiles: [],
    action: "ask",
    target: { rank: 1, module: "products/a/backend/core", score: 0.4, step: "facade", verification: "boundary", reason: "2 imports bypass the facade", evidence: [], busyFiles: [] },
    answer: null,
    question: {
      title: "Coherence: facade for products/a/backend/core?",
      question: "Should the coherence loop put a facade in front of `products/a/backend/core`?",
      context: "Rank 1 of 3 in `products/a`.",
      options: ["Approve: go ahead.", "Amend: use the given boundary.", "Skip: leave it alone."],
      raised: null,
    },
    workspace: null,
    verification: null,
    proposal: null,
    ...overrides,
  };
}

async function writeIteration(value: Iteration): Promise<string> {
  const path = join(directory, value.slug);
  await Bun.write(join(path, "iteration.json"), JSON.stringify(value));
  return path;
}

async function run<T>(args: string[]): Promise<{ code: number; json: T }> {
  const child = Bun.spawn(["bun", inbox, ...args], { stdout: "pipe", stderr: "pipe", env: gh.env });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { code, json: JSON.parse(stdout) as T };
}

beforeEach(async () => {
  gh = await fakeGh();
  directory = await mkdtemp(join(tmpdir(), "coherence-inbox-"));
});

afterEach(async () => {
  await gh.cleanup();
  await rm(directory, { recursive: true, force: true });
});

describe("the question inbox", () => {
  test("raises the drafted question as a labelled issue in Silthus/uml-pr-review, with context and options", async () => {
    const path = await writeIteration(iteration());

    const raised = await run<{ number: number; url: string }>(["raise", "--iteration", path]);
    const [issue] = (await gh.state()).issues;

    expect(raised.json).toEqual({ number: 100, url: "https://github.com/Silthus/uml-pr-review/issues/100" });
    expect((await gh.state()).labels).toEqual(["coherence:question"]);
    expect(issue!.title).toBe("Coherence: facade for products/a/backend/core?");
    expect(issue!.body).toContain("## Context\n\nRank 1 of 3 in `products/a`.");
    expect(issue!.body).toContain("- [ ] A. Approve: go ahead.\n- [ ] B. Amend: use the given boundary.\n- [ ] C. Skip: leave it alone.");
    expect((await Bun.file(join(path, "iteration.json")).json()).question.raised).toEqual(raised.json);
    expect((await gh.calls()).every(({ args }) => args.at(-2) === "--repo" && args.at(-1) === "Silthus/uml-pr-review")).toBe(true);
  });

  test("raises the agent's own question for a target it was about to act on", async () => {
    const path = await writeIteration(iteration({ action: "act", question: null, slug: "backend-jobs-characterisation-tests" }));

    await run(["raise", "--iteration", path, "--question", "Which module owns retries?", "--context", "Two modules retry.", "--option", "jobs", "--option", "store"]);

    expect((await gh.state()).issues[0]!.body).toStartWith("Which module owns retries?\n\n## Context\n\nTwo modules retry.");
  });

  test("refuses to raise the same iteration twice", async () => {
    const path = await writeIteration(iteration());
    await run(["raise", "--iteration", path]);

    const again = await run<{ error: string }>(["raise", "--iteration", path]);

    expect(again.code).toBe(1);
    expect(again.json.error).toContain("already raised https://github.com/Silthus/uml-pr-review/issues/100");
    expect((await gh.state()).issues).toHaveLength(1);
  });

  test("closing a question as not planned skips its target", async () => {
    await run(["raise", "--iteration", await writeIteration(iteration())]);

    await run(["resolve", "100", "--skip"]);

    expect((await run<{ answer: string | null }[]>(["list", "--state", "resolved"])).json).toEqual([expect.objectContaining({ number: 100, answer: null })]);
    expect((await gh.calls()).at(-2)?.args).toEqual(["issue", "close", "100", "--reason", "not planned", "--repo", "Silthus/uml-pr-review"]);
  });

  test("refuses to resolve an issue that is not one of its questions", async () => {
    await gh.cleanup();
    gh = await fakeGh({ issues: [{ number: 72, url: "https://github.com/Silthus/uml-pr-review/issues/72", title: "a ticket", state: "OPEN", stateReason: null, labels: [], body: "", comments: [] }] });

    const refused = await run<{ error: string }>(["resolve", "72", "--skip"]);

    expect(refused).toEqual({ code: 1, json: { error: "#72 is not labelled coherence:question; the inbox only resolves its own questions" } });
    expect((await gh.state()).issues[0]!.state).toBe("OPEN");
  });

  test("reads a comment choosing the Skip option as a skip", async () => {
    await run(["raise", "--iteration", await writeIteration(iteration())]);

    await run(["resolve", "100", "--answer", "C"]);

    expect((await run<{ answer: string | null }[]>(["list", "--state", "resolved"])).json[0]!.answer).toBeNull();
  });

  test("reads answers only from people with a role in the repository", async () => {
    await run(["raise", "--iteration", await writeIteration(iteration())]);
    const state = await gh.state();
    state.issues[0]!.state = "CLOSED";
    state.issues[0]!.comments.push({ body: "A: approve", authorAssociation: "OWNER" }, { body: "B: do something else entirely", authorAssociation: "NONE" });
    await Bun.write(gh.env.FAKE_GH_STATE!, JSON.stringify(state));

    expect((await run<{ answer: string | null }[]>(["list", "--state", "resolved"])).json[0]!.answer).toBe("A: approve");
  });

  test("lists open questions and reads the answer of a resolved one", async () => {
    await run(["raise", "--iteration", await writeIteration(iteration())]);
    await run(["raise", "--iteration", await writeIteration(iteration({ slug: "backend-store-facade", target: { ...iteration().target, module: "products/a/backend/store" } }))]);

    await run(["resolve", "100", "--answer", "A: go ahead, the facade is products/a/backend/core/api.py"]);

    expect((await run<{ module: string }[]>(["list"])).json.map(({ module }) => module)).toEqual(["products/a/backend/store"]);
    expect((await run(["list", "--state", "resolved"])).json).toEqual([
      {
        number: 100,
        url: "https://github.com/Silthus/uml-pr-review/issues/100",
        title: "Coherence: facade for products/a/backend/core?",
        scope: "products/a",
        module: "products/a/backend/core",
        step: "facade",
        state: "resolved",
        answer: "A: go ahead, the facade is products/a/backend/core/api.py",
      },
    ]);
  });
});
