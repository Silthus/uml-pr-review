import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { fetchPullRequests, locateFix, type PullCommit, touches } from "../../coherence/validation/corrections.ts";
import { git } from "../../src/git.ts";
import type { CollectedPullRequest } from "./collect.ts";
import type { CorpusComment } from "./comments.ts";

export const fixSchema = z.object({
  id: z.string(),
  fix: z.string().nullable(),
  before: z.string().nullable(),
  commentCommit: z.string().nullable(),
  isolable: z.boolean(),
  commitsMissing: z.number().int(),
});
export type Fix = z.infer<typeof fixSchema>;

export const refNamespace = "corpus";
const fetchChunk = 100;

type Parents = Map<string, string[]>;

export async function locateFixes(repository: string, comments: CorpusComment[], pullRequests: Map<number, CollectedPullRequest>, cacheFile: string, log: (line: string) => void = console.error): Promise<Fix[]> {
  const located = new Map(z.array(fixSchema).parse(JSON.parse((await readFile(cacheFile, "utf8").catch(() => null)) ?? "[]")).map((fix) => [fix.id, fix]));
  const pending = comments.filter(({ id }) => !located.has(id));
  await fetchHeads(repository, [...new Set(pending.map(({ pr }) => pr))], log);
  for (const comment of pending) {
    const pullRequest = pullRequests.get(comment.pr);
    if (!pullRequest) throw new Error(`PR #${comment.pr} is not in the collected pull requests`);
    located.set(comment.id, await fixOf(repository, comment, pullRequest));
    if (located.size % 50 === 0) await writeFile(cacheFile, JSON.stringify([...located.values()]));
  }
  await writeFile(cacheFile, JSON.stringify([...located.values()]));
  log(`fixes: ${pending.length} located now, ${located.size} in total`);
  return comments.map(({ id }) => located.get(id)!);
}

async function fetchHeads(repository: string, prs: number[], log: (line: string) => void): Promise<void> {
  const fetched = new Set((await git(repository, ["for-each-ref", "--format=%(refname:lstrip=3)", `refs/uml-pr-review/${refNamespace}/`])).split("\n").filter(Boolean).map(Number));
  const missing = prs.filter((pr) => !fetched.has(pr));
  for (let start = 0; start < missing.length; start += fetchChunk) {
    const chunk = missing.slice(start, start + fetchChunk);
    await fetchPullRequests(repository, chunk, refNamespace).catch(() => fetchEach(repository, chunk, log));
    log(`fetched ${Math.min(start + fetchChunk, missing.length)}/${missing.length} PR heads into refs/uml-pr-review/${refNamespace}/`);
  }
}

async function fetchEach(repository: string, prs: number[], log: (line: string) => void): Promise<void> {
  for (const pr of prs) await fetchPullRequests(repository, [pr], refNamespace).catch((error: unknown) => log(`could not fetch PR #${pr}: ${String(error).slice(0, 200)}`));
}

async function fixOf(repository: string, comment: CorpusComment, pullRequest: CollectedPullRequest): Promise<Fix> {
  const parents = await parentsOf(repository, pullRequest.commits.map(({ oid }) => oid));
  const commits: PullCommit[] = pullRequest.commits.flatMap(({ oid, committedDate }) => {
    const known = parents.get(oid);
    return known?.[0] === undefined ? [] : [{ sha: oid, parent: known[0], merge: known.length > 1, date: committedDate }];
  });
  const { fix, commentCommit, isolable } = await locateFix(commits, comment.at, (commit) => touches(repository, commit, comment.path));
  return { id: comment.id, fix: fix?.sha ?? null, before: fix?.parent ?? null, commentCommit: commentCommit ?? null, isolable, commitsMissing: pullRequest.commits.length - commits.length };
}

async function parentsOf(repository: string, shas: string[]): Promise<Parents> {
  if (shas.length === 0) return new Map();
  const present = (await git(repository, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], `${shas.join("\n")}\n`))
    .split("\n")
    .filter((line) => line.endsWith(" commit"))
    .map((line) => line.split(" ")[0]!);
  if (present.length === 0) return new Map();
  const lines = await git(repository, ["show", "--no-patch", "--format=%H %P", ...present]);
  return new Map(
    lines
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, ...parents] = line.split(" ");
        return [sha!, parents];
      }),
  );
}
