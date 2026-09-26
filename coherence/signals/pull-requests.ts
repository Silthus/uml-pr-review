import { z } from "zod";
import { git } from "../../src/architecture/index/index.ts";
import { run } from "../../src/git.ts";

export type OpenPullRequest = { number: number; files: string[] };
export type OpenPullRequestList = { repository: string; pullRequests: OpenPullRequest[] };
export type OpenPullRequests = () => Promise<OpenPullRequestList>;

const GhPullRequestsSchema = z.array(z.object({ number: z.number().int(), files: z.array(z.object({ path: z.string() })) }));
const githubRemote = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/;
const listLimit = "5000";
const preferredRemotes = ["upstream", "origin"];

export function githubOpenPullRequests(repository: string, slug?: string): OpenPullRequests {
  return async () => {
    const repo = slug ?? (await githubSlug(repository));
    const output = await run(repository, ["gh", "pr", "list", "--repo", repo, "--state", "open", "--limit", listLimit, "--json", "number,files"]);
    return { repository: repo, pullRequests: GhPullRequestsSchema.parse(JSON.parse(output)).map(({ number, files }) => ({ number, files: files.map(({ path }) => path) })) };
  };
}

async function githubSlug(repository: string): Promise<string> {
  for (const remote of preferredRemotes) {
    const slug = githubRemote.exec((await git(repository, ["remote", "get-url", remote]).catch(() => "")).trim())?.[1];
    if (slug) return slug;
  }
  throw new Error(`no GitHub upstream or origin remote in ${repository}; pass --github <owner/name>`);
}
