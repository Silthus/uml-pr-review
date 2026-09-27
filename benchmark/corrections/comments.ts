import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { wholeRepository } from "../../harvest/lib/items.ts";
import { classificationPacket, humanReviewComments, ReviewCommentSchema } from "../../coherence/validation/review-comments.ts";
import type { CollectedPullRequest } from "./collect.ts";

export const heldOutFrom = "2026-08-01T00:00:00Z";
export const splits = ["development", "heldout"] as const;
export type Split = (typeof splits)[number];

export const corpusCommentSchema = ReviewCommentSchema.extend({ path: z.string(), mergedAt: z.string(), split: z.enum(splits) });
export type CorpusComment = z.infer<typeof corpusCommentSchema>;

export type CommentTally = { pullRequests: number; reviewedPullRequests: number; inlineComments: number; codeComments: number };

export function splitOf(mergedAt: string): Split {
  return Date.parse(mergedAt) < Date.parse(heldOutFrom) ? "development" : "heldout";
}

export function codeComments(pullRequests: CollectedPullRequest[]): CorpusComment[] {
  return pullRequests.flatMap((pullRequest) =>
    humanReviewComments([pullRequest], wholeRepository, "").flatMap(({ path, ...comment }) => (path === null ? [] : [{ ...comment, path, mergedAt: pullRequest.mergedAt, split: splitOf(pullRequest.mergedAt) }])),
  );
}

export function collectedCommentIds(pullRequests: CollectedPullRequest[]): Set<string> {
  return new Set(pullRequests.flatMap(({ number, reviewThreads }) => reviewThreads.nodes.flatMap(({ comments }) => comments.nodes.map(({ url }) => `gh:${number}:${url.match(/discussion_r(\d+)$/)?.[1] ?? url}`))));
}

export function tally(pullRequests: CollectedPullRequest[], comments: CorpusComment[]): CommentTally {
  return {
    pullRequests: pullRequests.length,
    reviewedPullRequests: pullRequests.filter(({ reviewThreads }) => reviewThreads.nodes.length > 0).length,
    inlineComments: pullRequests.reduce((sum, { reviewThreads }) => sum + reviewThreads.nodes.reduce((threads, { comments }) => threads + comments.nodes.length, 0), 0),
    codeComments: comments.length,
  };
}

export async function writePackets(directory: string, prefix: string, comments: CorpusComment[], size: number): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const names: string[] = [];
  for (let start = 0; start < comments.length; start += size) {
    const name = `${prefix}-${String(start / size + 1).padStart(3, "0")}`;
    await writeFile(join(directory, `${name}.md`), classificationPacket(comments.slice(start, start + size)));
    names.push(name);
  }
  return names;
}
