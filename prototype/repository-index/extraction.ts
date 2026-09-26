import { Database } from "bun:sqlite";
import type { ExtractMode, ExtractRequest, ExtractResult } from "./extract-worker.ts";
import type { ImportRef } from "./imports.ts";

export type Extracted = ImportRef[] | null;

export class ExtractionCache {
  private readonly db: Database;

  constructor(path: string, readonly extractorVersion: string) {
    this.db = new Database(path, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA synchronous = NORMAL");
    this.db.run(`CREATE TABLE IF NOT EXISTS extraction (sha TEXT NOT NULL, extractor TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (sha, extractor)) WITHOUT ROWID`);
  }

  getMany(shas: string[]): Map<string, Extracted> {
    const statement = this.db.query<{ data: string }, [string, string]>("SELECT data FROM extraction WHERE sha = ? AND extractor = ?");
    const found = new Map<string, Extracted>();
    for (const sha of shas) {
      const row = statement.get(sha, this.extractorVersion);
      if (row) found.set(sha, JSON.parse(row.data) as Extracted);
    }
    return found;
  }

  putMany(entries: Map<string, Extracted>) {
    const insert = this.db.prepare("INSERT OR REPLACE INTO extraction (sha, extractor, data) VALUES (?, ?, ?)");
    this.db.transaction(() => {
      for (const [sha, data] of entries) insert.run(sha, this.extractorVersion, JSON.stringify(data));
    })();
  }

  close() {
    this.db.close();
  }
}

export type ExtractionStats = { files: number; uniqueBlobs: number; cacheHits: number; parsed: number; failed: number; bytesParsed: number; symbols: number };

export async function extractBlobs(options: {
  repoDir: string;
  files: { sha: string; path: string }[];
  mode: ExtractMode;
  workers: number;
  cache: ExtractionCache | null;
  chunkSize?: number;
}): Promise<{ bySha: Map<string, Extracted>; stats: ExtractionStats }> {
  const unique = new Map<string, string>();
  for (const file of options.files) if (!unique.has(file.sha)) unique.set(file.sha, file.path);
  const bySha = options.cache ? options.cache.getMany([...unique.keys()]) : new Map<string, Extracted>();
  const pending = [...unique].filter(([sha]) => !bySha.has(sha)).map(([sha, path]) => ({ sha, path }));
  const stats: ExtractionStats = {
    files: options.files.length,
    uniqueBlobs: unique.size,
    cacheHits: bySha.size,
    parsed: 0,
    failed: 0,
    bytesParsed: 0,
    symbols: 0,
  };
  const fresh = new Map<string, Extracted>();
  const chunkSize = options.chunkSize ?? 100;
  const chunks: { sha: string; path: string }[][] = [];
  for (let start = 0; start < pending.length; start += chunkSize) chunks.push(pending.slice(start, start + chunkSize));
  const workerCount = Math.max(1, Math.min(options.workers, chunks.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      const worker = new Worker(new URL("./extract-worker.ts", import.meta.url).href);
      try {
        for (let chunk = chunks.shift(); chunk; chunk = chunks.shift()) {
          const results = await new Promise<ExtractResult[]>((resolve, reject) => {
            worker.onmessage = (event: MessageEvent<ExtractResult[]>) => resolve(event.data);
            worker.onerror = (event) => reject(new Error(event.message));
            worker.postMessage({ repoDir: options.repoDir, mode: options.mode, files: chunk } satisfies ExtractRequest);
          });
          for (const result of results) {
            stats.bytesParsed += result.bytes;
            if (result.ok) {
              stats.parsed++;
              stats.symbols += result.symbols ?? 0;
              fresh.set(result.sha, result.imports);
            } else {
              stats.failed++;
              fresh.set(result.sha, null);
            }
          }
        }
      } finally {
        worker.terminate();
      }
    }),
  );
  if (options.cache && fresh.size > 0) options.cache.putMany(fresh);
  for (const [sha, data] of fresh) bySha.set(sha, data);
  return { bySha, stats };
}
