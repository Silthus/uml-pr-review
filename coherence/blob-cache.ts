import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type CacheCounts = { hits: number; misses: number };

export class BlobCache {
  readonly counts: CacheCounts = { hits: 0, misses: 0 };
  private readonly database: Database;

  constructor(commonDir: string) {
    const directory = join(commonDir, "uml-pr-review");
    mkdirSync(directory, { recursive: true });
    this.database = new Database(join(directory, "coherence-cache.sqlite"), { create: true });
    this.database.run("CREATE TABLE IF NOT EXISTS result (key TEXT PRIMARY KEY, data TEXT) WITHOUT ROWID");
  }

  async resolve<Item, Result>(items: Item[], keyOf: (item: Item) => string, compute: (misses: Item[]) => Promise<Map<Item, Result>>): Promise<Map<Item, Result>> {
    const results = new Map<Item, Result>();
    const misses = items.filter((item) => {
      const row = this.database.query<{ data: string }, [string]>("SELECT data FROM result WHERE key = ?").get(keyOf(item));
      if (row) results.set(item, JSON.parse(row.data) as Result);
      return !row;
    });
    this.counts.hits += items.length - misses.length;
    this.counts.misses += misses.length;
    if (misses.length === 0) return results;
    const computed = await compute(misses);
    const insert = this.database.query("INSERT OR REPLACE INTO result (key, data) VALUES (?, ?)");
    this.database.transaction(() => {
      for (const item of misses) {
        const result = computed.get(item)!;
        insert.run(keyOf(item), JSON.stringify(result));
        results.set(item, result);
      }
    })();
    return results;
  }

  close(): void {
    this.database.close();
  }
}
