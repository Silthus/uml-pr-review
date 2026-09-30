import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CorpusRow } from "../corrections/corpus.ts";
import { git } from "../../src/git.ts";

export type FixStat = { files: number; added: number; removed: number };
export type Evidence = { body: string; diff: string; stat: FixStat; base: string };
export type Sources = (row: CorpusRow) => Promise<Evidence>;

const reviewCommentSchema = z.object({ body: z.string() });

export function liveSources(cache: string, posthog: string): Sources {
  return async (row) => {
    const [body, diff, stat, base] = await Promise.all([commentBody(cache, row.id), fixDiff(posthog, row), fixStat(posthog, row), mergeBase(posthog, row)]);
    return { body, diff, stat, base };
  };
}

async function commentBody(cache: string, id: string): Promise<string> {
  const directory = join(cache, "comments");
  const file = join(directory, `${id.replaceAll(":", "_")}.json`);
  const cached = await readFile(file, "utf8").catch(() => null);
  if (cached !== null) return reviewCommentSchema.parse(JSON.parse(cached)).body;
  const commentId = id.split(":").at(-1)!;
  const text = await Bun.$`gh api repos/PostHog/posthog/pulls/comments/${commentId}`.text();
  await mkdir(directory, { recursive: true });
  await writeFile(file, text);
  return reviewCommentSchema.parse(JSON.parse(text)).body;
}

async function fixDiff(posthog: string, row: CorpusRow): Promise<string> {
  return git(posthog, ["show", "--format=", row.fix!, "--", row.path]);
}

async function fixStat(posthog: string, row: CorpusRow): Promise<FixStat> {
  const lines = (await git(posthog, ["show", "--numstat", "--format=", row.fix!])).split("\n").filter(Boolean);
  const counts = lines.map((line) => line.split("\t").map(Number));
  return {
    files: lines.length,
    added: counts.reduce((sum, [added]) => sum + (Number.isFinite(added) ? added! : 0), 0),
    removed: counts.reduce((sum, [, removed]) => sum + (Number.isFinite(removed) ? removed! : 0), 0),
  };
}

async function mergeBase(posthog: string, row: CorpusRow): Promise<string> {
  return (await git(posthog, ["merge-base", "origin/master", row.before!])).trim();
}
