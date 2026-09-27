import { describe, expect, test } from "bun:test";
import { cohenKappa, spearman, stratifiedSample } from "../../coherence/validation/statistics.ts";

describe("agreement statistics", () => {
  test("Cohen's kappa corrects the observed agreement for the agreement the marginals predict", () => {
    const first = ["+", "+", "-", "0", "+", "-"];
    const second = ["+", "0", "-", "0", "+", "+"];

    expect(cohenKappa(first, second)).toBeCloseTo(11 / 23, 10);
    expect(cohenKappa(first, first)).toBe(1);
  });

  test("Cohen's kappa is undefined when both raters only ever use one category", () => {
    expect(cohenKappa(["0", "0"], ["0", "0"])).toBeNull();
  });

  test("Spearman ranks ties by their average rank", () => {
    expect(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])).toBeCloseTo(8 / Math.sqrt(95), 10);
    expect(spearman([1, 2, 3], [30, 20, 10])).toBeCloseTo(-1, 10);
  });

  test("Spearman is undefined when one side does not vary", () => {
    expect(spearman([1, 2, 3], [4, 4, 4])).toBeNull();
  });
});

describe("the stratified sample", () => {
  const items = [...Array.from({ length: 60 }, (_, index) => ({ id: index, stratum: "feat" })), ...Array.from({ length: 30 }, (_, index) => ({ id: 100 + index, stratum: "fix" })), ...Array.from({ length: 10 }, (_, index) => ({ id: 200 + index, stratum: "chore" }))];

  test("draws from each stratum in proportion to its size", () => {
    const sample = stratifiedSample(items, ({ stratum }) => stratum, 20, 94);
    const counts = Object.groupBy(sample, ({ stratum }) => stratum);

    expect(sample).toHaveLength(20);
    expect([counts.feat?.length, counts.fix?.length, counts.chore?.length]).toEqual([12, 6, 2]);
    expect(new Set(sample.map(({ id }) => id)).size).toBe(20);
  });

  test("is the same for the same seed and different for another", () => {
    const ids = (seed: number) => stratifiedSample(items, ({ stratum }) => stratum, 20, seed).map(({ id }) => id);

    expect(ids(94)).toEqual(ids(94));
    expect(ids(94)).not.toEqual(ids(95));
  });

  test("returns every item when the sample is at least the population", () => {
    expect(stratifiedSample(items.slice(0, 5), ({ stratum }) => stratum, 40, 94)).toHaveLength(5);
  });
});
