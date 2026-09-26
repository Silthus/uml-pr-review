import { z } from "zod";
import type { Harvest, HarvestItem } from "./items.ts";

export const ruleKinds = ["guarantee", "paved-path", "boundary", "vocabulary", "caveat"] as const;
export const ladder = ["review-only", "documented", "linted", "structural"] as const;
export type Level = (typeof ladder)[number];

const levelSchema = z.enum(ladder);
const scaleSchema = z.number().int().min(1).max(5);

const evidenceRefSchema = z.object({ id: z.string(), quote: z.string().min(3).max(240) });

const ruleDraftSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  statement: z.string().min(10),
  kind: z.enum(ruleKinds),
  component: z.string(),
  evidence: z.array(evidenceRefSchema).min(1),
  currentLevel: levelSchema,
  currentLevelBasis: z.string().min(10),
  proposedLevel: levelSchema,
  howToEnforce: z.string().min(10),
  confidence: z.enum(["low", "medium", "high"]),
  value: scaleSchema,
  effort: scaleSchema,
});

export const theoryDraftSchema = z.object({
  product: z.string(),
  vocabulary: z.array(z.object({ term: z.string(), definition: z.string(), avoid: z.array(z.string()).default([]) })),
  components: z.array(z.object({ name: z.string(), role: z.string(), responsibility: z.string(), paths: z.array(z.string()).min(1) })),
  caveats: z.array(z.object({ statement: z.string(), evidence: z.array(evidenceRefSchema).default([]) })),
  rules: z.array(ruleDraftSchema).min(1),
  sourceNotes: z.array(z.string()).default([]),
});
export type TheoryDraft = z.input<typeof theoryDraftSchema>;

export type Evidence = { url: string; origin: string; author: string; source: HarvestItem["source"]; quote: string };
export type Rule = Omit<z.infer<typeof ruleDraftSchema>, "evidence"> & { evidence: Evidence[]; occurrences: number; authors: number; humanAuthors: number };
export type Caveat = { statement: string; evidence: Evidence[] };
export type Theory = Omit<z.infer<typeof theoryDraftSchema>, "rules" | "caveats"> & {
  source: { repo: string; commit: string; scopes: string[]; since: string; harvestedAt: string };
  rules: Rule[];
  caveats: Caveat[];
  backlog: string[];
};

const secretShape = /(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|vck_[A-Za-z0-9]{20,})/;

export function assembleTheory(input: unknown, harvest: Harvest): Theory {
  const draft = theoryDraftSchema.parse(input);
  const items = new Map(harvest.items.map((item) => [item.id, item]));
  const problems: string[] = [];
  const resolve = (owner: string, refs: readonly z.infer<typeof evidenceRefSchema>[]) => refs.flatMap((ref) => resolvedEvidence(owner, ref, items, problems));
  const rules = draft.rules.map((rule) => ruleOf(rule, resolve(rule.id, rule.evidence), problems));
  const caveats = draft.caveats.map((caveat, index) => ({ statement: caveat.statement, evidence: resolve(`caveat ${index + 1}`, caveat.evidence) }));
  problems.push(...duplicateIds(rules));
  if (problems.length > 0) throw new Error(`The theory draft does not hold against the harvest:\n- ${problems.join("\n- ")}`);
  return {
    product: draft.product,
    source: { repo: harvest.repo, commit: harvest.commit, scopes: harvest.scopes, since: harvest.since, harvestedAt: harvest.harvestedAt },
    vocabulary: draft.vocabulary,
    components: draft.components,
    caveats,
    rules,
    backlog: backlogOf(rules),
    sourceNotes: draft.sourceNotes,
  };
}

export function backlogOf(rules: readonly Rule[]): string[] {
  return rules
    .filter((rule) => levelIndex(rule.proposedLevel) > levelIndex(rule.currentLevel))
    .sort((a, b) => b.value / b.effort - a.value / a.effort || b.occurrences - a.occurrences || a.id.localeCompare(b.id))
    .map(({ id }) => id);
}

export function levelIndex(level: Level): number {
  return ladder.indexOf(level);
}

function ruleOf(draft: z.infer<typeof ruleDraftSchema>, evidence: Evidence[], problems: string[]): Rule {
  if (levelIndex(draft.proposedLevel) < levelIndex(draft.currentLevel)) problems.push(`${draft.id}: proposed level ${draft.proposedLevel} is below its current level ${draft.currentLevel}`);
  const origins = new Set(evidence.map(({ origin }) => origin));
  const humans = new Set(evidence.filter(({ source }) => source !== "bot-review" && source !== "doc").map(({ author }) => author));
  return { ...draft, evidence, occurrences: origins.size, authors: new Set(evidence.map(({ author }) => author)).size, humanAuthors: humans.size };
}

function resolvedEvidence(owner: string, ref: z.infer<typeof evidenceRefSchema>, items: ReadonlyMap<string, HarvestItem>, problems: string[]): Evidence[] {
  const item = items.get(ref.id);
  if (!item) {
    problems.push(`${owner}: evidence ${ref.id} is not in the harvest`);
    return [];
  }
  if (!normalized(item.body).includes(normalized(ref.quote))) {
    problems.push(`${owner}: the quote "${ref.quote}" is not verbatim in ${ref.id}`);
    return [];
  }
  if (secretShape.test(ref.quote)) {
    problems.push(`${owner}: the quote from ${ref.id} looks like it carries a credential`);
    return [];
  }
  return [{ url: item.url, origin: item.origin, author: item.author, source: item.source, quote: ref.quote }];
}

function duplicateIds(rules: readonly Rule[]): string[] {
  const seen = new Set<string>();
  return rules.flatMap(({ id }) => {
    if (seen.has(id)) return [`rule id ${id} is used twice`];
    seen.add(id);
    return [];
  });
}

function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
