import { describe, expect, test } from "bun:test";
import { anglesOf, compositeOf, type AngleInputs } from "../lib/angles.ts";
import type { StaticQuality } from "../lib/static-quality.ts";
import type { TestAngle } from "../lib/test-angle.ts";

const verdict = {
  seams: { score: 8, justification: "" },
  cohesion: { score: 6, justification: "" },
  coupling: { score: 8, justification: "" },
  fit: { score: 6, justification: "" },
  overall: { score: 7, justification: "" },
};

const quality: StaticQuality = {
  complexity: { changedFunctions: 3, maxCcn: 12, meanCcn: 7, overTen: 1, ccnDelta: 9 },
  changedFunctions: [],
  duplication: { clones: 1, duplicatedLines: 8, percentage: 4 },
};

const tests: TestAngle = {
  testLinesAdded: 20,
  productionLinesAdded: 80,
  testRatio: 0.25,
  subjects: ["search", "Workflow"],
  unreferenced: ["Workflow"],
  referenceCoverage: 0.5,
  dynamic: { status: "not run", reason: "no services" },
};

const inputs: AngleInputs = {
  hygiene: 75,
  focusScore: 60,
  verdict,
  staticQuality: quality,
  ruffFindings: 2,
  tests,
  alignment: { modules: 0.5, files: 0.25 },
  process: {
    toolCalls: 10,
    edits: 2,
    toolCallsBeforeFirstEdit: 6,
    secondsBeforeFirstEdit: 30,
    architectureToolCalls: 3,
    architectureExplorationBeforeEdit: 3,
    architectureReasoningBeforeEdit: 1,
    firstArchitectureThought: null,
  },
};

describe("grading a run from several angles", () => {
  test("each angle follows its stated rubric", () => {
    expect(anglesOf(inputs)).toEqual({
      architecture: 70,
      astra: 70,
      jev: null,
      staticQuality: 61,
      tests: 50,
      alignment: 37.5,
      process: 75,
    });
  });

  test("a pytest run that did not happen is left out of the tests angle, never counted as a failure", () => {
    const passed = anglesOf({ ...inputs, tests: { ...tests, dynamic: { status: "passed", output: "" } } }).tests;
    const failed = anglesOf({ ...inputs, tests: { ...tests, dynamic: { status: "failed", output: "" } } }).tests;

    expect([passed, failed]).toEqual([66.7, 33.3]);
  });

  test("the composite rescales the weights over the angles a run has", () => {
    const angles = anglesOf(inputs);

    expect(compositeOf(angles)).toBe(Math.round(((25 * 70 + 20 * 70 + 10 * 61 + 15 * 50 + 10 * 37.5 + 5 * 75) / 85) * 10) / 10);
    expect(compositeOf({ ...angles, jev: 90 })).toBe(Math.round(((25 * 70 + 20 * 70 + 15 * 90 + 10 * 61 + 15 * 50 + 10 * 37.5 + 5 * 75) / 100) * 10) / 10);
    expect(compositeOf({ architecture: null, astra: null, jev: null, staticQuality: null, tests: null, alignment: null, process: null })).toBeNull();
  });
});
