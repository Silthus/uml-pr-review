import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BlobToExtract } from "./extract-worker.ts";
import { extractorVersion, type ImportRef } from "./imports.ts";
import { extractInWorkers } from "./worker-pool.ts";

export type Extracted = ImportRef[] | null;
export type ExtractionCounts = { parsed: number; cacheHits: number; failed: number };
export type ExtractionResult = { refsOf: (blob: BlobToExtract) => Extracted; counts: ExtractionCounts };

type Parsed = [BlobToExtract, ImportRef[]];

const currentExtractors = `${extractorVersion}/`;

export class ExtractionStore {
  private readonly database: Database;
  private readonly remembered = new Map<string, ImportRef[]>();

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath, { create: true });
    this.database.run("PRAGMA journal_mode = WAL");
    this.database.run("PRAGMA synchronous = NORMAL");
    this.database.run("CREATE TABLE IF NOT EXISTS extraction (sha TEXT, extractor TEXT, data TEXT, PRIMARY KEY (sha, extractor)) WITHOUT ROWID");
    this.dropRowsOfOtherExtractors();
  }

  async extract(cwd: string, blobs: BlobToExtract[], workerCount: number): Promise<ExtractionResult> {
    const unique = [...new Map(blobs.map((blob) => [keyOf(blob), blob])).values()];
    const misses = unique.filter((blob) => !this.recall(blob));
    const extractions = await extractInWorkers(
      cwd,
      misses.map(({ sha, language }) => ({ sha, language })),
      workerCount,
    );
    const parsed = extractions.flatMap(({ blob, refs }): Parsed[] => (refs === null ? [] : [[blob, refs]]));
    this.remember(parsed);
    return {
      refsOf: (blob) => this.remembered.get(keyOf(blob)) ?? null,
      counts: { parsed: parsed.length, cacheHits: unique.length - misses.length, failed: extractions.length - parsed.length },
    };
  }

  private dropRowsOfOtherExtractors() {
    this.database.run("DELETE FROM extraction WHERE substr(extractor, 1, length(?1)) <> ?1", [currentExtractors]);
  }

  private recall(blob: BlobToExtract): boolean {
    if (this.remembered.has(keyOf(blob))) return true;
    const row = this.database
      .query<{ data: string }, [string, string]>("SELECT data FROM extraction WHERE sha = ? AND extractor = ? AND data <> 'null'")
      .get(blob.sha, extractorOf(blob));
    if (!row) return false;
    this.remembered.set(keyOf(blob), JSON.parse(row.data) as ImportRef[]);
    return true;
  }

  private remember(entries: Parsed[]) {
    if (entries.length === 0) return;
    const insert = this.database.query("INSERT OR REPLACE INTO extraction (sha, extractor, data) VALUES (?, ?, ?)");
    this.database.transaction(() => {
      for (const [blob, refs] of entries) insert.run(blob.sha, extractorOf(blob), JSON.stringify(refs));
    })();
    for (const [blob, refs] of entries) this.remembered.set(keyOf(blob), refs);
  }
}

function extractorOf({ language }: BlobToExtract): string {
  return `${currentExtractors}${language}`;
}

function keyOf(blob: BlobToExtract): string {
  return `${blob.sha}/${blob.language}`;
}
