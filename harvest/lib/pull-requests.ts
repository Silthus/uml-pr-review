import { z } from "zod";
import { gh, ghLines, graphql } from "./gh.ts";
import { inScope } from "./items.ts";
import { type PullRequestFeedback, pullRequestFeedbackSchema } from "./review-feedback.ts";

const batchSize = 8;
const searchPageSize = 50;
const searchResultCap = 1000;

const commitSchema = z.object({ sha: z.string(), message: z.string() });

export async function mergedPullRequestNumbers(repo: string, scope: string, since: string): Promise<number[]> {
  const commits = await ghLines(["api", "--paginate", `repos/${repo}/commits?path=${encodeURIComponent(scope)}&since=${since}T00:00:00Z&per_page=100`, "--jq", ".[] | {sha, message: .commit.message}"], commitSchema);
  const numbers = new Set<number>();
  for (const commit of commits) {
    const number = squashedPullRequestNumber(commit.message) ?? (await associatedPullRequestNumber(repo, commit.sha));
    if (number !== undefined) numbers.add(number);
  }
  return [...numbers];
}

export function squashedPullRequestNumber(message: string): number | undefined {
  const match = message.split("\n")[0]?.match(/\(#(\d+)\)\s*$/);
  return match?.[1] ? Number(match[1]) : undefined;
}

async function associatedPullRequestNumber(repo: string, sha: string): Promise<number | undefined> {
  const pulls = await gh(["api", `repos/${repo}/commits/${sha}/pulls`], z.array(z.object({ number: z.number().int(), merged_at: z.string().nullable() })));
  return pulls.find(({ merged_at }) => merged_at !== null)?.number;
}

const searchPageSchema = z.object({
  data: z.object({
    search: z.object({
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      nodes: z.array(z.object({ number: z.number().int(), files: z.object({ nodes: z.array(z.object({ path: z.string() })) }) }).partial()),
    }),
  }),
});

const closedSearchQuery = `query($q: String!, $first: Int!, $after: String) {
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number files(first: 100) { nodes { path } } } }
  }
}`;

export async function closedUnmergedPullRequestNumbers(repo: string, scopes: readonly string[], since: string, terms: readonly string[]): Promise<number[]> {
  const numbers = new Set<number>();
  for (const term of terms) {
    const query = `repo:${repo} is:pr is:closed is:unmerged closed:>=${since} ${term} in:title,body`;
    let after: string | null = null;
    for (let fetched = 0; fetched < searchResultCap; fetched += searchPageSize) {
      const page: z.infer<typeof searchPageSchema> = await graphql(closedSearchQuery, { q: query, first: searchPageSize, ...(after ? { after } : {}) }, searchPageSchema);
      for (const node of page.data.search.nodes) if (node.number && node.files?.nodes.some(({ path }) => inScope(path, scopes))) numbers.add(node.number);
      if (!page.data.search.pageInfo.hasNextPage) break;
      after = page.data.search.pageInfo.endCursor;
    }
  }
  return [...numbers];
}

const pullRequestFields = `number url
  files(first: 100) { totalCount nodes { path } }
  reviews(first: 50) { nodes { author { login __typename } body url submittedAt } }
  reviewThreads(first: 100) { nodes { comments(first: 30) { nodes { author { login __typename } body url path line originalLine createdAt } } } }`;

export async function pullRequestFeedback(repo: string, numbers: readonly number[], onBatch: (done: number) => void): Promise<PullRequestFeedback[]> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Expected owner/name, got ${repo}`);
  const feedback: PullRequestFeedback[] = [];
  for (let start = 0; start < numbers.length; start += batchSize) {
    const batch = numbers.slice(start, start + batchSize);
    const aliases = batch.map((number) => `pr${number}: pullRequest(number: ${number}) { ${pullRequestFields} }`).join("\n");
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${aliases} } }`;
    const response = await graphql(query, { owner, name }, z.object({ data: z.object({ repository: z.record(z.string(), pullRequestFeedbackSchema.nullable()) }) }));
    feedback.push(...Object.values(response.data.repository).filter((pullRequest) => pullRequest !== null));
    onBatch(Math.min(start + batchSize, numbers.length));
  }
  return feedback;
}
