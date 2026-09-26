import { describe, expect, test } from "bun:test";
import { DropLedger } from "../lib/items.ts";
import { type PullRequestFeedback, reviewFeedback } from "../lib/review-feedback.ts";

const window = { scopes: ["products/workflows"], since: "2026-03-01" };
const human = { login: "meikelmosby", __typename: "User" };
const coderabbit = { login: "coderabbitai", __typename: "Bot" };

function pullRequest(overrides: Partial<PullRequestFeedback> = {}): PullRequestFeedback {
  return {
    number: 101,
    url: "https://github.com/PostHog/posthog/pull/101",
    author: { login: "mayteio", __typename: "User" },
    files: { totalCount: 2, nodes: [{ path: "products/workflows/backend/api/hog_flow.py" }, { path: "products/workflows/frontend/Workflows/logic.ts" }] },
    reviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    ...overrides,
  };
}

function inline(path: string, body: string, author: { login: string; __typename: string } | null = human, id = 1, createdAt = "2026-04-01T10:00:00Z") {
  return { author, body, url: `https://github.com/PostHog/posthog/pull/101#discussion_r${id}`, path, line: 12, originalLine: 10, createdAt };
}

describe("reviewFeedback", () => {
  test("keeps an in-scope inline comment with its author, link, path, and line", () => {
    const drops = new DropLedger();
    const items = reviewFeedback(pullRequest({ reviewThreads: { nodes: [{ comments: { nodes: [inline("products/workflows/backend/api/hog_flow.py", "Go through the facade instead of importing the model.")] } }] } }), window, drops);

    expect(items).toEqual([
      {
        id: "gh:101:1",
        source: "review",
        origin: "pr#101",
        url: "https://github.com/PostHog/posthog/pull/101#discussion_r1",
        author: "meikelmosby",
        isBot: false,
        byPullRequestAuthor: false,
        path: "products/workflows/backend/api/hog_flow.py",
        line: 12,
        body: "Go through the facade instead of importing the model.",
        at: "2026-04-01T10:00:00Z",
      },
    ]);
  });

  test("puts bot reviewers and authorless reviews in their own flagged stream", () => {
    const comments = [inline("products/workflows/backend/api/hog_flow.py", "Consider validating the action graph before saving.", coderabbit, 1), inline("products/workflows/backend/api/hog_flow.py", "Tag the app to re-run this review on the workflow.", null, 2)];
    const items = reviewFeedback(pullRequest({ reviewThreads: { nodes: [{ comments: { nodes: comments } }] } }), window, new DropLedger());

    expect(items.map(({ source, isBot, author }) => ({ source, isBot, author }))).toEqual([
      { source: "bot-review", isBot: true, author: "coderabbitai" },
      { source: "bot-review", isBot: true, author: "ghost" },
    ]);
  });

  test("marks replies by the pull request's author so they are not counted as independent reviewers", () => {
    const reply = inline("products/workflows/backend/api/hog_flow.py", "Fixed: the executor now owns the retry decision.", { login: "mayteio", __typename: "User" });

    const [item] = reviewFeedback(pullRequest({ reviewThreads: { nodes: [{ comments: { nodes: [reply] } }] } }), window, new DropLedger());

    expect(item?.byPullRequestAuthor).toBe(true);
  });

  test("drops comments outside the scope, older than the window, or only acknowledging, and says why", () => {
    const drops = new DropLedger();
    const comments = [
      inline("posthog/api/team.py", "This belongs in the team API, not here at all.", human, 1),
      inline("products/workflows/backend/api/hog_flow.py", "LGTM!", human, 2),
      inline("products/workflows/backend/api/hog_flow.py", "Keep the serializer as the only write path.", human, 3, "2026-02-20T10:00:00Z"),
    ];
    const items = reviewFeedback(pullRequest({ reviewThreads: { nodes: [{ comments: { nodes: comments } }] } }), window, drops);

    expect(items).toEqual([]);
    expect(drops.entries()).toEqual([
      { source: "review", reason: "inline comment on a file outside the scope", count: 1 },
      { source: "review", reason: "comment written before --since", count: 1 },
      { source: "review", reason: "acknowledgement or too short to carry a rule", count: 1 },
    ]);
  });

  test("keeps review bodies only when enough of the pull request is in scope", () => {
    const review = { author: human, body: "Please keep the executor free of Django imports.", url: "https://github.com/PostHog/posthog/pull/101#pullrequestreview-7", submittedAt: "2026-04-02T09:00:00Z" };
    const mostlyElsewhere = { totalCount: 10, nodes: [{ path: "products/workflows/frontend/a.ts" }, ...Array.from({ length: 9 }, (_, index) => ({ path: `posthog/other_${index}.py` }))] };
    const drops = new DropLedger();

    expect(reviewFeedback(pullRequest({ reviews: { nodes: [review] } }), window, new DropLedger()).map(({ id }) => id)).toEqual(["gh:101:7"]);
    expect(reviewFeedback(pullRequest({ files: mostlyElsewhere, reviews: { nodes: [review] } }), window, drops)).toEqual([]);
    expect(drops.entries()).toEqual([{ source: "review", reason: "review body on a PR with under 30% of its files in scope", count: 1 }]);
  });
});
