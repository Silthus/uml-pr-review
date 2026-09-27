import { describe, expect, test } from "bun:test";
import { locateFix, type PullCommit } from "../../coherence/validation/corrections.ts";
import { diffLocalScore, type Findings } from "../../coherence/validation/diff-local.ts";

const commit = (sha: string, date: string, merge = false): PullCommit => ({ sha, parent: `${sha}^`, merge, date });
const touchingOnly = (...shas: string[]) => async ({ sha }: PullCommit) => shas.includes(sha);

describe("locating the commit that answers a review comment", () => {
  const commits = [commit("first", "2026-03-26T20:00:00Z"), commit("merge", "2026-03-26T22:00:00Z", true), commit("unrelated", "2026-03-26T23:00:00Z"), commit("fix", "2026-03-27T09:00:00Z"), commit("later", "2026-03-27T10:00:00Z")];

  test("picks the first non-merge commit after the comment that touches the commented area", async () => {
    const located = await locateFix(commits, "2026-03-26T21:28:38Z", touchingOnly("merge", "fix", "later"));

    expect(located).toEqual({ fix: commits[3], commentCommit: "first", isolable: true });
  });

  test("is not isolable when no commit from before the comment survives, as after a rebase", async () => {
    const located = await locateFix(commits.slice(2), "2026-03-26T21:28:38Z", touchingOnly("fix"));

    expect(located).toEqual({ fix: commits[3], commentCommit: undefined, isolable: false });
  });

  test("compares instants, not strings, when the commit carries a time zone offset", async () => {
    const offset = [commit("before", "2026-03-26T23:00:00+02:00"), commit("after", "2026-03-26T22:00:00Z")];

    expect(await locateFix(offset, "2026-03-26T21:28:38Z", touchingOnly("before", "after"))).toEqual({ fix: offset[1], commentCommit: "before", isolable: true });
  });

  test("finds nothing for a comment without a timestamp", async () => {
    expect(await locateFix(commits, null, touchingOnly("fix"))).toEqual({ fix: undefined, commentCommit: undefined, isolable: false });
  });
});

describe("the diff-local score", () => {
  const none: Findings = { lines: 100, functions: 5, overTen: 0, overTwenty: 0, lint: 0, typeEscapes: 0, markers: 0, bypasses: 0, cycleFiles: 0 };

  test("is positive when the changed files lose findings, weighting bypasses and very complex functions higher", () => {
    expect(diffLocalScore({ ...none, bypasses: 1, overTwenty: 1, lint: 2 }, none)).toBe(3 + 2 + 2);
  });

  test("ignores size, so only findings move it", () => {
    expect(diffLocalScore(none, { ...none, lines: 900, functions: 40 })).toBe(0);
  });
});
