import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Split } from "../corrections/comments.ts";
import { corpusRowSchema, type CorpusRow } from "../corrections/corpus.ts";

const corpusFile = join(import.meta.dir, "..", "..", "docs", "corrections", "corpus.jsonl");
const heldOutDigestFile = join(import.meta.dir, "..", "..", "docs", "corrections", "heldout.sha256");

export type IsolatedFix = CorpusRow & { commentCommit: string; before: string; fix: string };

export async function readCorpus(file = corpusFile): Promise<CorpusRow[]> {
  const lines = (await Bun.file(file).text()).split("\n").filter(Boolean);
  return lines.map((line) => corpusRowSchema.parse(JSON.parse(line)));
}

export function isolatedFixes(rows: CorpusRow[], split: Split): IsolatedFix[] {
  return rows.filter((row): row is IsolatedFix => row.split === split && row.isolable && row.commentCommit !== null && row.before !== null && row.fix !== null);
}

export async function verifyHeldOutDigest(file = corpusFile): Promise<string> {
  const heldOut = (await Bun.file(file).text()).split("\n").filter((line) => line.includes('"split":"heldout"'));
  const digest = createHash("sha256").update(heldOut.map((line) => `${line}\n`).join("")).digest("hex");
  const recorded = (await Bun.file(heldOutDigestFile).text()).split(/\s/)[0];
  if (digest !== recorded) throw new Error(`The held-out rows hash to ${digest}, but heldout.sha256 records ${recorded}.`);
  return digest;
}

export function stableOrder<T extends { id: string }>(items: T[], seed: string): T[] {
  const rank = (item: T) => createHash("sha256").update(`${seed}:${item.id}`).digest("hex");
  return items.map((item) => ({ item, rank: rank(item) })).sort((a, b) => a.rank.localeCompare(b.rank)).map(({ item }) => item);
}
