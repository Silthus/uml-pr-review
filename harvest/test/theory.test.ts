import { describe, expect, test } from "bun:test";
import type { Harvest, HarvestItem } from "../lib/items.ts";
import { assembleTheory, type TheoryDraft } from "../lib/theory.ts";

function item(id: string, overrides: Partial<HarvestItem>): HarvestItem {
  return { id, source: "review", origin: "pr#1", url: `https://github.com/PostHog/posthog/pull/1#${id}`, author: "reviewer", isBot: false, path: null, line: null, body: "", at: null, ...overrides };
}

const harvest: Harvest = {
  repo: "PostHog/posthog",
  scopes: ["products/workflows"],
  since: "2026-03-01",
  commit: "abc123",
  harvestedAt: "2026-09-26T12:00:00Z",
  relevanceFilter: "Jev classified 2 of 2 session turns",
  collected: {},
  drops: [],
  items: [
    item("gh:1:1", { origin: "pr#1", author: "alice", body: "Please go through the facade here,\nnot the model." }),
    item("gh:1:2", { origin: "pr#1", author: "bob", body: "Agree, facade only." }),
    item("gh:2:3", { origin: "pr#2", author: "coderabbitai", source: "bot-review", isBot: true, body: "Import the facade instead of the model." }),
    item("session:t3/a#m", { source: "session", origin: "session:t3/a", author: "Silthus", url: "local:t3/a#m", body: "Put it in the facade, token ghp_abcdefghijklmnopqrstuvwxyz123456" }),
  ],
};

function rule(overrides: Partial<TheoryDraft["rules"][number]> = {}): TheoryDraft["rules"][number] {
  return {
    id: "facade-only",
    statement: "Other products reach workflows through its facade.",
    kind: "boundary",
    component: "Facade",
    evidence: [
      { id: "gh:1:1", quote: "go through the facade here, not the model" },
      { id: "gh:1:2", quote: "facade only" },
      { id: "gh:2:3", quote: "Import the facade" },
    ],
    currentLevel: "documented",
    currentLevelBasis: "products/architecture.md says so; tach allows the whole module.",
    proposedLevel: "linted",
    howToEnforce: "Add a tach interface for products.workflows.",
    confidence: "high",
    value: 4,
    effort: 2,
    ...overrides,
  };
}

function draft(rules: TheoryDraft["rules"]): TheoryDraft {
  return { product: "Workflows", vocabulary: [], components: [], caveats: [], rules };
}

describe("assembleTheory", () => {
  test("resolves evidence to links and counts independent occurrences and human authors", () => {
    const [assembled] = assembleTheory(draft([rule()]), harvest).rules;

    expect(assembled?.evidence.map(({ url, author }) => ({ url, author }))).toEqual([
      { url: "https://github.com/PostHog/posthog/pull/1#gh:1:1", author: "alice" },
      { url: "https://github.com/PostHog/posthog/pull/1#gh:1:2", author: "bob" },
      { url: "https://github.com/PostHog/posthog/pull/1#gh:2:3", author: "coderabbitai" },
    ]);
    expect({ occurrences: assembled?.occurrences, authors: assembled?.authors, humanAuthors: assembled?.humanAuthors }).toEqual({ occurrences: 2, authors: 3, humanAuthors: 2 });
  });

  test("rejects a quote that is not verbatim in its evidence", () => {
    const invented = rule({ evidence: [{ id: "gh:1:1", quote: "always use the facade" }] });

    expect(() => assembleTheory(draft([invented]), harvest)).toThrow('facade-only: the quote "always use the facade" is not verbatim in gh:1:1');
  });

  test("rejects evidence that the harvest does not hold", () => {
    expect(() => assembleTheory(draft([rule({ evidence: [{ id: "gh:9:9", quote: "anything" }] })]), harvest)).toThrow("facade-only: evidence gh:9:9 is not in the harvest");
  });

  test("rejects a quote that carries a credential", () => {
    const leaky = rule({ evidence: [{ id: "session:t3/a#m", quote: "token ghp_abcdefghijklmnopqrstuvwxyz123456" }] });

    expect(() => assembleTheory(draft([leaky]), harvest)).toThrow("looks like it carries a credential");
  });

  test("rejects a proposal that moves a rule down the ladder", () => {
    expect(() => assembleTheory(draft([rule({ currentLevel: "linted", proposedLevel: "documented" })]), harvest)).toThrow("facade-only: proposed level documented is below its current level linted");
  });

  test("orders the backlog by value over effort and leaves out rules already at their target", () => {
    const rules = [
      rule({ id: "cheap-win", value: 3, effort: 1 }),
      rule({ id: "big-lift", value: 5, effort: 5 }),
      rule({ id: "already-there", currentLevel: "structural", proposedLevel: "structural" }),
      rule({ id: "solid", value: 4, effort: 2 }),
    ];

    expect(assembleTheory(draft(rules), harvest).backlog).toEqual(["cheap-win", "solid", "big-lift"]);
  });
});
