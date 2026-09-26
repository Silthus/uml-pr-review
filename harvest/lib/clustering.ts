import type { Harvest } from "./items.ts";

const bodyBudget = { review: 2000, "bot-review": 1200, session: 4000, doc: 2000 } as const;

export type PromptPaths = { product: string; harvest: string; workdir: string; draft: string; assemble: string };

export function clusteringInputs(harvest: Harvest): Record<keyof typeof bodyBudget, string> {
  const linesOf = (source: keyof typeof bodyBudget) =>
    harvest.items
      .filter((item) => item.source === source)
      .map(({ id, author, byPullRequestAuthor, path, line, body }) => JSON.stringify({ id, author, byPullRequestAuthor, path, line, body: body.slice(0, bodyBudget[source]) }))
      .join("\n");
  return { review: linesOf("review"), "bot-review": linesOf("bot-review"), session: linesOf("session"), doc: linesOf("doc") };
}

export function clusteringPrompt(template: string, paths: PromptPaths, harvest: Harvest): string {
  const values: Record<string, string> = { ...paths, repo: harvest.repo, scopes: harvest.scopes.join(", "), since: harvest.since, commit: harvest.commit };
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`The clustering prompt names an unknown placeholder ${placeholder}`);
    return value;
  });
}
