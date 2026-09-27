import { z } from "zod";
import { pullRequestFeedbackSchema } from "../../harvest/lib/review-feedback.ts";
import type { Graphql } from "./github.ts";

const actorSchema = z.object({ login: z.string(), __typename: z.string() }).nullable();
const countSchema = z.object({ totalCount: z.number().int() });
const connectionCap = 100;
const commentsPerThread = 10;
const detailBatchPullRequests = 40;
const detailBatchThreads = 300;
const concurrency = 4;

const indexedPullRequestSchema = z.object({
  number: z.number().int(),
  url: z.string(),
  title: z.string(),
  mergedAt: z.string(),
  author: actorSchema,
  baseRefName: z.string(),
  baseRefOid: z.string(),
  headRefOid: z.string(),
  mergeCommit: z.object({ oid: z.string() }).nullable(),
  files: z.object({ totalCount: z.number().int(), nodes: z.array(z.object({ path: z.string() })) }),
  reviewThreads: countSchema,
  reviews: countSchema,
  commits: countSchema,
});
type IndexedPullRequest = z.infer<typeof indexedPullRequestSchema>;

const searchPageSchema = z.object({
  data: z.object({
    search: z.object({
      issueCount: z.number().int(),
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      nodes: z.array(indexedPullRequestSchema),
    }),
  }),
});

const commitSchema = z.object({ oid: z.string(), committedDate: z.string() });
const detailSchema = pullRequestFeedbackSchema.pick({ reviews: true, reviewThreads: true }).extend({
  number: z.number().int(),
  commits: z.object({ nodes: z.array(z.object({ commit: commitSchema })) }),
});
type Detail = z.infer<typeof detailSchema>;

export const collectedPullRequestSchema = pullRequestFeedbackSchema.extend({
  title: z.string(),
  mergedAt: z.string(),
  baseRefName: z.string(),
  baseRefOid: z.string(),
  headRefOid: z.string(),
  mergeCommit: z.string().nullable(),
  counts: z.object({ reviewThreads: z.number().int(), reviews: z.number().int(), commits: z.number().int() }),
  commits: z.array(commitSchema),
});
export type CollectedPullRequest = z.infer<typeof collectedPullRequestSchema>;

const searchQuery = `query($q: String!, $after: String) {
  rateLimit { cost remaining resetAt }
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number url title mergedAt author { login __typename }
      baseRefName baseRefOid headRefOid mergeCommit { oid }
      files(first: 100) { totalCount nodes { path } }
      reviewThreads { totalCount } reviews { totalCount } commits { totalCount }
    } }
  }
}`;

export type Window = { repo: string; since: string; until: string };

export async function collectPullRequests(graphql: Graphql, window: Window, log: (line: string) => void = console.error): Promise<CollectedPullRequest[]> {
  const indexed = await mergedPullRequests(graphql, window, log);
  const details = await pullRequestDetails(graphql, window.repo, indexed, log);
  return indexed.map((pullRequest) => collected(pullRequest, details.get(pullRequest.number)));
}

async function mergedPullRequests(graphql: Graphql, { repo, since, until }: Window, log: (line: string) => void): Promise<IndexedPullRequest[]> {
  const days = await inParallel(daysBetween(since, until), async (day) => {
    const found = await mergedOn(graphql, repo, day);
    log(`index ${day}: ${found.length} merged PRs`);
    return found;
  });
  const byNumber = new Map(days.flat().map((pullRequest) => [pullRequest.number, pullRequest]));
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

async function mergedOn(graphql: Graphql, repo: string, day: string): Promise<IndexedPullRequest[]> {
  const found: IndexedPullRequest[] = [];
  let after: string | null = null;
  do {
    const page: z.infer<typeof searchPageSchema> = searchPageSchema.parse(await graphql(searchQuery, { q: `repo:${repo} is:pr is:merged merged:${day}`, ...(after ? { after } : {}) }));
    if (page.data.search.issueCount > 1000) throw new Error(`${day} has ${page.data.search.issueCount} merged PRs, beyond one search window`);
    found.push(...page.data.search.nodes);
    after = page.data.search.pageInfo.hasNextPage ? page.data.search.pageInfo.endCursor : null;
  } while (after !== null);
  return found;
}

export function daysBetween(since: string, until: string): string[] {
  const days: string[] = [];
  for (let day = Date.parse(`${since}T00:00:00Z`); day <= Date.parse(`${until}T00:00:00Z`); day += 86_400_000) days.push(new Date(day).toISOString().slice(0, 10));
  return days;
}

async function pullRequestDetails(graphql: Graphql, repo: string, indexed: IndexedPullRequest[], log: (line: string) => void): Promise<Map<number, Detail>> {
  const [owner, name] = repo.split("/");
  const batches = detailBatches(indexed.filter(({ reviewThreads }) => reviewThreads.totalCount > 0));
  let done = 0;
  const responses = await inParallel(batches, async (batch) => {
    const aliases = batch.map((pullRequest) => `pr${pullRequest.number}: pullRequest(number: ${pullRequest.number}) { ${detailFields(pullRequest)} }`).join("\n");
    const query = `query($owner: String!, $name: String!) { rateLimit { cost remaining resetAt } repository(owner: $owner, name: $name) { ${aliases} } }`;
    const response = z.object({ data: z.object({ repository: z.record(z.string(), detailSchema) }) }).parse(await graphql(query, { owner: owner!, name: name! }));
    if (++done % 25 === 0 || done === batches.length) log(`details: ${done}/${batches.length} batches`);
    return Object.values(response.data.repository);
  });
  return new Map(responses.flat().map((detail) => [detail.number, detail]));
}

async function inParallel<T, R>(items: T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const position = next++;
      results[position] = await task(items[position]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function detailBatches(pullRequests: IndexedPullRequest[]): IndexedPullRequest[][] {
  const batches: IndexedPullRequest[][] = [];
  let current: IndexedPullRequest[] = [];
  let threads = 0;
  for (const pullRequest of pullRequests) {
    const size = capped(pullRequest.reviewThreads.totalCount);
    if (current.length > 0 && (current.length >= detailBatchPullRequests || threads + size > detailBatchThreads)) {
      batches.push(current);
      [current, threads] = [[], 0];
    }
    current.push(pullRequest);
    threads += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function capped(count: number): number {
  return Math.min(Math.max(count, 1), connectionCap);
}

function detailFields({ reviewThreads, reviews, commits }: IndexedPullRequest): string {
  return `number
    reviews(first: ${capped(reviews.totalCount)}) { nodes { author { login __typename } body url submittedAt } }
    reviewThreads(first: ${capped(reviewThreads.totalCount)}) { nodes { comments(first: ${commentsPerThread}) { nodes { author { login __typename } body url path line originalLine createdAt } } } }
    commits(first: ${capped(commits.totalCount)}) { nodes { commit { oid committedDate } } }`;
}

function collected(pullRequest: IndexedPullRequest, detail: Detail | undefined): CollectedPullRequest {
  return {
    number: pullRequest.number,
    url: pullRequest.url,
    title: pullRequest.title,
    mergedAt: pullRequest.mergedAt,
    author: pullRequest.author,
    baseRefName: pullRequest.baseRefName,
    baseRefOid: pullRequest.baseRefOid,
    headRefOid: pullRequest.headRefOid,
    mergeCommit: pullRequest.mergeCommit?.oid ?? null,
    files: pullRequest.files,
    counts: { reviewThreads: pullRequest.reviewThreads.totalCount, reviews: pullRequest.reviews.totalCount, commits: pullRequest.commits.totalCount },
    reviews: detail?.reviews ?? { nodes: [] },
    reviewThreads: detail?.reviewThreads ?? { nodes: [] },
    commits: detail?.commits.nodes.map(({ commit }) => commit) ?? [],
  };
}
