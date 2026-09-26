import { expect, test } from "bun:test";
import type { ArchitecturePayload, ChangedFile } from "../../../src/architecture/contracts/index.ts";
import { checkConformance } from "../../../src/architecture/conformance/index.ts";
import { ArchitectureModel } from "../../../src/architecture/model/index.ts";
import { planOf } from "./plan-builder.ts";

const topLevel = 16;
const perParent = 20;
const filesPerLeaf = 6;
const importCount = 170_000;
const changedFileCount = 50;
const addedImportsPerChangedFile = 4;
const plannedElements = 20;
const plannedActions = ["modify", "create", "remove"] as const;
const seamActions = ["add", "keep", "remove"] as const;

test("a check of a PostHog-sized pair of payloads with 50 changed files and 20 planned modules and seams stays under 100 ms", () => {
  const files = syntheticFiles();
  const random = seededRandom(42);
  const basePairs = randomPairs(files.length, importCount, random);
  const changedFiles = Array.from({ length: changedFileCount }, (_, index) => index * 97);
  const headPairs = new Set(basePairs);
  for (const file of changedFiles) {
    for (let added = 0; added < addedImportsPerChangedFile; added++) headPairs.add(file * files.length + random(files.length));
  }
  const base = new ArchitectureModel(payloadOf(files, basePairs));
  const head = new ArchitectureModel(payloadOf(files, headPairs));
  const changes: ChangedFile[] = changedFiles.map((file) => ({ path: files[file]![0], status: "modified", firstChangedLine: 1 }));
  const plan = planOf({
    modules: Array.from({ length: plannedElements }, (_, index) => ({ path: `m${index % topLevel}/m${index}`, action: plannedActions[index % 3]! })),
    seams: Array.from({ length: plannedElements }, (_, index) => ({
      from: `m${index % topLevel}/m${index}`,
      to: `m${(index + 5) % topLevel}/m${index}`,
      action: seamActions[index % 3]!,
      interface: { files: [`m${(index + 5) % topLevel}/m${index}/m0/f0.py`], symbols: ["api"] },
    })),
  });

  const median = medianMilliseconds(() => checkConformance({ plan, base, head, changes, phase: "final" }));

  console.log(`checkConformance: ${files.length} files, ${head.payload.imports.length} imports, ${changes.length} changed files, median ${median.toFixed(2)} ms`);
  expect(base.payload.modules.length).toBeGreaterThan(6_500);
  expect(head.payload.imports.length).toBeGreaterThan(170_000);
  expect(median).toBeLessThan(100);
});

function syntheticFiles(): ArchitecturePayload["files"] {
  const files: ArchitecturePayload["files"] = [];
  let module = 0;
  for (let top = 0; top < topLevel; top++) {
    module++;
    for (let middle = 0; middle < perParent; middle++) {
      module++;
      for (let leaf = 0; leaf < perParent; leaf++) {
        module++;
        for (let file = 0; file < filesPerLeaf; file++) files.push([`m${top}/m${middle}/m${leaf}/f${file}.py`, module, "python", "production"]);
      }
    }
  }
  return files;
}

function payloadOf(files: ArchitecturePayload["files"], pairs: Set<number>): ArchitecturePayload {
  return {
    version: 1,
    repository: { id: "/synthetic/.git", root: "/synthetic", commonDir: "/synthetic/.git", name: "synthetic" },
    commit: null,
    tree: "synthetic",
    modules: syntheticModules(),
    files,
    imports: [...pairs].sort((a, b) => a - b).map((pair) => [Math.floor(pair / files.length), pair % files.length, "static", 1, ["api"]]),
    unresolved: [],
    stats: { files: files.length, imports: pairs.size, parsed: 0, cacheHits: 0, failed: 0, milliseconds: 0 },
  };
}

function syntheticModules(): ArchitecturePayload["modules"] {
  const modules: ArchitecturePayload["modules"] = [[".", ".", -1, "root", 0, 0]];
  for (let top = 0; top < topLevel; top++) {
    const topIndex = modules.push([`m${top}`, `m${top}`, 0, "directory", 0, 0]) - 1;
    for (let middle = 0; middle < perParent; middle++) {
      const middleIndex = modules.push([`m${top}/m${middle}`, `m${middle}`, topIndex, "directory", 0, 0]) - 1;
      for (let leaf = 0; leaf < perParent; leaf++) modules.push([`m${top}/m${middle}/m${leaf}`, `m${leaf}`, middleIndex, "directory", filesPerLeaf, filesPerLeaf]);
    }
  }
  return modules;
}

function randomPairs(fileCount: number, count: number, random: (limit: number) => number): Set<number> {
  const pairs = new Set<number>();
  while (pairs.size < count) {
    const from = random(fileCount);
    const to = random(fileCount);
    if (from !== to) pairs.add(from * fileCount + to);
  }
  return pairs;
}

function seededRandom(seed: number): (limit: number) => number {
  let state = seed;
  return (limit) => (state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0) % limit;
}

function medianMilliseconds(run: () => void): number {
  const timings = Array.from({ length: 11 }, () => {
    const started = performance.now();
    run();
    return performance.now() - started;
  }).sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)]!;
}
