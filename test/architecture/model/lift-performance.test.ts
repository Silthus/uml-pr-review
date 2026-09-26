import { expect, test } from "bun:test";
import type { ArchitecturePayload } from "../../../src/architecture/contracts/index.ts";
import { ArchitectureModel } from "../../../src/architecture/model/index.ts";

const topLevel = 16;
const perParent = 20;
const filesPerLeaf = 6;
const importCount = 170_000;

const payload = syntheticPayload();
const model = new ArchitectureModel(payload);

test.each([
  { view: "one product opened", expanded: ["m3", "m3/m7"], bound: 25 },
  { view: "every top-level module opened", expanded: [...Array.from({ length: topLevel }, (_, top) => `m${top}`), "m3/m7"], bound: 50 },
])("lift over a PostHog-sized payload with $view stays within a few milliseconds", ({ view, expanded, bound }) => {
  const median = medianMilliseconds(() => model.lift(new Set(expanded)));

  console.log(`lift, ${view}: ${payload.modules.length} modules, ${payload.imports.length} imports, median ${median.toFixed(2)} ms`);
  expect(payload.modules.length).toBeGreaterThan(6_500);
  expect(payload.imports.length).toBeGreaterThan(165_000);
  expect(median).toBeLessThan(bound);
});

function medianMilliseconds(run: () => void): number {
  const timings = Array.from({ length: 31 }, () => {
    const started = performance.now();
    run();
    return performance.now() - started;
  }).sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)]!;
}

function syntheticPayload(): ArchitecturePayload {
  const modules: ArchitecturePayload["modules"] = [[".", ".", -1, "root", 0, 0]];
  const files: ArchitecturePayload["files"] = [];
  for (let top = 0; top < topLevel; top++) {
    const topIndex = modules.push([`m${top}`, `m${top}`, 0, "directory", 0, 0]) - 1;
    for (let middle = 0; middle < perParent; middle++) {
      const middlePath = `m${top}/m${middle}`;
      const middleIndex = modules.push([middlePath, `m${middle}`, topIndex, "directory", 0, 0]) - 1;
      for (let leaf = 0; leaf < perParent; leaf++) {
        const leafPath = `${middlePath}/m${leaf}`;
        const leafIndex = modules.push([leafPath, `m${leaf}`, middleIndex, "directory", filesPerLeaf, filesPerLeaf]) - 1;
        for (let file = 0; file < filesPerLeaf; file++) files.push([`${leafPath}/f${file}.py`, leafIndex, "python", "production"]);
      }
    }
  }
  return {
    version: 1,
    repository: { id: "/synthetic/.git", root: "/synthetic", commonDir: "/synthetic/.git", name: "synthetic" },
    commit: null,
    tree: "synthetic",
    modules,
    files,
    imports: randomImports(files.length),
    unresolved: [],
    stats: { files: files.length, imports: importCount, parsed: 0, cacheHits: 0, failed: 0, milliseconds: 0 },
  };
}

function randomImports(fileCount: number): ArchitecturePayload["imports"] {
  let seed = 42;
  const next = () => (seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0) % fileCount;
  const pairs = new Set<number>();
  while (pairs.size < importCount) {
    const from = next();
    const to = next();
    if (from !== to) pairs.add(from * fileCount + to);
  }
  return [...pairs]
    .sort((a, b) => a - b)
    .map((pair) => [Math.floor(pair / fileCount), pair % fileCount, "static", 1, []]);
}
