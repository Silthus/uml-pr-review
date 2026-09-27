#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { git } from "../../src/git.ts";
import { CoherenceReportSchema, type CoherenceIndex } from "../contract.ts";
import { measureCoherence } from "../measure.ts";
import { rescore } from "../rescore.ts";
import { scoringVersion } from "../score.ts";
import { changesBetween, ChangesSchema, scoresOf, ScoresSchema } from "./changes.ts";

const LineCountSchema = z.object({ files: z.number(), added: z.number(), deleted: z.number() });
type LineCount = z.infer<typeof LineCountSchema>;

export const AttributionSchema = ChangesSchema.extend({
  commit: z.string(),
  parent: z.string(),
  date: z.string(),
  pr: z.number().nullable(),
  title: z.string(),
  type: z.string(),
  lines: z.object({ scope: LineCountSchema, scopeTests: LineCountSchema, scopeMeasured: LineCountSchema, outside: LineCountSchema }),
  before: ScoresSchema,
  after: ScoresSchema,
});
export type Attribution = z.infer<typeof AttributionSchema>;

export const AttributionRunSchema = z.object({ scoringVersion: z.number().int().default(1), repository: z.string(), ref: z.string(), head: z.string(), since: z.string(), scope: z.string(), commits: z.array(AttributionSchema) });
export type AttributionRun = z.infer<typeof AttributionRunSchema>;

type Commit = { commit: string; parent: string; date: string; subject: string };
type FileChange = { path: string; added: number; deleted: number };

const pullRequestNumber = /\(#(\d+)\)\s*$/;
const conventionalType = /^(\w+)(?:\([^)]*\))?!?:/;
const testPath = /(^|\/)(tests?|__tests__|__snapshots__)\/|(^|\/)test_[^/]*\.py$|_test\.py$|\.(test|spec|stories)\.tsx?$/;
const measuredSource = /\.(py|tsx?)$/;

export async function attribute(options: { repository: string; ref: string; since: string; scope: string; reports: string; concurrency: number; log?: (line: string) => void }): Promise<AttributionRun> {
  const { repository, ref, since, scope, reports, concurrency, log = () => {} } = options;
  const head = (await git(repository, ["rev-parse", ref])).trim();
  const commits = await commitsTouching(repository, head, since, scope);
  await mkdir(reports, { recursive: true });
  const indexOf = (commit: string) => storedIndex(repository, scope, commit, reports);
  const attributions = await inPool(commits, concurrency, async (commit, position) => {
    const [before, after, files] = await Promise.all([indexOf(commit.parent), indexOf(commit.commit), changedFiles(repository, commit)]);
    log(`${position + 1}/${commits.length} ${commit.commit.slice(0, 12)} ${after.composite.score - before.composite.score >= 0 ? "+" : ""}${(after.composite.score - before.composite.score).toFixed(1)} ${commit.subject}`);
    return attributionOf(commit, before, after, files, scope);
  });
  return { scoringVersion, repository: resolve(repository).split("/").pop()!, ref, head, since, scope, commits: attributions };
}

function attributionOf(commit: Commit, before: CoherenceIndex, after: CoherenceIndex, files: FileChange[], scope: string): Attribution {
  const inScope = files.filter(({ path }) => path.startsWith(`${scope}/`));
  return {
    commit: commit.commit,
    parent: commit.parent,
    date: commit.date,
    pr: Number(pullRequestNumber.exec(commit.subject)?.[1] ?? NaN) || null,
    title: commit.subject.replace(pullRequestNumber, "").trim(),
    type: conventionalType.exec(commit.subject)?.[1]?.toLowerCase() ?? "other",
    lines: {
      scope: lineCount(inScope),
      scopeTests: lineCount(inScope.filter(({ path }) => testPath.test(path))),
      scopeMeasured: lineCount(inScope.filter(({ path }) => measuredSource.test(path) && !testPath.test(path))),
      outside: lineCount(files.filter(({ path }) => !path.startsWith(`${scope}/`))),
    },
    before: scoresOf(before),
    after: scoresOf(after),
    ...changesBetween(before, after),
  };
}

function lineCount(files: FileChange[]): LineCount {
  return { files: files.length, added: files.reduce((total, { added }) => total + added, 0), deleted: files.reduce((total, { deleted }) => total + deleted, 0) };
}

async function commitsTouching(repository: string, head: string, since: string, scope: string): Promise<Commit[]> {
  const log = await git(repository, ["log", "--first-parent", "--reverse", `--since=${since}`, "--format=%H%x00%P%x00%cI%x00%s", head, "--", scope]);
  return log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit, parents, date, subject] = line.split("\0") as [string, string, string, string];
      return { commit, parent: parents.split(" ")[0]!, date, subject };
    });
}

async function changedFiles(repository: string, { parent, commit }: Commit): Promise<FileChange[]> {
  const numstat = await git(repository, ["diff", "--numstat", "--no-renames", parent, commit]);
  return numstat
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, path] = line.split("\t") as [string, string, string];
      return { path, added: Number(added) || 0, deleted: Number(deleted) || 0 };
    });
}

export async function storedIndex(repository: string, scope: string, commit: string, reports: string): Promise<CoherenceIndex> {
  const file = join(reports, `${commit}.json`);
  const stored = await readFile(file, "utf8").catch(() => null);
  if (stored !== null) return rescore(CoherenceReportSchema.parse(JSON.parse(stored)).index);
  const report = await measureCoherence({ repository, scope, commit });
  await writeFile(file, JSON.stringify(report));
  return report.index;
}

async function inPool<T, R>(items: T[], concurrency: number, work: (item: T, position: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let position = next++; position < items.length; position = next++) results[position] = await work(items[position]!, position);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

const ArgumentsSchema = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1),
  since: z.iso.date(),
  scope: z.string().min(1),
  reports: z.string().min(1),
  out: z.string().min(1),
  concurrency: z.coerce.number().int().min(1),
});

if (import.meta.main) {
  const usage = "Usage: bun coherence/validation/attribute.ts --repo <path> --ref <sha> [--since 2026-06-27] [--scope products/workflows] [--reports /tmp/coherence-validation-reports] [--out coherence/validation/data/attribution.json] [--concurrency 4]";
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      ref: { type: "string" },
      since: { type: "string", default: "2026-06-27" },
      scope: { type: "string", default: "products/workflows" },
      reports: { type: "string", default: "/tmp/coherence-validation-reports" },
      out: { type: "string", default: join(import.meta.dir, "data", "attribution.json") },
      concurrency: { type: "string", default: "4" },
    },
  });
  const parsed = ArgumentsSchema.safeParse(values);
  if (!parsed.success) {
    console.error(`${usage}\n${z.prettifyError(parsed.error)}`);
    process.exit(2);
  }
  const { repo, ref, since, scope, reports, out, concurrency } = parsed.data;
  const run = await attribute({ repository: resolve(repo), ref, since, scope, reports: resolve(reports), concurrency, log: (line) => console.error(line) });
  await mkdir(join(resolve(out), ".."), { recursive: true });
  await writeFile(resolve(out), JSON.stringify(run, null, 1));
  console.log(`Attributed ${run.commits.length} commits touching ${scope} since ${since} at ${run.head.slice(0, 12)}: ${resolve(out)}`);
}
