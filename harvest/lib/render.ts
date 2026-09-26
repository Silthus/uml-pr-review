import type { Harvest } from "./items.ts";
import type { Evidence, Rule, Theory } from "./theory.ts";

const evidencePerRule = 3;

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
    "Every rule links the evidence it was clustered from. The level says how the rule holds today: `review-only` (a reader), `documented` (a doc says so), `linted` (CI fails), `structural` (the wrong code cannot be written).",
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
    ...theory.rules.filter(({ kind }) => kind === "caveat").flatMap(ruleBlock),
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
  const cited = countBy(theory.rules.flatMap(({ evidence }) => evidence.map(({ source }) => source)));
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
  return rules.length === 0 ? [] : [`## ${title}`, "", ...rules.flatMap(ruleBlock)];
}

function ruleBlock(rule: Rule): string[] {
  const shown = rule.evidence.slice(0, evidencePerRule);
  const more = rule.evidence.length - shown.length;
  return [
    `### \`${rule.id}\``,
    "",
    rule.statement,
    "",
    `- Component: ${rule.component}. Level: ${rule.currentLevel} → ${rule.proposedLevel}. Confidence: ${rule.confidence}.`,
    `- Today: ${rule.currentLevelBasis}`,
    `- Enforce: ${rule.howToEnforce}`,
    `- Evidence: ${rule.occurrences} ${plural(rule.occurrences, "occurrence")}, ${rule.humanAuthors} human ${plural(rule.humanAuthors, "author")}.`,
    ...shown.map((evidence) => `  - ${link(evidence)}: "${evidence.quote}"`),
    ...(more > 0 ? [`  - …and ${more} more in \`rules.json\`.`] : []),
    "",
  ];
}

function link(evidence: Evidence): string {
  const label = evidence.source === "session" ? `${evidence.author}, agent session` : evidence.source === "doc" ? evidence.origin.replace(/^doc:/, "") : `${evidence.origin} ${evidence.author}${evidence.source === "bot-review" ? " (bot)" : ""}`;
  return evidence.url.startsWith("https://") ? `[${label}](${evidence.url})` : label;
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

function countBy(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
}
