#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { pullRequestFeedback } from "../../harvest/lib/pull-requests.ts";
import { DropLedger } from "../../harvest/lib/items.ts";
import { pullRequestFeedbackSchema, reviewFeedback, type PullRequestFeedback } from "../../harvest/lib/review-feedback.ts";
import { git } from "../../src/git.ts";

export const ReviewCommentSchema = z.object({ id: z.string(), url: z.string(), author: z.string(), path: z.string().nullable(), line: z.number().nullable(), body: z.string(), at: z.string().nullable(), pr: z.number() });
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

const pullRequestNumber = /\(#(\d+)\)\s*$/;
const automatedMarkers = [/not written by a human/i, /^\s*(?:>|&gt;)?\s*🤖/mu, /^\s*AI reply:/i, /(?:posted|generated|written|drafted) (?:by|with) (?:\[?claude\b|an? AI\b)/i, /agent-drafted/i, /AI-suggested/i, /automated reply/i];
const classificationBatch = 100;
const bodyLimit = 700;

async function mergedPullRequests(repository: string, ref: string, since: string, scope: string): Promise<number[]> {
  const subjects = await git(repository, ["log", "--first-parent", `--since=${since}`, "--format=%s", ref, "--", scope]);
  return [...new Set(subjects.split("\n").flatMap((subject) => pullRequestNumber.exec(subject)?.slice(1, 2).map(Number) ?? []))];
}

async function cachedFeedback(file: string, numbers: number[]): Promise<PullRequestFeedback[]> {
  const cached = await readFile(file, "utf8").catch(() => null);
  if (cached !== null) return z.array(pullRequestFeedbackSchema).parse(JSON.parse(cached));
  const feedback = await pullRequestFeedback("PostHog/posthog", numbers, (done) => console.error(`review feedback: ${done}/${numbers.length}`));
  await writeFile(file, JSON.stringify(feedback));
  return feedback;
}

export function humanReviewComments(feedback: PullRequestFeedback[], scope: string, since: string): ReviewComment[] {
  return feedback.flatMap((pullRequest) =>
    reviewFeedback(pullRequest, { scopes: [scope], since }, new DropLedger())
      .filter(({ isBot, byPullRequestAuthor, body }) => !isBot && !byPullRequestAuthor && !isSelfDeclaredAutomated(body))
      .map(({ id, url, author, path, line, body, at }) => ({ id, url, author, path, line, body, at, pr: pullRequest.number })),
  );
}

function isSelfDeclaredAutomated(body: string): boolean {
  return automatedMarkers.some((marker) => marker.test(body));
}

export function classificationPacket(comments: ReviewComment[]): string {
  return comments
    .map(({ id, pr, path, body }) => [`<comment id="${id}">`, `PR #${pr}${path ? `, file ${path}` : ", review body"}`, body.length > bodyLimit ? `${body.slice(0, bodyLimit)} [...]` : body, "</comment>"].join("\n"))
    .join("\n\n");
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      ref: { type: "string", default: "57ca357730843205c2d659098ac8e4c5e07a6698" },
      since: { type: "string", default: "2026-03-01" },
      scope: { type: "string", default: "products/workflows" },
      work: { type: "string", default: "/tmp/coherence-validation-corrections" },
    },
  });
  if (!values.repo) {
    console.error("Usage: bun coherence/validation/review-comments.ts --repo <path> [--ref <sha>] [--since 2026-03-01] [--scope products/workflows] [--work /tmp/coherence-validation-corrections]");
    process.exit(2);
  }
  const work = resolve(values.work!);
  await mkdir(work, { recursive: true });
  const numbers = await mergedPullRequests(resolve(values.repo), values.ref!, values.since!, values.scope!);
  const comments = humanReviewComments(await cachedFeedback(join(work, "feedback.json"), numbers), values.scope!, values.since!);
  await writeFile(join(work, "comments.json"), JSON.stringify(comments, null, 1));
  for (let start = 0; start < comments.length; start += classificationBatch) {
    await writeFile(join(work, `classify-${String(start / classificationBatch + 1).padStart(2, "0")}.md`), classificationPacket(comments.slice(start, start + classificationBatch)));
  }
  console.log(`${numbers.length} merged PRs, ${comments.length} human review comments from reviewers other than the author, in ${Math.ceil(comments.length / classificationBatch)} classification batches under ${work}`);
}
