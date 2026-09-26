import { describe, expect, test } from "bun:test";
import { differenceInDifferences, type Series } from "../../coherence/report/difference-in-differences.ts";

const weekly = (valueAt: (week: number) => number, weeks = 12): Series =>
  Array.from({ length: weeks }, (_, week) => ({ week: new Date(Date.UTC(2026, 0, 5 + 7 * week)).toISOString().slice(0, 10), value: valueAt(week) }));
const intervention = "2026-02-16";
const after = (week: number) => Math.max(0, week - 6);

describe("difference in differences", () => {
  test("attributes only the treated series' extra slope change, beyond what the controls also did, to the intervention", () => {
    const treated = weekly((week) => 50 + 2 * after(week));
    const steadyControl = weekly((week) => 40 + 0.5 * week);
    const shockedControl = weekly((week) => 60 + 1 * after(week));

    const result = differenceInDifferences({ treated, controls: [steadyControl, shockedControl], intervention });

    expect(result.treated).toEqual({ before: 0, after: 2, change: 2 });
    expect(result.controls).toEqual({ before: 0.25, after: 0.75, change: 0.5 });
    expect(result.effect).toBe(1.5);
    expect(result.points).toEqual({ before: 6, after: 6 });
  });

  test("refuses an intervention that leaves fewer than two points on either side", () => {
    const series = weekly(() => 50);

    expect(() => differenceInDifferences({ treated: series, controls: [series], intervention: "2026-01-06" })).toThrow("at least two points");
  });
});
