import { z } from "zod";
import { type DropLedger, type HarvestItem, inScope } from "./items.ts";

const actorSchema = z.object({ login: z.string(), __typename: z.string() }).nullable();

const reviewCommentSchema = z.object({
  author: actorSchema,
  body: z.string(),
  url: z.string(),
  path: z.string(),
  line: z.number().int().nullable(),
  originalLine: z.number().int().nullable(),
  createdAt: z.string(),
});

export const pullRequestFeedbackSchema = z.object({
  number: z.number().int(),
  url: z.string(),
  files: z.object({ totalCount: z.number().int(), nodes: z.array(z.object({ path: z.string() })) }),
  reviews: z.object({ nodes: z.array(z.object({ author: actorSchema, body: z.string(), url: z.string(), submittedAt: z.string().nullable() })) }),
  reviewThreads: z.object({ nodes: z.array(z.object({ comments: z.object({ nodes: z.array(reviewCommentSchema) }) })) }),
});
export type PullRequestFeedback = z.infer<typeof pullRequestFeedbackSchema>;

type Actor = z.infer<typeof actorSchema>;

const knownReviewBots = /^(coderabbitai|greptile|graphite-app|copilot|chatgpt-codex-connector|cursor|sourcery-ai|ellipsis-dev|korbit-ai|qodo|github-actions|hex-security-app|posthog-bot|mendral)/i;
const minimumReviewBodyScopeShare = 0.3;
const minimumMeaningfulLength = 20;
const acknowledgement = /^\s*(lgtm|looks good|nice|thanks|thank you|approved?|ship it|done|fixed|\+1|:shipit:|🚀|👍)[\s.!:)]*$/i;

export function isBotActor(actor: Actor): boolean {
  if (!actor) return false;
  return actor.__typename === "Bot" || /\[bot\]$/i.test(actor.login) || knownReviewBots.test(actor.login);
}

export function reviewFeedback(pullRequest: PullRequestFeedback, scopes: readonly string[], drops: DropLedger): HarvestItem[] {
  const origin = `pr#${pullRequest.number}`;
  const inline = pullRequest.reviewThreads.nodes.flatMap(({ comments }) => comments.nodes);
  const scopedInline = inline.filter(({ path }) => inScope(path, scopes));
  drops.record("review", "inline comment on a file outside the scope", inline.length - scopedInline.length);
  const inlineItems = scopedInline.map((comment) => itemOf(origin, comment.author, comment.body, comment.url, comment.path, comment.line ?? comment.originalLine, comment.createdAt));
  const bodies = pullRequest.reviews.nodes.filter(({ body }) => body.trim().length > 0);
  const share = scopeShare(pullRequest, scopes);
  if (share < minimumReviewBodyScopeShare) {
    drops.record("review", `review body on a PR with under ${minimumReviewBodyScopeShare * 100}% of its files in scope`, bodies.length);
    return meaningful(inlineItems, drops);
  }
  const bodyItems = bodies.map((review) => itemOf(origin, review.author, review.body, review.url, null, null, review.submittedAt));
  return meaningful([...inlineItems, ...bodyItems], drops);
}

export function scopeShare(pullRequest: PullRequestFeedback, scopes: readonly string[]): number {
  const paths = pullRequest.files.nodes.map(({ path }) => path);
  if (paths.length === 0) return 0;
  return paths.filter((path) => inScope(path, scopes)).length / Math.max(paths.length, pullRequest.files.totalCount);
}

function meaningful(items: HarvestItem[], drops: DropLedger): HarvestItem[] {
  const kept = items.filter(({ body }) => isMeaningful(body));
  drops.record("review", "acknowledgement or too short to carry a rule", items.length - kept.length);
  return kept;
}

function isMeaningful(body: string): boolean {
  const text = body.trim();
  return text.length >= minimumMeaningfulLength && !acknowledgement.test(text);
}

function itemOf(origin: string, author: Actor, body: string, url: string, path: string | null, line: number | null, at: string | null): HarvestItem {
  const isBot = isBotActor(author);
  return { id: idOf(url), source: isBot ? "bot-review" : "review", origin, url, author: author?.login ?? "ghost", isBot, path, line, body: body.trim(), at };
}

function idOf(url: string): string {
  const anchor = url.match(/#(?:discussion_r|pullrequestreview-)(\d+)$/);
  const pr = url.match(/\/pull\/(\d+)/);
  return `gh:${pr?.[1] ?? "?"}:${anchor?.[1] ?? url}`;
}
