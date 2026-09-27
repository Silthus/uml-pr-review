import { describe, expect, test } from "bun:test";
import { matchedLineThreshold, outcomeOf, productionFileFlags, type ScoredCase } from "../../benchmark/grader/evaluation/metrics.ts";
import type { StoredGrade } from "../../benchmark/grader/evaluation/store.ts";
import type { Violation } from "../../benchmark/grader/violations.ts";

function violation(file: string, line: number): Violation {
  return { detector: "complexity", rule: "ccn-over-10", file, line, subject: "run", message: "run is complex" };
}

function stored(files: [string, number][], introduced: Violation[] = [], removed: Violation[] = []): StoredGrade {
  return { base: "a", head: "b", files: files.map(([path, addedLines]) => ({ path, addedLines })), grade: 0, seconds: 1, detectors: { complexity: { introduced, removed } } };
}

function scored(reviewed: StoredGrade, fixed: StoredGrade): ScoredCase {
  return { id: "gh:1:2", subtype: "split-merge", path: "app/rules.py", line: 40, verified: true, reviewed, fixed };
}

describe("a correction's outcome", () => {
  test("counts a flag only in the commented file, near only within 20 lines, and fixed only when the fix removes a violation there", () => {
    const outcome = outcomeOf(
      scored(stored([["app/rules.py", 120], ["app/other.py", 10]], [violation("app/rules.py", 55), violation("app/other.py", 40)]), stored([["app/rules.py", 3]], [], [violation("app/rules.py", 55)])),
      ["complexity"],
    );
    expect([...outcome.flagged]).toEqual(["complexity"]);
    expect([...outcome.near]).toEqual(["complexity"]);
    expect([...outcome.fixed]).toEqual(["complexity"]);
    expect(outcome.addedLines).toBe(120);

    const elsewhere = outcomeOf(scored(stored([["app/rules.py", 120]], [violation("app/other.py", 40)]), stored([])), ["complexity"]);
    expect(elsewhere.flagged.size).toBe(0);

    const far = outcomeOf(scored(stored([["app/rules.py", 120]], [violation("app/rules.py", 61)]), stored([])), ["complexity"]);
    expect([...far.flagged]).toEqual(["complexity"]);
    expect(far.near.size).toBe(0);
    expect(far.fixed.size).toBe(0);
  });
});

describe("the size baseline", () => {
  test("its threshold flags the same share of clean production files as the grader, and ignores tests", () => {
    const clean = [stored([["app/a.py", 500], ["app/b.py", 200], ["app/c.py", 50], ["app/d.py", 10], ["app/tests/test_a.py", 900]], [violation("app/c.py", 1)])];
    const flags = productionFileFlags(clean, ["complexity"]);
    expect(flags.flagged).toEqual([false, false, true, false]);
    const threshold = matchedLineThreshold(flags.addedLines, 0.25);
    expect(flags.addedLines.filter((added) => added > threshold)).toHaveLength(1);
  });
});
