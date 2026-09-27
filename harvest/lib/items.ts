import { z } from "zod";

const itemSources = ["review", "bot-review", "session", "doc"] as const;

const harvestItemSchema = z.object({
  id: z.string(),
  source: z.enum(itemSources),
  origin: z.string(),
  url: z.string(),
  author: z.string(),
  isBot: z.boolean(),
  byPullRequestAuthor: z.boolean(),
  path: z.string().nullable(),
  line: z.number().int().nullable(),
  body: z.string(),
  at: z.string().nullable(),
});
export type HarvestItem = z.infer<typeof harvestItemSchema>;

const dropSchema = z.object({ source: z.string(), reason: z.string(), count: z.number().int() });
type Drop = z.infer<typeof dropSchema>;

export const harvestSchema = z.object({
  repo: z.string(),
  scopes: z.array(z.string()),
  since: z.string(),
  commit: z.string(),
  harvestedAt: z.string(),
  relevanceFilter: z.string(),
  collected: z.record(z.string(), z.number().int()),
  drops: z.array(dropSchema),
  items: z.array(harvestItemSchema),
});
export type Harvest = z.infer<typeof harvestSchema>;

export const wholeRepository = ".";

export function inScope(path: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => scope === wholeRepository || path === scope || path.startsWith(`${scope.replace(/\/$/, "")}/`));
}

export class DropLedger {
  private readonly counts = new Map<string, Drop>();

  record(source: string, reason: string, count = 1): void {
    if (count === 0) return;
    const key = `${source}\u0000${reason}`;
    const existing = this.counts.get(key);
    this.counts.set(key, { source, reason, count: (existing?.count ?? 0) + count });
  }

  entries(): Drop[] {
    return [...this.counts.values()].sort((a, b) => a.source.localeCompare(b.source) || b.count - a.count);
  }
}
