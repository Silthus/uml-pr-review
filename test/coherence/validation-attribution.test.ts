import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attribute, type Attribution } from "../../coherence/validation/attribute.ts";
import { repositoryWithoutCommits, type Files, type TemporaryRepository } from "../architecture/index/repository.ts";

const toolTimeoutMs = 300_000;
const busyFunction = `def busy(value):\n${Array.from({ length: 24 }, (_, index) => `    if value == ${index}:\n        return ${index}\n`).join("")}    return -1\n`;
const productA: Files = {
  "products/__init__.py": "",
  "products/a/__init__.py": "",
  "products/a/backend/__init__.py": "",
  "products/a/backend/logic.py": "from products.a.backend.helpers import double\n\n\ndef compute(value):\n    return double(value) + 1\n",
  "products/a/backend/helpers.py": "def double(value):\n    return value * 2\n",
  "products/a/backend/test_logic.py": "from products.a.backend.logic import compute\n\n\ndef test_compute():\n    assert compute(1) == 3\n",
};

let repository: TemporaryRepository;
let reports: string;
let attributed: Attribution[];

beforeAll(async () => {
  repository = await repositoryWithoutCommits();
  reports = await mkdtemp(join(tmpdir(), "coherence-validation-reports-"));
  const commit = async (subject: string, date: string, files: Files) => {
    await repository.write(files);
    await repository.git("add", "--all");
    process.env.GIT_COMMITTER_DATE = date;
    try {
      await repository.git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", subject);
    } finally {
      delete process.env.GIT_COMMITTER_DATE;
    }
  };
  await commit("chore: seed (#1)", "2026-02-01T12:00:00Z", productA);
  await commit("feat(a): answer every value with a branch table (#7)", "2026-03-02T12:00:00Z", { "products/a/backend/busy.py": busyFunction });
  await commit("chore(b): unrelated product (#8)", "2026-03-03T12:00:00Z", { "products/b/backend/api.py": "def lookup():\n    return 1\n" });
  await commit("refactor(a): drop the branch table (#9)", "2026-03-04T12:00:00Z", { "products/a/backend/busy.py": null });
  ({ commits: attributed } = await attribute({ repository: repository.dir, ref: "main", since: "2026-03-01", scope: "products/a", reports, concurrency: 2 }));
}, toolTimeoutMs);

afterAll(async () => {
  await repository.cleanup();
  await rm(reports, { recursive: true, force: true });
});

describe("attributing index movement to pull requests", () => {
  test("scores every first-parent commit since the date that touches the scope, with its PR number and type", () => {
    expect(attributed.map(({ pr, type, title }) => [pr, type, title])).toEqual([
      [7, "feat", "feat(a): answer every value with a branch table"],
      [9, "refactor", "refactor(a): drop the branch table"],
    ]);
  });

  test("names the complex function a PR adds as the driver of its complexity drop", () => {
    const [adds] = attributed;

    expect(adds!.complexity.entered).toContain("products/a/backend/busy.py:busy (ccn 25)");
    expect(adds!.complexity.overTwenty).toBe(1);
    expect(adds!.delta.complexity).toBeLessThan(0);
    expect(adds!.lines.scopeMeasured).toEqual({ files: 1, added: 50, deleted: 0 });
  });

  test("a PR that restores the earlier tree moves every score back by exactly the same amount", () => {
    const [adds, removes] = attributed;

    expect(removes!.complexity.left).toEqual(adds!.complexity.entered);
    expect(Object.values(removes!.delta).map((change, index) => change + Object.values(adds!.delta)[index]!)).toEqual([0, 0, 0, 0, 0]);
    expect(adds!.delta.composite).toBeLessThan(0);
  });
});
