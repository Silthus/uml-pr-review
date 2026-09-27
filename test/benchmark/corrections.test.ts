import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CollectedPullRequest, collectPullRequests } from "../../benchmark/corrections/collect.ts";
import { codeComments, type CorpusComment } from "../../benchmark/corrections/comments.ts";
import { corpusRows, heldOutDigest, jsonLines } from "../../benchmark/corrections/corpus.ts";
import { locateFixes } from "../../benchmark/corrections/fixes.ts";
import { budgetFile, cachedGraphql, type Graphql } from "../../benchmark/corrections/github.ts";
import { type ConfirmationLabel, recallEstimate } from "../../benchmark/corrections/labels.ts";
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

const searchPages: Record<string, { nodes: ReturnType<typeof indexed>[]; next?: string }[]> = {
  "2026-07-31": [{ nodes: [indexed(10, "2026-07-31T23:59:00Z", 2), indexed(11, "2026-07-31T08:00:00Z", 0)] }],
  "2026-08-01": [{ nodes: [indexed(12, "2026-08-01T00:00:00Z", 1)], next: "cursor-1" }, { nodes: [indexed(13, "2026-08-01T09:00:00Z", 0)] }],
};

const pullRequestDetails: Record<number, ReturnType<typeof details>> = {
  10: details(10, [
    [comment(10, 1, reviewer, "We already have a helper for this in posthog/utils, please reuse it."), comment(10, 2, author, "Good call, switching to the shared helper now.")],
    [comment(10, 3, greptile, "Consider extracting this block into a separate function."), comment(10, 4, reviewer, "QA swarm finding. This comment was not written by a human."), comment(10, 5, reviewer, "lgtm")],
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
      return { data: { search: { issueCount: 2, pageInfo: { hasNextPage: page.next !== undefined, endCursor: page.next ?? null }, nodes: page.nodes } } };
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
  const fixes = new Map([["gh:10:1", { id: "gh:10:1", fix: "c10b", before: "c10a", commentCommit: "c10a", isolable: true, commitsMissing: 0 }]]);
  const verifications = new Map([["gh:10:1", { id: "gh:10:1", addressed: "yes" as const, note: "Imports the shared helper." }]]);

  test("has one row per confirmed correction, with its product, fix, verification, and split", () => {
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
  let shas: string[];

  beforeAll(async () => {
    repository = await repositoryWithoutCommits();
    shas = [await repository.commit({ "a.ts": "one" }), await repository.commit({ "b.ts": "two" }), await repository.commit({ "a.ts": "three" })];
    await repository.git("update-ref", "refs/uml-pr-review/corpus/10", shas[2]!);
  });
  afterAll(() => repository.cleanup());

  test("takes the first commit after the comment that touches the commented file, and marks it isolable", async () => {
    const pullRequest = { number: 10, commits: [{ oid: shas[0]!, committedDate: "2026-07-30T09:00:00Z" }, { oid: shas[1]!, committedDate: "2026-07-30T11:00:00Z" }, { oid: shas[2]!, committedDate: "2026-07-30T12:00:00+01:00" }, { oid: "f".repeat(40), committedDate: "2026-07-30T13:00:00Z" }] } as CollectedPullRequest;
    const onFile: CorpusComment = { id: "gh:10:1", url: "", author: "reviewer", path: "a.ts", line: 1, body: "", at: "2026-07-30T10:00:00Z", pr: 10, mergedAt: "2026-07-31T00:00:00Z", split: "development" };
    const cache = join(await mkdtemp(join(tmpdir(), "corrections-fixes-")), "fixes.json");

    const [fix] = await locateFixes(repository.dir, [onFile], new Map([[10, pullRequest]]), cache, () => {});

    expect(fix).toEqual({ id: "gh:10:1", fix: shas[2]!, before: shas[1]!, commentCommit: shas[0]!, isolable: true, commitsMissing: 1 });
    expect(JSON.parse(await readFile(cache, "utf8"))).toEqual([fix]);
  });
});

describe("resumable GitHub access", () => {
  test("answers a repeated query from the on-disk cache and records the points it spent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "corrections-cache-"));
    let sent = 0;
    const send = async () => {
      sent++;
      return JSON.stringify({ data: { rateLimit: { cost: 2, remaining: 4000, resetAt: "2026-09-27T07:00:00Z" }, value: 42 } });
    };

    const first = await cachedGraphql(directory, send, () => {})("query { value }", { day: "2026-08-01" });
    const second = await cachedGraphql(directory, send, () => {})("query { value }", { day: "2026-08-01" });

    expect(second).toEqual(first);
    expect(sent).toBe(1);
    expect((await readFile(join(directory, budgetFile), "utf8")).trim().split("\n").map((line) => JSON.parse(line).cost)).toEqual([2]);
    await rm(directory, { recursive: true, force: true });
  });
});

describe("first-pass recall", () => {
  test("scales the misses found in the negative sample to all negatives", () => {
    const estimate = recallEstimate({ confirmed: 90, negatives: 1000, sampled: 200, missed: 2 });

    expect(estimate.value).toBeCloseTo(0.9, 10);
    expect(estimate.low).toBeLessThan(0.9);
    expect(estimate.high).toBeGreaterThan(0.9);
    expect(recallEstimate({ confirmed: 90, negatives: 1000, sampled: 200, missed: 0 }).value).toBe(1);
  });
});
