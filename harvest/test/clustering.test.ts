import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { clusteringInputs, clusteringPrompt } from "../lib/clustering.ts";
import type { Harvest } from "../lib/items.ts";

const harvest: Harvest = {
  repo: "PostHog/posthog",
  scopes: ["products/workflows", "nodejs/src/cdp/services/hogflows"],
  since: "2026-03-01",
  commit: "57ca357",
  harvestedAt: "2026-09-26T12:00:00Z",
  relevanceFilter: "heuristics only",
  collected: {},
  drops: [],
  items: [
    { id: "gh:1:1", source: "review", origin: "pr#1", url: "https://github.com/PostHog/posthog/pull/1#discussion_r1", author: "alice", isBot: false, byPullRequestAuthor: false, path: "products/workflows/a.py", line: 3, body: "Go through the facade.", at: null },
    { id: "gh:1:2", source: "bot-review", origin: "pr#1", url: "https://github.com/PostHog/posthog/pull/1#discussion_r2", author: "greptile-apps", isBot: true, byPullRequestAuthor: false, path: null, line: null, body: "x".repeat(5000), at: null },
  ],
};

const paths = { product: "Workflows", harvest: "/tmp/h.json", workdir: "/tmp/work", draft: "/tmp/work/draft.json", assemble: "bun harvest/assemble.ts" };

describe("clusteringPrompt", () => {
  test("fills the checked-in prompt with the harvest's repository, scopes, window, and commit", async () => {
    const template = await Bun.file(join(import.meta.dir, "..", "clustering-prompt.md")).text();

    const prompt = clusteringPrompt(template, paths, harvest);

    expect(prompt).toContain("for Workflows in PostHog/posthog (scopes: products/workflows, nodejs/src/cdp/services/hogflows)");
    expect(prompt).toContain("Code is pinned at 57ca357.");
    expect(prompt).toContain("Validate with `bun harvest/assemble.ts`.");
    expect(prompt).not.toContain("{{");
  });

  test("refuses a template that names a placeholder it cannot fill", () => {
    expect(() => clusteringPrompt("Scope {{team}}", paths, harvest)).toThrow("unknown placeholder {{team}}");
  });
});

describe("clusteringInputs", () => {
  test("splits items by source and trims long bodies to the source's budget", () => {
    const inputs = clusteringInputs(harvest);

    expect(JSON.parse(inputs.review)).toEqual({ id: "gh:1:1", author: "alice", byPullRequestAuthor: false, path: "products/workflows/a.py", line: 3, body: "Go through the facade." });
    expect(JSON.parse(inputs["bot-review"]).body).toHaveLength(1200);
    expect(inputs.session).toBe("");
  });
});
