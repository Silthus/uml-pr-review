import { describe, expect, test } from "bun:test";
import { cachedClient, diffQuestions, gradeDiff, productionFileQuestions, testFileQuestions, type JevAnswer, type JevClient, type Questions } from "../lib/jev.ts";
import { parsePatch } from "../lib/patch.ts";

const patch = [
  "diff --git a/products/workflows/backend/facade/api.py b/products/workflows/backend/facade/api.py",
  "--- a/products/workflows/backend/facade/api.py",
  "+++ b/products/workflows/backend/facade/api.py",
  "@@ -2,1 +2,2 @@",
  " import x",
  "+def search(): return []",
  "diff --git a/products/workflows/backend/test/test_api.py b/products/workflows/backend/test/test_api.py",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/products/workflows/backend/test/test_api.py",
  "@@ -0,0 +1,1 @@",
  "+def test_search(): assert search() == []",
  "",
].join("\n");

const contents: Record<string, string> = {
  "products/workflows/backend/facade/api.py": "from y import z\nimport x\ndef search(): return []\n",
  "products/workflows/backend/test/test_api.py": "def test_search(): assert search() == []\n",
};

class FakeJev implements JevClient {
  readonly states: unknown[] = [];

  async evaluate(state: unknown, questions: Questions): Promise<Record<string, JevAnswer>> {
    this.states.push(state);
    return Object.fromEntries(
      Object.entries(questions).map(([id, question]): [string, JevAnswer] => [id, question.type === "boolean" ? { type: "boolean", probability: 0.8 } : { type: "score", score: 2 }]),
    );
  }
}

describe("grading a diff with Jev", () => {
  test("asks the file, test, and diff questions and grades booleans by probability and scores by level", async () => {
    const jev = new FakeJev();

    const grade = await gradeDiff(jev, "Search workflows.", patch, parsePatch(patch), async (path) => contents[path]!);

    expect(grade.files).toEqual([{ subject: "products/workflows/backend/facade/api.py", answers: { readability: 0.67, singleResponsibility: 0.8, namingClarity: 0.67, errorHandling: 0.67, idiomaticFit: 0.67 } }]);
    expect(grade.tests.map(({ answers }) => answers)).toEqual([{ assertsBehaviour: 0.8, edgeCases: 0.67 }]);
    expect(Object.keys(grade.diff.answers)).toEqual(Object.keys(diffQuestions));
    expect(grade.fileQuality).toBe(69.6);
    expect(jev.states[0]).toMatchObject({ path: "products/workflows/backend/facade/api.py", context: { fromLine: 1, code: contents["products/workflows/backend/facade/api.py"] } });
  });

  test("answers the same input from the cache without calling Jev again", async () => {
    const jev = new FakeJev();
    const cache = new Map<string, Record<string, JevAnswer>>();
    const client = cachedClient(jev, cache);

    const first = await client.evaluate({ file: "a" }, productionFileQuestions);
    const second = await client.evaluate({ file: "a" }, productionFileQuestions);
    await client.evaluate({ file: "a" }, testFileQuestions);

    expect(second).toEqual(first);
    expect(jev.states).toHaveLength(2);
    expect(cache.size).toBe(2);
  });
});
