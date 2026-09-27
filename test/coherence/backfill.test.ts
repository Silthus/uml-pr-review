import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { backfill, type BackfillManifest } from "../../coherence/backfill.ts";
import { CoherenceReportSchema } from "../../coherence/contract.ts";
import { backfillFixture, mergeSubject, type BackfillFixture } from "./backfill-fixture.ts";

const toolTimeoutMs = 300_000;
const zero = { composite: 0, architecture: 0, complexity: 0, smells: 0, tests: 0 };

let fixture: BackfillFixture;
let manifest: BackfillManifest;
let dataDir: string;
let commits: Record<string, string>;

beforeAll(async () => {
  fixture = await backfillFixture();
  ({ manifest, dataDir, commits } = fixture);
}, toolTimeoutMs);

afterAll(() => fixture.cleanup());

describe("the weekly backfill", () => {
  test("scores the first-parent commit at each week boundary and skips weeks where the scope does not exist yet", async () => {
    const weekly = (scope: string) => manifest.scopes[scope]!.points.map(({ week, commit }) => `${week} ${commit.slice(0, 7)}`);
    const short = (name: string) => commits[name]!.slice(0, 7);

    expect(weekly("products/a")).toEqual([`2026-03-16 ${short("base")}`, `2026-03-23 ${short("trivial")}`, `2026-03-30 ${short("merge")}`]);
    expect(weekly("products/b")).toEqual([`2026-03-23 ${short("trivial")}`, `2026-03-30 ${short("merge")}`]);
    expect(await readdir(join(dataDir, "products/a"))).toContain(`2026-03-26-${commits.merge!.slice(0, 12)}.json`);
  });

  test("a second run reuses every stored result instead of measuring again", async () => {
    const again = await backfill(fixture.request);

    expect(again.runtime.measured).toBe(0);
    expect(manifest.runtime.reused).toBe(0);
    expect(again.runtime.reused).toBe(manifest.runtime.measured);
    expect(again.runtime.total.measured).toBe(manifest.runtime.measured);
    expect(again.runtime.total.seconds).toBeCloseTo(manifest.runtime.total.seconds + again.runtime.seconds, 5);
    expect(again.scopes).toEqual(manifest.scopes);
  });

  test("measures noise by re-scoring Wednesday and Thursday of each week, keeping only the days that changed the scope", () => {
    const noise = manifest.scopes["products/a"]!.noise;

    expect(noise.pairs.map(({ before, after }) => `${before.commit.slice(0, 7)}→${after.commit.slice(0, 7)}`)).toEqual([`${commits.addsB!.slice(0, 7)}→${commits.busy!.slice(0, 7)}`]);
    expect(noise.pairs[0]!.delta.composite).toBeLessThan(-5);
    expect(noise.band.composite).toBe(Math.abs(noise.pairs[0]!.delta.composite));
    expect(noise.median.composite).toBe(noise.band.composite);
    expect(manifest.scopes["products/b"]!.noise).toEqual({ pairs: [], median: zero, band: zero });
  });

  test("attributes the biggest weekly moves to the commits inside the week that touched the scope, with their pull request", () => {
    const movers = manifest.scopes["products/a"]!.movers;

    expect(movers.map(({ commit, week, pr }) => ({ commit: commit.slice(0, 7), week, pr }))).toEqual([
      { commit: commits.busy!.slice(0, 7), week: "2026-03-23", pr: null },
      { commit: commits.merge!.slice(0, 7), week: "2026-03-30", pr: 42 },
      { commit: commits.trivial!.slice(0, 7), week: "2026-03-23", pr: null },
    ]);
    expect(movers[0]!.delta.composite).toBeLessThan(-5);
    expect(movers[1]!.delta.composite).toBeCloseTo(-movers[0]!.delta.composite, 5);
    expect(movers[1]!.subject).toBe(mergeSubject);
  });

  test("computes every delta from the unrounded scores it stores", async () => {
    const stored = await storedComposites("products/a");
    const deltas = manifest.scopes["products/a"]!.movers.map(({ commit, previous, delta }) => ({ delta: delta.composite, exact: stored.get(commit)! - stored.get(previous)! }));

    expect(deltas.map(({ delta }) => delta)).toEqual(deltas.map(({ exact }) => exact));
    expect(deltas.some(({ delta }) => Math.abs(delta * 10 - Math.round(delta * 10)) > 1e-9)).toBe(true);
  });

  test("rescores stored measurements under the current anchors instead of trusting their stored scores", async () => {
    const file = join(dataDir, manifest.scopes["products/a"]!.points[0]!.file);
    const stored = CoherenceReportSchema.parse(JSON.parse(await readFile(file, "utf8")));
    const staleScores = structuredClone(stored);
    staleScores.index.composite.score = 0;
    staleScores.index.dimensions.architecture.score = 0;
    staleScores.index.dimensions.architecture.measures = { facadeShare: { value: 0, score: 0, best: 1, worst: 0 } };
    await writeFile(file, JSON.stringify(staleScores));

    const again = await backfill(fixture.request);

    expect(again.runtime.measured).toBe(0);
    expect(again.scopes).toEqual(manifest.scopes);
    expect(CoherenceReportSchema.parse(JSON.parse(await readFile(file, "utf8"))).index).toEqual(stored.index);
  });
});

async function storedComposites(scope: string): Promise<Map<string, number>> {
  const files = (await readdir(join(dataDir, scope))).filter((file) => /^\d{4}-\d{2}-\d{2}-/.test(file));
  const reports = await Promise.all(files.map(async (file) => CoherenceReportSchema.parse(JSON.parse(await readFile(join(dataDir, scope, file), "utf8"))).index));
  return new Map(reports.map(({ commit, composite }) => [commit, composite.score]));
}
