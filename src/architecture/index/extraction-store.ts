import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BlobToExtract } from "./extract-worker.ts";
import { extractorVersion, type ImportRef } from "./imports.ts";
import { extractInWorkers } from "./worker-pool.ts";

export type Extracted = ImportRef[] | null;
export type ExtractionCounts = { parsed: number; cacheHits: number; failed: number };
export type ExtractionResult = { bySha: Map<string, Extracted>; counts: ExtractionCounts };

export class ExtractionStore {
  private readonly database: Database;
  private readonly remembered = new Map<string, Extracted>();

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath, { create: true });
    this.database.run("PRAGMA journal_mode = WAL");
    this.database.run("PRAGMA synchronous = NORMAL");
    this.database.run("CREATE TABLE IF NOT EXISTS extraction (sha TEXT, extractor TEXT, data TEXT, PRIMARY KEY (sha, extractor)) WITHOUT ROWID");
  }

  async extract(cwd: string, blobs: BlobToExtract[], workerCount: number): Promise<ExtractionResult> {
    const unique = uniqueBySha(blobs);
    const misses = unique.filter(({ sha }) => !this.recall(sha));
    const extractions = await extractInWorkers(cwd, misses, workerCount);
    this.remember(extractions.map(({ sha, refs }) => [sha, refs]));
    const failed = extractions.filter(({ refs }) => refs === null).length;
    return {
      bySha: new Map(unique.map(({ sha }) => [sha, this.remembered.get(sha) ?? null])),
      counts: { parsed: extractions.length - failed, cacheHits: unique.length - misses.length, failed },
    };
  }

  private recall(sha: string): boolean {
    if (this.remembered.has(sha)) return true;
    const row = this.database
      .query<{ data: string }, [string, string]>("SELECT data FROM extraction WHERE sha = ? AND extractor = ?")
      .get(sha, extractorVersion);
    if (!row) return false;
    this.remembered.set(sha, JSON.parse(row.data) as Extracted);
    return true;
  }

  private remember(entries: [string, Extracted][]) {
    if (entries.length === 0) return;
    const insert = this.database.query("INSERT OR REPLACE INTO extraction (sha, extractor, data) VALUES (?, ?, ?)");
    this.database.transaction(() => {
      for (const [sha, refs] of entries) insert.run(sha, extractorVersion, JSON.stringify(refs));
    })();
    for (const [sha, refs] of entries) this.remembered.set(sha, refs);
  }
}

function uniqueBySha(blobs: BlobToExtract[]): BlobToExtract[] {
  return [...new Map(blobs.map((blob) => [blob.sha, blob])).values()];
}
