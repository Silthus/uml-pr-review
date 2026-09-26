import { describe, expect, test } from "bun:test";
import { armAReference } from "../lib/arm-a-reference.ts";
import { TaskSchema } from "../lib/task.ts";

const task = (extra: Record<string, unknown>) =>
  TaskSchema.parse({ pr: 1, title: "Task", session: { source: "t3" }, baseCommit: "base0000", finalHead: "head0000", taskStatement: "Do it.", ...extra });

describe("the reference arm A is scored on", () => {
  test("is the original agent's own answer when the task records one", () => {
    const reference = armAReference(task({ sessionAnswerDiff: { base: "base0000", head: "answer00" }, diffStat: { base: "rebase00", head: "head0000" } }));

    expect(reference).toEqual({ kind: "session-answer", base: "base0000", head: "answer00" });
  });

  test("is the pull request from its rebase point when the branch was rebased onto a newer base", () => {
    expect(armAReference(task({ diffStat: { base: "rebase00", head: "head0000" } }))).toEqual({ kind: "rebased-pr", base: "rebase00", head: "head0000" });
  });

  test("is the pull request from the task's base otherwise", () => {
    expect(armAReference(task({ diffStat: { base: "base0000", head: "head0000" } }))).toEqual({ kind: "pull-request", base: "base0000", head: "head0000" });
    expect(armAReference(task({}))).toEqual({ kind: "pull-request", base: "base0000", head: "head0000" });
  });
});
