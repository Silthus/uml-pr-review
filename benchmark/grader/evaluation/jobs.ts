import { join } from "node:path";
import { z } from "zod";
import { git } from "../../../src/architecture/index/git.ts";
import { splitOf, type Split } from "../../corrections/comments.ts";
import type { CorpusRow } from "../../corrections/corpus.ts";
import { isolatedFixes, stableOrder, type IsolatedFix } from "../corpus.ts";

export type Range = { base: string; head: string };
export type CorrectionCase = { fix: IsolatedFix; reviewed: Range; fixed: Range };
export type CleanPullRequest = { pr: number; mergedAt: string; range: Range };

const SlimPullRequestSchema = z.object({ number: z.number(), mergedAt: z.string(), mergeCommit: z.string().nullable() });
type SlimPullRequest = z.infer<typeof SlimPullRequestSchema>;

const mainline = "upstream/master";

export async function correctionCases(repository: string, rows: CorpusRow[], split: Split): Promise<CorrectionCase[]> {
  const cases: CorrectionCase[] = [];
  for (const fix of isolatedFixes(rows, split)) {
    const forkPoint = await mergeBase(repository, fix.commentCommit);
    if (forkPoint) cases.push({ fix, reviewed: { base: forkPoint, head: fix.commentCommit }, fixed: { base: fix.before, head: fix.fix } });
  }
  return cases;
}

export function cleanPullRequests(pullRequests: SlimPullRequest[], rows: CorpusRow[], split: Split, size: number, seed: string): CleanPullRequest[] {
  const corrected = new Set(rows.map(({ pr }) => pr));
  const candidates = pullRequests.filter(({ number, mergedAt, mergeCommit }) => mergeCommit !== null && splitOf(mergedAt) === split && !corrected.has(number));
  return stableOrder(candidates.map((pullRequest) => ({ ...pullRequest, id: String(pullRequest.number) })), seed)
    .slice(0, size)
    .map(({ number, mergedAt, mergeCommit }) => ({ pr: number, mergedAt, range: { base: `${mergeCommit}^`, head: mergeCommit! } }));
}

export async function readSlimPullRequests(work: string): Promise<SlimPullRequest[]> {
  const slim = Bun.file(join(work, "pull-requests.slim.json"));
  if (await slim.exists()) return z.array(SlimPullRequestSchema).parse(await slim.json());
  const full = z.array(SlimPullRequestSchema.loose()).parse(await Bun.file(join(work, "pull-requests.json")).json());
  const pullRequests = full.map(({ number, mergedAt, mergeCommit }) => ({ number, mergedAt, mergeCommit }));
  await Bun.write(slim, JSON.stringify(pullRequests));
  return pullRequests;
}

async function mergeBase(repository: string, commit: string): Promise<string | undefined> {
  return git(repository, ["merge-base", commit, mainline]).then(
    (output) => output.trim() || undefined,
    () => undefined,
  );
}
