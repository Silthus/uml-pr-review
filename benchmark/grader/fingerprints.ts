import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { git, listBlobs, readBlobs, type TreeEntry } from "../../src/architecture/index/git.ts";
import { isProductionSource } from "./change.ts";

export type Fingerprint = { hash: number; line: number };
export type FingerprintSettings = { windowTokens: number; winnow: number };

const tokenPattern = /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|[A-Za-z_$][\w$]*|\d[\w.]*|[^\s\w]/g;
const readBatch = 2000;
const largestIndexedBlob = 300_000;

export function fingerprintsOf(text: string, { windowTokens, winnow }: FingerprintSettings): Fingerprint[] {
  const tokens = tokensOf(text);
  const windows: Fingerprint[] = [];
  for (let start = 0; start + windowTokens <= tokens.hashes.length; start++) windows.push({ hash: windowHash(tokens.hashes, start, windowTokens), line: tokens.lines[start]! });
  return winnowed(windows, winnow);
}

function tokensOf(text: string): { hashes: number[]; lines: number[] } {
  const hashes: number[] = [];
  const lines: number[] = [];
  let line = 1;
  let consumed = 0;
  for (const match of text.matchAll(tokenPattern)) {
    line += newlines(text, consumed, match.index);
    consumed = match.index;
    const token = match[0];
    if (isComment(token)) continue;
    hashes.push(stringHash(normalised(token)));
    lines.push(line);
  }
  return { hashes, lines };
}

function newlines(text: string, from: number, to: number): number {
  let count = 0;
  for (let index = text.indexOf("\n", from); index !== -1 && index < to; index = text.indexOf("\n", index + 1)) count++;
  return count;
}

function isComment(token: string): boolean {
  return token.startsWith("//") || token.startsWith("/*") || token.startsWith("#");
}

function normalised(token: string): string {
  const first = token[0]!;
  if (first === '"' || first === "'" || first === "`") return "S";
  if (first >= "0" && first <= "9") return "N";
  return token;
}

function stringHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return hash >>> 0;
}

function windowHash(hashes: number[], start: number, length: number): number {
  let hash = 0;
  for (let index = start; index < start + length; index++) hash = (Math.imul(hash, 0x9e3779b1) + hashes[index]!) >>> 0;
  return hash;
}

function winnowed(windows: Fingerprint[], size: number): Fingerprint[] {
  if (windows.length <= size) return windows.length === 0 ? [] : [minimumOf(windows, 0, windows.length)];
  const picked: Fingerprint[] = [];
  let last = -1;
  for (let start = 0; start + size <= windows.length; start++) {
    const position = minimumPosition(windows, start, start + size);
    if (position !== last) picked.push(windows[position]!);
    last = position;
  }
  return picked;
}

function minimumOf(windows: Fingerprint[], from: number, to: number): Fingerprint {
  return windows[minimumPosition(windows, from, to)]!;
}

function minimumPosition(windows: Fingerprint[], from: number, to: number): number {
  let best = to - 1;
  for (let index = to - 1; index >= from; index--) if (windows[index]!.hash < windows[best]!.hash) best = index;
  return best;
}

export class FingerprintCache {
  private readonly database: Database;
  private readonly settingsKey: string;

  constructor(
    directory: string,
    readonly settings: FingerprintSettings,
  ) {
    mkdirSync(directory, { recursive: true });
    this.database = new Database(join(directory, "grader-fingerprints.sqlite"), { create: true });
    this.database.run("PRAGMA busy_timeout = 10000");
    this.database.run("PRAGMA journal_mode = WAL");
    this.database.run("CREATE TABLE IF NOT EXISTS fingerprints (key TEXT PRIMARY KEY, data BLOB) WITHOUT ROWID");
    this.settingsKey = `v1:${settings.windowTokens}:${settings.winnow}`;
  }

  async ofBlobs(repository: string, entries: TreeEntry[]): Promise<Map<string, Fingerprint[]>> {
    const found = new Map<string, Fingerprint[]>();
    const select = this.database.query<{ data: Uint8Array }, [string]>("SELECT data FROM fingerprints WHERE key = ?");
    const missing = entries.filter(({ sha }) => {
      const row = select.get(`${this.settingsKey}:${sha}`);
      if (row) found.set(sha, decoded(row.data));
      return !row;
    });
    for (let start = 0; start < missing.length; start += readBatch) {
      const batch = missing.slice(start, start + readBatch);
      const texts = await readBlobs(repository, batch.map(({ sha }) => sha));
      this.store(batch.map(({ sha }) => [sha, fingerprintsOf(indexable(texts.get(sha)), this.settings)] as const), found);
    }
    return found;
  }

  ofText(sha: string, text: string): Fingerprint[] {
    const row = this.database.query<{ data: Uint8Array }, [string]>("SELECT data FROM fingerprints WHERE key = ?").get(`${this.settingsKey}:${sha}`);
    if (row) return decoded(row.data);
    const fingerprints = fingerprintsOf(text, this.settings);
    this.store([[sha, fingerprints]], new Map());
    return fingerprints;
  }

  close(): void {
    this.database.close();
  }

  private store(items: (readonly [string, Fingerprint[]])[], into: Map<string, Fingerprint[]>): void {
    const insert = this.database.query("INSERT OR REPLACE INTO fingerprints (key, data) VALUES (?, ?)");
    this.database.transaction(() => {
      for (const [sha, fingerprints] of items) {
        insert.run(`${this.settingsKey}:${sha}`, encoded(fingerprints));
        into.set(sha, fingerprints);
      }
    })();
  }
}

function indexable(text: string | undefined): string {
  return text === undefined || text.length > largestIndexedBlob ? "" : text;
}

function encoded(fingerprints: Fingerprint[]): Uint8Array {
  const values = new Uint32Array(fingerprints.length * 2);
  fingerprints.forEach(({ hash, line }, index) => {
    values[index * 2] = hash;
    values[index * 2 + 1] = line;
  });
  return new Uint8Array(values.buffer);
}

function decoded(data: Uint8Array): Fingerprint[] {
  const values = new Uint32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return Array.from({ length: values.length / 2 }, (_, index) => ({ hash: values[index * 2]!, line: values[index * 2 + 1]! }));
}

export type RepositoryFingerprints = { tree: string; filesWith(hash: number): string[] };

export class FingerprintIndex {
  private tree: string | undefined;
  private readonly hashesByPath = new Map<string, Set<number>>();
  private readonly pathsByHash = new Map<number, string[]>();

  constructor(
    private readonly repository: string,
    private readonly cache: FingerprintCache,
  ) {}

  async at(commit: string): Promise<RepositoryFingerprints> {
    const tree = (await git(this.repository, ["rev-parse", `${commit}^{tree}`])).trim();
    if (tree !== this.tree) await (this.tree === undefined ? this.build(tree) : this.update(this.tree, tree));
    this.tree = tree;
    return { tree, filesWith: (hash) => this.pathsByHash.get(hash) ?? [] };
  }

  private async build(tree: string): Promise<void> {
    const entries = (await listBlobs(this.repository, tree)).filter(({ path }) => isProductionSource(path));
    const fingerprints = await this.cache.ofBlobs(this.repository, entries);
    for (const { path, sha } of entries) this.add(path, fingerprints.get(sha) ?? []);
  }

  private async update(from: string, to: string): Promise<void> {
    const output = await git(this.repository, ["diff-tree", "-r", "-z", "--no-renames", from, to]);
    const fields = output.split("\0");
    const added: TreeEntry[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const [mode, , , sha] = fields[index]!.slice(1).split(" ");
      const path = fields[index + 1]!;
      if (!isProductionSource(path)) continue;
      this.remove(path);
      if (!/^0+$/.test(sha!)) added.push({ mode: mode!, sha: sha!, path });
    }
    const fingerprints = await this.cache.ofBlobs(this.repository, added);
    for (const { path, sha } of added) this.add(path, fingerprints.get(sha) ?? []);
  }

  private add(path: string, fingerprints: Fingerprint[]): void {
    const hashes = new Set(fingerprints.map(({ hash }) => hash));
    this.hashesByPath.set(path, hashes);
    for (const hash of hashes) {
      const paths = this.pathsByHash.get(hash);
      if (paths) paths.push(path);
      else this.pathsByHash.set(hash, [path]);
    }
  }

  private remove(path: string): void {
    for (const hash of this.hashesByPath.get(path) ?? []) {
      const remaining = (this.pathsByHash.get(hash) ?? []).filter((other) => other !== path);
      if (remaining.length > 0) this.pathsByHash.set(hash, remaining);
      else this.pathsByHash.delete(hash);
    }
    this.hashesByPath.delete(path);
  }
}
