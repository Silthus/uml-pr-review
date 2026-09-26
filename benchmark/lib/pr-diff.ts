import { git } from "../../src/git.ts";

export type PullRequestDiff = { from: string; patch: string };

export async function pullRequestDiff(repository: string, base: string, head: string): Promise<PullRequestDiff> {
  const from = await lastSyncedUpstream(repository, base, head);
  return { from, patch: await git(repository, ["diff", "--binary", from, head]) };
}

async function lastSyncedUpstream(repository: string, base: string, head: string): Promise<string> {
  const [latestMerge] = (await git(repository, ["rev-list", "--first-parent", "--merges", "--max-count=1", `${base}..${head}`])).split("\n").filter(Boolean);
  const revision = latestMerge ? `${latestMerge}^2` : (await git(repository, ["merge-base", base, head])).trim();
  return (await git(repository, ["rev-parse", "--verify", revision])).trim();
}
