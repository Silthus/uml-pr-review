import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backfill, type BackfillManifest } from "../../coherence/backfill.ts";
import { repositoryWithoutCommits, type Files, type TemporaryRepository } from "../architecture/index/repository.ts";

const toolTimeoutMs = 300_000;

const productA: Files = {
  "products/__init__.py": "",
  "products/a/__init__.py": "",
  "products/a/backend/__init__.py": "",
  "products/a/backend/logic.py": "from products.a.backend.helpers import double\n\n\ndef compute(value):\n    return double(value) + 1\n",
  "products/a/backend/helpers.py": "def double(value):\n    return value * 2\n",
  "products/a/backend/limits.py": "LIMIT = 3\n",
};
const productB: Files = { "products/b/__init__.py": "", "products/b/backend/__init__.py": "", "products/b/backend/api.py": "def lookup():\n    return 1\n" };
const busyFunction = `def busy(value):\n${Array.from({ length: 24 }, (_, index) => `    if value == ${index}:\n        return ${index}\n`).join("")}    return -1\n`;

let repository: TemporaryRepository;
let dataDir: string;
let manifest: BackfillManifest;
const commits: Record<string, string> = {};

async function commitOn(name: string, date: string, files: Files, ...gitArgs: string[]): Promise<void> {
  process.env.GIT_COMMITTER_DATE = date;
  process.env.GIT_AUTHOR_DATE = date;
  if (gitArgs.length > 0) await repository.git(...gitArgs);
  else await repository.commit(files);
  commits[name] = (await repository.git("rev-parse", "HEAD")).trim();
}

beforeAll(async () => {
  repository = await repositoryWithoutCommits();
  await commitOn("base", "2026-03-10T12:00:00Z", productA);
  await commitOn("addsB", "2026-03-14T12:00:00Z", productB);
  await commitOn("busy", "2026-03-18T10:00:00Z", { "products/a/backend/busy.py": busyFunction });
  await commitOn("trivial", "2026-03-19T12:00:00Z", { "products/a/backend/limits.py": "LIMIT = 4\n" });
  await repository.git("checkout", "--quiet", "-b", "cleanup");
  await commitOn("removesBusy", "2026-03-25T12:00:00Z", { "products/a/backend/busy.py": null });
  await repository.git("checkout", "--quiet", "main");
  await commitOn("merge", "2026-03-26T12:00:00Z", {}, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "merge", "--no-ff", "--quiet", "-m", "Remove the busy function (#42)", "cleanup");
  delete process.env.GIT_COMMITTER_DATE;
  delete process.env.GIT_AUTHOR_DATE;
  dataDir = await mkdtemp(join(tmpdir(), "coherence-backfill-"));
  manifest = await backfill({ repository: repository.dir, ref: "main", scopes: ["products/a", "products/b"], weeks: 2, until: new Date("2026-03-30T00:00:00Z"), dataDir });
}, toolTimeoutMs);

afterAll(async () => {
  await repository.cleanup();
  await rm(dataDir, { recursive: true, force: true });
});

describe("the weekly backfill", () => {
  test("scores the first-parent commit at each week boundary and skips weeks where the scope does not exist yet", async () => {
    const weekly = (scope: string) => manifest.scopes[scope]!.points.map(({ week, commit }) => `${week} ${commit.slice(0, 7)}`);
    const short = (name: string) => commits[name]!.slice(0, 7);

    expect(weekly("products/a")).toEqual([`2026-03-16 ${short("addsB")}`, `2026-03-23 ${short("trivial")}`, `2026-03-30 ${short("merge")}`]);
    expect(weekly("products/b")).toEqual([`2026-03-16 ${short("addsB")}`, `2026-03-23 ${short("trivial")}`, `2026-03-30 ${short("merge")}`]);
    expect(await readdir(join(dataDir, "products/a"))).toContain(`2026-03-26-${commits.merge!.slice(0, 12)}.json`);
  });

  test("a second run reuses every stored result instead of measuring again", async () => {
    const again = await backfill({ repository: repository.dir, ref: "main", scopes: ["products/a", "products/b"], weeks: 2, until: new Date("2026-03-30T00:00:00Z"), dataDir });

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
