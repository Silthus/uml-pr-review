import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { backfill, type BackfillManifest } from "../../coherence/backfill.ts";
import { backfillFixture, type BackfillFixture } from "./backfill-fixture.ts";

const toolTimeoutMs = 300_000;

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

    expect(weekly("products/a")).toEqual([`2026-03-16 ${short("addsB")}`, `2026-03-23 ${short("trivial")}`, `2026-03-30 ${short("merge")}`]);
    expect(weekly("products/b")).toEqual([`2026-03-16 ${short("addsB")}`, `2026-03-23 ${short("trivial")}`, `2026-03-30 ${short("merge")}`]);
    expect(await readdir(join(dataDir, "products/a"))).toContain(`2026-03-26-${commits.merge!.slice(0, 12)}.json`);
  });

  test("a second run reuses every stored result instead of measuring again", async () => {
    const again = await backfill(fixture.request);

    expect(again.runtime.measured).toBe(0);
    expect(again.runtime.reused).toBe(manifest.runtime.measured + manifest.runtime.reused);
    expect(again.scopes).toEqual(manifest.scopes);
  });

  test("measures noise by re-scoring the day before each boundary commit and reporting the typical movement", () => {
    const noise = manifest.scopes["products/a"]!.noise;

    expect(noise.pairs.map(({ before, after }) => `${before.commit.slice(0, 7)}→${after.commit.slice(0, 7)}`)).toEqual([
      `${commits.base!.slice(0, 7)}→${commits.addsB!.slice(0, 7)}`,
      `${commits.busy!.slice(0, 7)}→${commits.trivial!.slice(0, 7)}`,
      `${commits.trivial!.slice(0, 7)}→${commits.merge!.slice(0, 7)}`,
    ]);
    expect(noise.pairs[0]!.delta.composite).toBe(0);
    expect(noise.pairs[1]!.delta.composite).toBe(0);
    expect(noise.pairs[2]!.delta.composite).toBeGreaterThan(5);
    expect(noise.band.composite).toBe(Math.abs(noise.pairs[2]!.delta.composite));
    expect(noise.median.composite).toBe(0);
    expect(manifest.scopes["products/b"]!.noise.pairs).toHaveLength(2);
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
    expect(movers[1]!.subject).toBe("Remove the busy function (#42)");
  });
});
