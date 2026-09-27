import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CollectedPullRequest, collectPullRequests } from "../../benchmark/corrections/collect.ts";
import { codeComments, type CorpusComment } from "../../benchmark/corrections/comments.ts";
import { corpusRows, heldOutDigest, jsonLines } from "../../benchmark/corrections/corpus.ts";
import { locateFixes } from "../../benchmark/corrections/fixes.ts";
import { cachedGraphql, type Graphql, type Transport } from "../../benchmark/corrections/github.ts";
import { type ConfirmationLabel, confirmationLabelSchema, firstPassLabelSchema, keepAnyCandidate, precision, readLabels, recallEstimate } from "../../benchmark/corrections/labels.ts";
import { repositoryWithoutCommits, type TemporaryRepository } from "../architecture/index/repository.ts";

const reviewer = { login: "reviewer", __typename: "User" };
const author = { login: "author", __typename: "User" };
const greptile = { login: "greptile-apps", __typename: "Bot" };

function indexed(number: number, mergedAt: string, threads: number) {
  return {
    number,
    url: `https://github.com/PostHog/posthog/pull/${number}`,
    title: `PR ${number}`,
    mergedAt,
    author,
    baseRefName: "master",
    baseRefOid: "base",
    headRefOid: `head${number}`,
    mergeCommit: { oid: `merge${number}` },
    files: { totalCount: 1, nodes: [{ path: "products/surveys/backend/api.py" }] },
    reviewThreads: { totalCount: threads },
    reviews: { totalCount: 1 },
    commits: { totalCount: 2 },
  };
}

function comment(pr: number, id: number, who: typeof reviewer | null, body: string, path = "products/surveys/backend/api.py") {
  return { author: who, body, url: `https://github.com/PostHog/posthog/pull/${pr}#discussion_r${id}`, path, line: 12, originalLine: 12, createdAt: "2026-07-30T10:00:00Z" };
}

function details(number: number, threads: ReturnType<typeof comment>[][]) {
  return {
    number,
    reviews: { nodes: [{ author: reviewer, body: "This whole module should move into the product's backend.", url: `https://github.com/PostHog/posthog/pull/${number}#pullrequestreview-1`, submittedAt: "2026-07-30T11:00:00Z" }] },
    reviewThreads: { nodes: threads.map((nodes) => ({ comments: { nodes } })) },
    commits: { nodes: [{ commit: { oid: `c${number}a`, committedDate: "2026-07-30T09:00:00Z" } }, { commit: { oid: `c${number}b`, committedDate: "2026-07-30T12:00:00Z" } }] },
  };
}

type SearchPage = { nodes: ReturnType<typeof indexed>[]; next?: string; issueCount?: number };

const searchPages: Record<string, SearchPage[]> = {
  "2026-07-31": [{ nodes: [indexed(10, "2026-07-31T23:59:00Z", 2), indexed(11, "2026-07-31T08:00:00Z", 0)] }],
  "2026-08-01": [{ nodes: [indexed(12, "2026-08-01T00:00:00Z", 1)], next: "cursor-1" }, { nodes: [indexed(13, "2026-08-01T09:00:00Z", 0)] }],
  "2026-08-02": [{ nodes: [], issueCount: 1001 }],
};

const pullRequestDetails: Record<number, ReturnType<typeof details>> = {
  10: details(10, [
    [comment(10, 1, reviewer, "We already have a helper for this in posthog/utils, please reuse it."), comment(10, 2, author, "Good call, switching to the shared helper now.")],
    [comment(10, 3, greptile, "Consider extracting this block into a separate function."), comment(10, 4, reviewer, "QA swarm finding. This comment was not written by a human."), comment(10, 5, reviewer, "lgtm")],
    [comment(10, 7, reviewer, "🤖 *Agent-drafted, reviewed by a teammate.*\n\nMove this into the shared serializer module."), comment(10, 8, reviewer, "AI reply: fixed in abc123, the helper now lives in utils.")],
  ]),
  12: details(12, [[comment(12, 6, reviewer, "This belongs in the service layer, not in the viewset.", "products/surveys/backend/views.py")]]),
};

function fakeGitHub(): { graphql: Graphql; queries: string[] } {
  const queries: string[] = [];
  const graphql: Graphql = async (query, variables) => {
    queries.push(query);
    if (query.includes("search(")) {
      const day = String(variables.q).split("merged:")[1]!;
      const page = searchPages[day]![variables.after === undefined ? 0 : 1]!;
      return { data: { search: { issueCount: page.issueCount ?? 2, pageInfo: { hasNextPage: page.next !== undefined, endCursor: page.next ?? null }, nodes: page.nodes } } };
    }
    const numbers = [...query.matchAll(/pullRequest\(number: (\d+)\)/g)].map((match) => Number(match[1]));
    return { data: { repository: Object.fromEntries(numbers.map((number) => [`pr${number}`, pullRequestDetails[number]])) } };
  };
  return { graphql, queries };
}

describe("collecting every merged PR", () => {
  let collected: CollectedPullRequest[];
  let queries: string[];

  beforeAll(async () => {
    const github = fakeGitHub();
    collected = await collectPullRequests(github.graphql, { repo: "PostHog/posthog", since: "2026-07-31", until: "2026-08-01" }, () => {});
    queries = github.queries;
  });

  test("lists the merged PRs of every day, following search pages", () => {
    expect(collected.map(({ number, mergedAt }) => [number, mergedAt])).toEqual([
      [10, "2026-07-31T23:59:00Z"],
      [11, "2026-07-31T08:00:00Z"],
      [12, "2026-08-01T00:00:00Z"],
      [13, "2026-08-01T09:00:00Z"],
    ]);
  });

  test("fetches threads and commits only for PRs with review threads, sizing each connection to its count", () => {
    const detailQueries = queries.filter((query) => query.includes("pullRequest(number"));

    expect(detailQueries).toHaveLength(1);
    expect([...detailQueries[0]!.matchAll(/pullRequest\(number: (\d+)\)/g)].map((match) => Number(match[1]))).toEqual([10, 12]);
    expect(detailQueries[0]).toContain("reviewThreads(first: 2)");
    expect(detailQueries[0]).toContain("reviewThreads(first: 1)");
    expect(collected.find(({ number }) => number === 10)!.commits).toEqual([
      { oid: "c10a", committedDate: "2026-07-30T09:00:00Z" },
      { oid: "c10b", committedDate: "2026-07-30T12:00:00Z" },
    ]);
    expect(collected.find(({ number }) => number === 11)!.reviewThreads.nodes).toEqual([]);
  });

  test("keeps only human comments on code from someone other than the PR's author, split at 2026-08-01", () => {
    expect(codeComments(collected).map(({ id, author, path, split }) => ({ id, author, path, split }))).toEqual([
      { id: "gh:10:1", author: "reviewer", path: "products/surveys/backend/api.py", split: "development" },
      { id: "gh:12:6", author: "reviewer", path: "products/surveys/backend/views.py", split: "heldout" },
    ]);
  });

  test("refuses a day with more merged PRs than one search can return", async () => {
    const window = { repo: "PostHog/posthog", since: "2026-08-02", until: "2026-08-02" };

    expect(collectPullRequests(fakeGitHub().graphql, window, () => {})).rejects.toThrow("2026-08-02 has 1001 merged PRs");
  });
});

describe("the corpus", () => {
  const commented = (id: string, pr: number, mergedAt: string, split: CorpusComment["split"]): CorpusComment => ({
    id,
    url: `https://github.com/PostHog/posthog/pull/${pr}#discussion_r${id.split(":")[2]}`,
    author: "reviewer",
    path: "products/surveys/backend/api.py",
    line: 3,
    body: "not stored",
    at: "2026-07-30T10:00:00Z",
    pr,
    mergedAt,
    split,
  });
  const comments = [commented("gh:10:1", 10, "2026-07-31T23:59:00Z", "development"), commented("gh:10:2", 10, "2026-07-31T23:59:00Z", "development"), commented("gh:12:6", 12, "2026-08-01T00:00:00Z", "heldout")];
  const reuse: ConfirmationLabel = { id: "gh:10:1", architecture: true, subtype: "reuse", quote: "reuse the helper" };
  const confirmations = new Map<string, ConfirmationLabel>([
    ["gh:10:1", reuse],
    ["gh:10:2", { id: "gh:10:2", architecture: false, subtype: "none", quote: "" }],
    ["gh:12:6", { id: "gh:12:6", architecture: true, subtype: "layer", quote: "belongs in the service layer" }],
  ]);
  const fixes = new Map([
    ["gh:10:1", { id: "gh:10:1", fix: "c10b", before: "c10a", commentCommit: "c10a", isolable: true, commitsMissing: 0 }],
    ["gh:12:6", { id: "gh:12:6", fix: null, before: null, commentCommit: "c12a", isolable: true, commitsMissing: 0 }],
  ]);
  const verifications = new Map([["gh:10:1", { id: "gh:10:1", addressed: "yes" as const, note: "Imports the shared helper." }]]);

  test("has one row per confirmed correction, isolable only when it has a fix", () => {
    const rows = corpusRows(comments, confirmations, fixes, verifications);

    expect(rows.map(({ id, product, subtype, fix, fixUrl, isolable, verified, split }) => ({ id, product, subtype, fix, fixUrl, isolable, verified, split }))).toEqual([
      { id: "gh:10:1", product: "surveys", subtype: "reuse", fix: "c10b", fixUrl: "https://github.com/PostHog/posthog/pull/10/commits/c10b", isolable: true, verified: "yes", split: "development" },
      { id: "gh:12:6", product: "surveys", subtype: "layer", fix: null, fixUrl: null, isolable: false, verified: null, split: "heldout" },
    ]);
  });

  test("hashes exactly the held-out lines of corpus.jsonl, so development rows can change without touching it", () => {
    const rows = corpusRows(comments, confirmations, fixes, verifications);
    const heldOutLines = jsonLines(rows).split("\n").filter((line) => line.includes('"split":"heldout"')).map((line) => `${line}\n`).join("");
    const relabelled = corpusRows(comments, new Map([...confirmations, ["gh:10:1", { ...reuse, subtype: "duplication" }]]), fixes, verifications);

    expect(heldOutDigest(rows)).toBe(createHash("sha256").update(heldOutLines).digest("hex"));
    expect(heldOutDigest(relabelled)).toBe(heldOutDigest(rows));
  });
});

describe("locating fixes in fetched PR heads", () => {
  let repository: TemporaryRepository;
  let shas: { first: string; merge: string; other: string; fix: string };

  beforeAll(async () => {
    repository = await repositoryWithoutCommits();
    const first = await repository.commit({ "a.ts": "one" });
    await repository.git("checkout", "--quiet", "-b", "base-update");
    await repository.commit({ "a.ts": "from the base branch" });
    await repository.git("checkout", "--quiet", "main");
    await repository.git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "merge", "--quiet", "--no-ff", "--no-edit", "base-update");
    const merge = (await repository.git("rev-parse", "HEAD")).trim();
    shas = { first, merge, other: await repository.commit({ "b.ts": "two" }), fix: await repository.commit({ "a.ts": "three" }) };
    await repository.git("update-ref", "refs/uml-pr-review/corpus/10", shas.fix);
  });
  afterAll(() => repository.cleanup());

  test("takes the first non-merge commit after the comment that touches the commented file, and marks it isolable", async () => {
    const commits = [
      { oid: shas.first, committedDate: "2026-07-30T09:00:00Z" },
      { oid: shas.merge, committedDate: "2026-07-30T10:30:00Z" },
      { oid: shas.other, committedDate: "2026-07-30T11:00:00Z" },
      { oid: shas.fix, committedDate: "2026-07-30T12:00:00+01:00" },
      { oid: "f".repeat(40), committedDate: "2026-07-30T13:00:00Z" },
    ];
    const onFile: CorpusComment = { id: "gh:10:1", url: "", author: "reviewer", path: "a.ts", line: 1, body: "", at: "2026-07-30T10:00:00Z", pr: 10, mergedAt: "2026-07-31T00:00:00Z", split: "development" };
    const cache = join(await mkdtemp(join(tmpdir(), "corrections-fixes-")), "fixes.json");

    const [fix] = await locateFixes(repository.dir, [onFile], new Map([[10, { number: 10, commits } as CollectedPullRequest]]), cache, () => {});

    expect(fix).toEqual({ id: "gh:10:1", fix: shas.fix, before: shas.other, commentCommit: shas.first, isolable: true, commitsMissing: 1 });
    expect(JSON.parse(await readFile(cache, "utf8"))).toEqual([fix]);
  });
});

describe("resumable GitHub access", () => {
  const response = (remaining: number) => JSON.stringify({ data: { rateLimit: { cost: 2, remaining, resetAt: "2026-09-27T07:00:00Z" }, value: 42 } });
  const transport = (text: string) => {
    const calls = { sent: 0, pauses: [] as number[] };
    const fake: Transport = {
      send: async () => {
        calls.sent++;
        return text;
      },
      pause: async (milliseconds) => {
        calls.pauses.push(milliseconds);
      },
      now: () => Date.parse("2026-09-27T06:59:00Z"),
      log: () => {},
    };
    return { calls, fake };
  };

  test("answers a repeated query from the on-disk cache", async () => {
    const work = await mkdtemp(join(tmpdir(), "corrections-cache-"));
    const { calls, fake } = transport(response(4000));

    const first = await cachedGraphql(work, fake)("query { value }", { day: "2026-08-01" });
    const second = await cachedGraphql(work, fake)("query { value }", { day: "2026-08-01" });

    expect(second).toEqual(first);
    expect(calls).toEqual({ sent: 1, pauses: [] });
    await rm(work, { recursive: true, force: true });
  });

  test("waits for the rate-limit reset when the shared budget runs low", async () => {
    const work = await mkdtemp(join(tmpdir(), "corrections-cache-"));
    const { calls, fake } = transport(response(120));

    await cachedGraphql(work, fake)("query { value }", {});

    expect(calls.pauses).toEqual([65_000]);
    await rm(work, { recursive: true, force: true });
  });
});

describe("labels", () => {
  const labelsIn = async (files: Record<string, unknown[]>) => {
    const root = await mkdtemp(join(tmpdir(), "corrections-labels-"));
    await mkdir(join(root, "stage"));
    for (const [name, labels] of Object.entries(files)) await writeFile(join(root, "stage", name), JSON.stringify(labels));
    return root;
  };

  test("a first-pass comment labelled twice stays a candidate if either label says so", async () => {
    const root = await labelsIn({ "batch-001.json": [{ id: "gh:1:1", candidate: true }], "batch-gap1-001.json": [{ id: "gh:1:1", candidate: false }] });

    expect((await readLabels(root, "stage", firstPassLabelSchema, keepAnyCandidate)).get("gh:1:1")).toEqual({ id: "gh:1:1", candidate: true });
  });

  test("conflicting confirmations are refused rather than silently overwritten", async () => {
    const root = await labelsIn({
      "batch-001.json": [{ id: "gh:1:1", architecture: true, subtype: "reuse", quote: "reuse the helper" }],
      "batch-002.json": [{ id: "gh:1:1", architecture: false, subtype: "none", quote: "" }],
    });

    expect(readLabels(root, "stage", confirmationLabelSchema)).rejects.toThrow("conflicting labels for gh:1:1");
  });
});

describe("measured rates", () => {
  test("first-pass recall scales the misses in the negative sample to all negatives", () => {
    const estimate = recallEstimate({ confirmed: 950, negatives: 4515, sampled: 200, missed: 3 });

    expect(estimate.value).toBeCloseTo(950 / (950 + (3 / 200) * 4515), 10);
    expect(estimate.low).toBeLessThan(estimate.value);
    expect(estimate.high).toBeGreaterThan(estimate.value);
    expect(recallEstimate({ confirmed: 90, negatives: 1000, sampled: 200, missed: 0 }).value).toBe(1);
  });

  test("fix precision counts full fixes strictly and full or partial fixes leniently", () => {
    const measured = precision([...Array<"yes">(37).fill("yes"), ...Array<"partly">(6).fill("partly"), ...Array<"no">(7).fill("no")]);

    expect(measured.answers).toEqual({ yes: 37, partly: 6, no: 7, unverifiable: 0 });
    expect(measured.strict.value).toBeCloseTo(0.74, 10);
    expect(measured.lenient.value).toBeCloseTo(0.86, 10);
  });
});
