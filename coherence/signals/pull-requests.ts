import { z } from "zod";
import { git } from "../../src/architecture/index/index.ts";
import { run } from "../../src/git.ts";

export type OpenPullRequest = { number: number; files: string[] };
export type OpenPullRequestList = { repository: string; pullRequests: OpenPullRequest[] };
export type OpenPullRequests = () => Promise<OpenPullRequestList>;

const GhPullRequestsSchema = z.array(z.object({ number: z.number().int(), changedFiles: z.number().int(), files: z.array(z.object({ path: z.string() })) }));
const githubRemote = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/;
const listLimit = "5000";
const preferredRemotes = ["upstream", "origin"];

export function githubOpenPullRequests(repository: string, slug?: string): OpenPullRequests {
  return async () => {
    const repo = slug ?? (await githubSlug(repository));
    const output = await run(repository, ["gh", "pr", "list", "--repo", repo, "--state", "open", "--limit", listLimit, "--json", "number,changedFiles,files"]);
    const listed = GhPullRequestsSchema.parse(JSON.parse(output));
    const pullRequests: OpenPullRequest[] = [];
    for (const { number, changedFiles, files } of listed) {
      const paths = files.map(({ path }) => path);
      pullRequests.push({ number, files: changedFiles > paths.length ? await everyChangedFile(repository, repo, number) : paths });
    }
    return { repository: repo, pullRequests };
  };
}

async function everyChangedFile(repository: string, repo: string, number: number): Promise<string[]> {
  const output = await run(repository, ["gh", "api", "--paginate", `repos/${repo}/pulls/${number}/files`, "--jq", ".[].filename"]);
  return output.split("\n").filter((path) => path !== "");
}

async function githubSlug(repository: string): Promise<string> {
  for (const remote of preferredRemotes) {
    const slug = githubRemote.exec((await git(repository, ["remote", "get-url", remote]).catch(() => "")).trim())?.[1];
    if (slug) return slug;
  }
  throw new Error(`no GitHub upstream or origin remote in ${repository}; pass --github <owner/name>`);
}
