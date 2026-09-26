import { git } from "../../src/git.ts";

export type PullRequestDiff = { from: string; patch: string };

export async function pullRequestDiff(repository: string, base: string, head: string): Promise<PullRequestDiff> {
  const from = await lastSyncedUpstream(repository, base, head);
  return { from, patch: await git(repository, ["-c", "core.quotePath=false", "diff", "--binary", from, head]) };
}

const upstreamMerge = /^Merge (?:remote-tracking )?branch '(?:[^']*\/)?(?:master|main)'/;

async function lastSyncedUpstream(repository: string, base: string, head: string): Promise<string> {
  const merges = (await git(repository, ["log", "--first-parent", "--merges", "--format=%H %s", `${base}..${head}`])).split("\n").filter(Boolean);
  const latestSync = merges.map((line) => line.split(" ")).find(([, ...subject]) => upstreamMerge.test(subject.join(" ")))?.[0];
  const revision = latestSync ? `${latestSync}^2` : (await git(repository, ["merge-base", base, head])).trim();
  return (await git(repository, ["rev-parse", "--verify", revision])).trim();
}
