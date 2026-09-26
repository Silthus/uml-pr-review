#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { git } from "../src/git.ts";
import { CoherenceReportSchema, type CoherenceIndex, type CoherenceReport } from "./contract.ts";
import { measureCoherence } from "./measure.ts";
import { percentile, roundTo } from "./score.ts";

const ScoresSchema = z.object({ composite: z.number(), architecture: z.number(), complexity: z.number(), smells: z.number(), tests: z.number() });
const CommitSchema = z.object({ commit: z.string(), date: z.string() });
const PointSchema = CommitSchema.extend({ week: z.string(), file: z.string(), scores: ScoresSchema });
const NoisePairSchema = z.object({ before: CommitSchema, after: CommitSchema, delta: ScoresSchema });
const MoverSchema = CommitSchema.extend({ week: z.string(), subject: z.string(), pr: z.number().int().nullable(), previous: z.string(), delta: ScoresSchema });

export const BackfillManifestSchema = z.object({
  version: z.literal(1),
  repository: z.string(),
  ref: z.string(),
  head: z.string(),
  until: z.string(),
  weeks: z.number().int(),
  scopes: z.record(
    z.string(),
    z.object({
      points: z.array(PointSchema),
      noise: z.object({ pairs: z.array(NoisePairSchema), median: ScoresSchema, band: ScoresSchema }),
      movers: z.array(MoverSchema),
    }),
  ),
  runtime: z.object({ seconds: z.number(), measured: z.number().int(), reused: z.number().int() }),
});

export type Scores = z.infer<typeof ScoresSchema>;
export type BackfillManifest = z.infer<typeof BackfillManifestSchema>;
export type ScopeSeries = BackfillManifest["scopes"][string];
export type BackfillRequest = { repository: string; ref: string; scopes: string[]; weeks: number; until: Date; dataDir: string; moverWeeks?: number };

export const scoreKeys = ["composite", "architecture", "complexity", "smells", "tests"] as const satisfies readonly (keyof Scores)[];
export const manifestFile = "backfill.json";
const dayMs = 24 * 60 * 60 * 1000;
const pullRequestNumber = /\(#(\d+)\)\s*$/;

type Commit = z.infer<typeof CommitSchema>;
type Log = (line: string) => void;

export async function backfill(request: BackfillRequest, log: Log = () => {}): Promise<BackfillManifest> {
  const started = performance.now();
  const store = new ScoreStore(request.repository, request.dataDir, log);
  const head = (await git(request.repository, ["rev-parse", request.ref])).trim();
  const scopes: BackfillManifest["scopes"] = {};
  for (const scope of request.scopes) {
    const points = await weeklyPoints(request, scope, store);
    const noise = await measureNoise(request, scope, store);
    const movers = await attributeMovers(request, scope, points, store);
    scopes[scope] = { points, noise, movers };
  }
  const manifest = BackfillManifestSchema.parse({
    version: 1,
    repository: basename(resolve(request.repository)),
    ref: request.ref,
    head,
    until: request.until.toISOString(),
    weeks: request.weeks,
    scopes,
    runtime: { seconds: roundTo((performance.now() - started) / 1000, 1), measured: store.measured, reused: store.reused },
  });
  await writeFile(join(request.dataDir, manifestFile), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function readManifest(dataDir: string): Promise<BackfillManifest> {
  return BackfillManifestSchema.parse(JSON.parse(await readFile(join(dataDir, manifestFile), "utf8")));
}

export function scoresOf(index: CoherenceIndex): Scores {
  const { architecture, complexity, smells, tests } = index.dimensions;
  const required = (name: string, score: number | null) => {
    if (score === null) throw new Error(`${index.scope} at ${index.commit} has no ${name} score.`);
    return score;
  };
  return { composite: index.composite.score, architecture: required("architecture", architecture.score), complexity: required("complexity", complexity.score), smells: required("smells", smells.score), tests: required("tests", tests.score) };
}

export function delta(before: Scores, after: Scores): Scores {
  return mapScores((key) => roundTo(after[key] - before[key], 1));
}

export function weekBoundaries(until: Date, weeks: number): Date[] {
  const latest = new Date(until);
  latest.setUTCHours(0, 0, 0, 0);
  latest.setUTCDate(latest.getUTCDate() - ((latest.getUTCDay() + 6) % 7));
  return Array.from({ length: weeks + 1 }, (_, index) => new Date(latest.getTime() - (weeks - index) * 7 * dayMs));
}

async function weeklyPoints({ repository, ref, until, weeks }: BackfillRequest, scope: string, store: ScoreStore) {
  const points: z.infer<typeof PointSchema>[] = [];
  for (const boundary of weekBoundaries(until, weeks)) {
    const commit = await firstParentBefore(repository, ref, boundary);
    const scored = commit === null ? null : await store.score(scope, commit);
    if (scored !== null) points.push({ week: isoDate(boundary), ...scored });
  }
  return points;
}

async function measureNoise({ repository, ref, until, weeks }: BackfillRequest, scope: string, store: ScoreStore) {
  const pairs: z.infer<typeof NoisePairSchema>[] = [];
  for (const boundary of weekBoundaries(until, weeks)) {
    const pair = await weekdayPair(repository, ref, boundary);
    if (pair === null || !(await scopeChanged(repository, pair.before.commit, pair.after.commit, scope))) continue;
    const before = await store.score(scope, pair.before);
    const after = await store.score(scope, pair.after);
    if (before !== null && after !== null) pairs.push({ before: commitOf(before), after: commitOf(after), delta: delta(before.scores, after.scores) });
  }
  const magnitudes = (key: keyof Scores) => pairs.map(({ delta: change }) => Math.abs(change[key]));
  return { pairs, median: mapScores((key) => percentile(magnitudes(key), 0.5)), band: mapScores((key) => percentile(magnitudes(key), 0.9)) };
}

async function weekdayPair(repository: string, ref: string, monday: Date): Promise<{ before: Commit; after: Commit } | null> {
  const [before, after] = await Promise.all([firstParentBefore(repository, ref, daysAfter(monday, 2)), firstParentBefore(repository, ref, daysAfter(monday, 3))]);
  return before === null || after === null || before.commit === after.commit ? null : { before, after };
}

async function scopeChanged(repository: string, from: string, to: string, scope: string): Promise<boolean> {
  return (await git(repository, ["diff", "--name-only", from, to, "--", scope])).trim() !== "";
}

function daysAfter(date: Date, days: number): Date {
  return new Date(date.getTime() + days * dayMs);
}

async function attributeMovers(request: BackfillRequest, scope: string, points: z.infer<typeof PointSchema>[], store: ScoreStore) {
  const weeks = points
    .slice(1)
    .map((point, index) => ({ from: points[index]!, to: point, movement: Math.abs(point.scores.composite - points[index]!.scores.composite) }))
    .sort((a, b) => b.movement - a.movement)
    .slice(0, request.moverWeeks ?? 3);
  const movers: z.infer<typeof MoverSchema>[] = [];
  for (const { from, to } of weeks) {
    let previous: { commit: string; scores: Scores } = from;
    for (const commit of await commitsTouching(request.repository, from.commit, to.commit, scope)) {
      const scored = await store.score(scope, commit);
      if (scored === null) continue;
      movers.push({ ...commitOf(scored), week: to.week, subject: commit.subject, pr: pullRequestOf(commit.subject), previous: previous.commit, delta: delta(previous.scores, scored.scores) });
      previous = scored;
    }
  }
  return movers.sort((a, b) => Math.abs(b.delta.composite) - Math.abs(a.delta.composite) || a.date.localeCompare(b.date));
}

async function firstParentBefore(repository: string, ref: string, date: Date): Promise<Commit | null> {
  const sha = (await git(repository, ["rev-list", "--first-parent", "-1", `--before=${date.toISOString()}`, ref])).trim();
  return sha === "" ? null : { commit: sha, date: await commitDate(repository, sha) };
}

async function commitDate(repository: string, sha: string): Promise<string> {
  return (await git(repository, ["show", "-s", "--format=%cI", sha])).trim();
}

async function commitsTouching(repository: string, from: string, to: string, scope: string): Promise<(Commit & { subject: string })[]> {
  const log = await git(repository, ["log", "--first-parent", "--reverse", "--format=%H%x00%cI%x00%s", `${from}..${to}`, "--", scope]);
  return log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit, date, subject] = line.split("\0") as [string, string, string];
      return { commit, date, subject };
    });
}

function pullRequestOf(subject: string): number | null {
  const match = pullRequestNumber.exec(subject);
  return match ? Number(match[1]) : null;
}

class ScoreStore {
  measured = 0;
  reused = 0;

  constructor(
    private readonly repository: string,
    private readonly dataDir: string,
    private readonly log: Log,
  ) {}

  async score(scope: string, commit: Commit): Promise<(Commit & { file: string; scores: Scores }) | null> {
    if (!(await this.scopeExists(scope, commit.commit))) return null;
    const file = join(scope, `${isoDate(new Date(commit.date))}-${commit.commit.slice(0, 12)}.json`);
    const report = await this.readStored(file);
    if (report) this.reused += 1;
    return { ...commit, file, scores: scoresOf((report ?? (await this.measure(scope, commit, file))).index) };
  }

  private async scopeExists(scope: string, commit: string): Promise<boolean> {
    return (await git(this.repository, ["ls-tree", "-d", commit, "--", scope])).trim() !== "";
  }

  private async readStored(file: string): Promise<CoherenceReport | null> {
    const text = await readFile(join(this.dataDir, file), "utf8").catch(() => null);
    return text === null ? null : CoherenceReportSchema.parse(JSON.parse(text));
  }

  private async measure(scope: string, commit: Commit, file: string): Promise<CoherenceReport> {
    const report = await measureCoherence({ repository: this.repository, scope, commit: commit.commit });
    await mkdir(join(this.dataDir, scope), { recursive: true });
    await writeFile(join(this.dataDir, file), JSON.stringify(report, null, 2));
    this.measured += 1;
    this.log(`${scope} ${commit.date.slice(0, 10)} ${commit.commit.slice(0, 12)} composite ${report.index.composite.score} in ${(report.timing.milliseconds / 1000).toFixed(1)} s`);
    return report;
  }
}

function mapScores(valueOf: (key: keyof Scores) => number): Scores {
  return Object.fromEntries(scoreKeys.map((key) => [key, valueOf(key)])) as Scores;
}

function commitOf({ commit, date }: Commit): Commit {
  return { commit, date };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

if (import.meta.main) {
  const usage = "Usage: bun coherence/backfill.ts --repo <path> --scopes <a,b> [--ref master] [--since '26 weeks'] [--every week] [--until <iso>] [--data coherence/data] [--mover-weeks 3]";
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      scopes: { type: "string" },
      ref: { type: "string", default: "master" },
      since: { type: "string", default: "26 weeks" },
      every: { type: "string", default: "week" },
      until: { type: "string" },
      data: { type: "string", default: join(import.meta.dir, "data") },
      "mover-weeks": { type: "string", default: "3" },
    },
  });
  const weeks = /^(\d+)\s*weeks?$/.exec(values.since)?.[1];
  if (!values.repo || !values.scopes || weeks === undefined || values.every !== "week") {
    console.error(usage);
    process.exit(2);
  }
  const manifest = await backfill(
    {
      repository: resolve(values.repo),
      ref: values.ref,
      scopes: values.scopes.split(",").map((scope) => scope.trim()),
      weeks: Number(weeks),
      until: values.until ? new Date(values.until) : new Date(),
      dataDir: resolve(values.data),
      moverWeeks: Number(values["mover-weeks"]),
    },
    (line) => console.error(line),
  );
  const { seconds, measured, reused } = manifest.runtime;
  console.log(`Backfilled ${Object.keys(manifest.scopes).length} scopes over ${manifest.weeks} weeks in ${seconds} s (${measured} measured, ${reused} reused). Manifest: ${join(resolve(values.data), manifestFile)}`);
}
