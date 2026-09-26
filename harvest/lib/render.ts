import { basename } from "node:path";
import type { Harvest } from "./items.ts";
import type { Evidence, Rule, Theory } from "./theory.ts";

const linksPerRule = 4;

const sections: { title: string; kinds: Rule["kind"][] }[] = [
  { title: "Guarantees", kinds: ["guarantee"] },
  { title: "Boundaries", kinds: ["boundary"] },
  { title: "Paved paths", kinds: ["paved-path"] },
  { title: "Vocabulary rules", kinds: ["vocabulary"] },
];

export function renderTheory(theory: Theory): string {
  const rulesById = new Map(theory.rules.map((rule) => [rule.id, rule]));
  return [
    `# ${theory.product}: theory draft`,
    "",
    `Harvested from ${theory.source.repo} (${theory.source.scopes.map((scope) => `\`${scope}\``).join(", ")}) since ${theory.source.since}: review comments, agent corrections, and written rules.`,
    "Each rule links where it came up. The quotes, what was checked in the code, and the full evidence live in `rules.json`.",
    "Levels say how a rule holds today: `review-only` (a reader), `documented` (a doc says so), `linted` (CI fails), `structural` (the wrong code cannot be written).",
    "This is a draft for the team to argue with. Nothing here is agreed yet.",
    "",
    "## Vocabulary",
    "",
    ...theory.vocabulary.flatMap(({ term, definition, avoid }) => [`**${term}**:`, definition, ...(avoid.length > 0 ? [`_Avoid_: ${avoid.join(", ")}`] : []), ""]),
    "## Components",
    "",
    "| Component | Role | Responsibility | Lives in |",
    "| --- | --- | --- | --- |",
    ...theory.components.map(({ name, role, responsibility, paths }) => `| ${name} | ${role} | ${responsibility} | ${paths.map((path) => `\`${path}\``).join("<br>")} |`),
    "",
    ...sections.flatMap(({ title, kinds }) => ruleSection(title, theory.rules.filter(({ kind }) => kinds.includes(kind)))),
    "## Caveats",
    "",
    ...theory.rules.filter(({ kind }) => kind === "caveat").map(ruleLine),
    ...theory.caveats.map(({ statement, evidence }) => `- ${statement}${evidence.length > 0 ? ` (${evidence.map(link).join(", ")})` : ""}`),
    "",
    "## Ladder backlog",
    "",
    "Sorted by value ÷ effort (each 1 to 5), then by how often the rule came up.",
    "",
    "| # | Rule | Now → next | Value ÷ effort | How to enforce |",
    "| --- | --- | --- | --- | --- |",
    ...theory.backlog.flatMap((id, index) => {
      const rule = rulesById.get(id);
      return rule ? [`| ${index + 1} | \`${rule.id}\` | ${rule.currentLevel} → ${rule.proposedLevel} | ${rule.value} ÷ ${rule.effort} | ${rule.howToEnforce} |`] : [];
    }),
    "",
  ].join("\n");
}

export function renderSources(harvest: Harvest, theory: Theory): string {
  const kept = countBy(harvest.items.map(({ source }) => source));
  const cited = countBy([...theory.rules, ...theory.caveats].flatMap(({ evidence }) => evidence.map(({ source }) => source)));
  return [
    `# Sources for the ${theory.product} theory draft`,
    "",
    `Harvested ${harvest.harvestedAt.slice(0, 10)} from ${harvest.repo}, scopes ${harvest.scopes.map((scope) => `\`${scope}\``).join(", ")}, since ${harvest.since}.`,
    `Relevance filter: ${harvest.relevanceFilter}.`,
    "",
    "## Collected",
    "",
    "| What | Count |",
    "| --- | --- |",
    ...Object.entries(harvest.collected).map(([what, count]) => `| ${what} | ${count} |`),
    "",
    "## Kept for clustering, and cited by rules",
    "",
    "| Source | Kept | Cited |",
    "| --- | --- | --- |",
    ...Object.entries(kept).map(([source, count]) => `| ${source} | ${count} | ${cited[source] ?? 0} |`),
    "",
    "## Dropped",
    "",
    "| Source | Reason | Count |",
    "| --- | --- | --- |",
    ...harvest.drops.map(({ source, reason, count }) => `| ${source} | ${reason} | ${count} |`),
    "",
    ...(theory.sourceNotes.length > 0 ? ["## Notes", "", ...theory.sourceNotes.map((note) => `- ${note}`), ""] : []),
  ].join("\n");
}

function ruleSection(title: string, rules: readonly Rule[]): string[] {
  return rules.length === 0 ? [] : [`## ${title}`, "", ...rules.map(ruleLine), ""];
}

function ruleLine(rule: Rule): string {
  const sources = distinctOrigins(rule.evidence).slice(0, linksPerRule).map(link);
  const more = rule.occurrences - sources.length;
  const evidence = `${sources.join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
  return `- **\`${rule.id}\`**: ${rule.statement} _${rule.component}; ${rule.currentLevel} → ${rule.proposedLevel}; ${rule.confidence} confidence; ${rule.occurrences} ${plural(rule.occurrences, "occurrence")}, ${rule.reviewers} independent ${plural(rule.reviewers, "reviewer")}: ${evidence}._`;
}

function distinctOrigins(evidence: readonly Evidence[]): Evidence[] {
  const seen = new Set<string>();
  return evidence.filter(({ origin }) => !seen.has(origin) && seen.add(origin));
}

function link(evidence: Evidence): string {
  return evidence.url.startsWith("https://") ? `[${label(evidence)}](${evidence.url})` : label(evidence);
}

function label({ source, origin, author, url }: Evidence): string {
  if (source === "session") return `${author}, agent session ${origin.split("/").pop()?.slice(0, 8)}`;
  const line = url.match(/#L(\d+)$/)?.[1];
  if (source === "doc") return line ? `${basename(origin)} L${line}` : basename(origin);
  return `${origin} ${author}${source === "bot-review" ? " (bot)" : ""}`;
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

function countBy(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
}
