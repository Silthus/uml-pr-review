import { git, run } from "./git.ts";

export type PullRequestScope = "mine" | "all";

export type PullRequestSummary = {
  number: number;
  title: string;
  author: string;
  headRefName: string;
  isDraft: boolean;
  updatedAt: string;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
};

export type PullRequestMetadata = {
  url: string;
  repo: string;
  number: number;
  title: string;
  headSha: string;
  baseSha: string;
  baseRef: string;
};

const gh = (repoDir: string, args: string[]) => run(repoDir, ["gh", ...args]);

export async function githubRepository(repoDir: string): Promise<string> {
  return (await gh(repoDir, ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).trim();
}

export async function listOpenPullRequests(repoDir: string, scope: PullRequestScope): Promise<PullRequestSummary[]> {
  const fields = "number,title,author,headRefName,isDraft,updatedAt,url,additions,deletions,changedFiles";
  const scopeArgs = scope === "mine" ? ["--author", "@me"] : [];
  const output = await gh(repoDir, ["pr", "list", "--state", "open", "--limit", "100", "--json", fields, ...scopeArgs]);
  const pulls = JSON.parse(output) as (Omit<PullRequestSummary, "author"> & { author: { login: string } })[];
  return pulls
    .map((pull) => ({ ...pull, author: pull.author.login }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function pullRequestMetadata(repoDir: string, repo: string, number: number): Promise<PullRequestMetadata> {
  const output = await gh(repoDir, [
    "api",
    `repos/${repo}/pulls/${number}`,
    "--jq",
    "{url: .html_url, title: .title, headSha: .head.sha, baseSha: .base.sha, baseRef: .base.ref}",
  ]);
  const pull = JSON.parse(output) as Omit<PullRequestMetadata, "repo" | "number">;
  return { ...pull, repo, number };
}

export async function fetchPullRequestCommits(repoDir: string, pull: PullRequestMetadata): Promise<void> {
  const present = await Promise.all([pull.headSha, pull.baseSha].map((sha) => hasCommit(repoDir, sha)));
  if (present.every(Boolean)) return;
  const ref = (side: string) => `refs/uml-pr-review/pr/${pull.number}/${side}`;
  await git(repoDir, [
    "-c",
    "credential.helper=",
    "-c",
    "credential.helper=!gh auth git-credential",
    "fetch",
    "--no-tags",
    "--no-write-fetch-head",
    "--quiet",
    `https://github.com/${pull.repo}.git`,
    `+refs/pull/${pull.number}/head:${ref("head")}`,
    `+${pull.baseSha}:${ref("base")}`,
  ]);
}

function hasCommit(repoDir: string, sha: string): Promise<boolean> {
  return git(repoDir, ["cat-file", "-e", `${sha}^{commit}`]).then(
    () => true,
    () => false,
  );
}

export function parsePullRequestUrl(url: string): { repo: string; number: number } | null {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return match ? { repo: match[1]!, number: Number(match[2]) } : null;
}
