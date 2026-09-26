import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../src/git.ts";
import { repositoryWithChange, type CommittedRepository, type Files } from "../../test/support/repository.ts";
import { scoreTaskRuns, type TaskScores } from "../lib/score-task.ts";

const tach = `
[[modules]]
path = "ee"
depends_on = ["posthog", "products.workflows"]
layer = "modules"

[[modules]]
path = "posthog"
depends_on = []
layer = "modules"

[[modules]]
path = "products.workflows"
depends_on = ["posthog"]
layer = "modules"
`;

const base: Files = {
  "tach.toml": tach,
  "posthog/__init__.py": "",
  "ee/__init__.py": "",
  "ee/hogai/__init__.py": "",
  "ee/hogai/context.py": "def thing():\n    return 1\n",
  "ee/hogai/tools.py": "from products.workflows.backend.facade.api import search_workflows\n",
  "products/__init__.py": "",
  "products/workflows/__init__.py": "",
  "products/workflows/backend/__init__.py": "",
  "products/workflows/backend/models/__init__.py": "class HogFlow:\n    pass\n",
  "products/workflows/backend/facade/__init__.py": "",
  "products/workflows/backend/facade/api.py": "def search_workflows():\n    return []\n",
};

const armChanges: Record<string, Files> = {
  A: { "ee/hogai/context.py": "from products.workflows.backend.facade.api import search_workflows\n\ndef thing():\n    return search_workflows()\n" },
  "B-1": {
    "ee/hogai/context.py": "from products.workflows.backend.models import HogFlow\n\ndef thing():\n    return HogFlow()\n",
    "ee/hogai/test/test_context.py": "from ee.hogai.context import thing\nfrom products.workflows.backend.models import HogFlow\n\ndef test_thing():\n    assert thing()\n\ndef test_again():\n    assert thing()\n",
  },
  "C-1": { "products/workflows/backend/logic.py": "from ee.hogai.context import thing\nfrom ee.hogai.missing import nope\n\ndef run():\n    return thing(), nope\n" },
};

let repository: CommittedRepository;
let taskDir: string;
let scores: TaskScores;

beforeAll(async () => {
  repository = await repositoryWithChange(base, { "README.md": "bench\n" });
  taskDir = await mkdtemp(join(tmpdir(), "bench-score-"));
  await Bun.write(join(taskDir, "task.json"), JSON.stringify(task(repository.base)));
  for (const [arm, files] of Object.entries(armChanges)) await writeArmDiff(arm, files);
  scores = await scoreTaskRuns(taskDir, { repository: repository.dir });
}, 60_000);

afterAll(async () => {
  await repository.cleanup();
  await rm(taskDir, { recursive: true, force: true });
});

describe("scoring arm diffs against the base tree", () => {
  test("an import of another product's models from outside it is a facade bypass, counted apart when it comes from a test", () => {
    const boundary = scores.arms["B-1"]!.boundary!;
    expect(boundary.facadeBypasses).toEqual([{ from: "ee/hogai/context.py", to: "products/workflows/backend/models/__init__.py" }]);
    expect(boundary.testFacadeBypasses).toEqual([{ from: "ee/hogai/test/test_context.py", to: "products/workflows/backend/models/__init__.py" }]);
    expect(scores.arms["B-1"]!.hygiene).toBe(75);
  });

  test("an import through the product's facade is not a bypass", () => {
    expect(scores.arms.A!.boundary!.facadeBypasses).toEqual([]);
    expect(scores.arms.A!.hygiene).toBe(100);
  });

  test("a new undeclared dependency that closes a module cycle and an unresolved import are all counted", () => {
    const boundary = scores.arms["C-1"]!.boundary!;
    expect(boundary.newCrossProductDependencies).toEqual([{ from: "products.workflows", to: "ee", declared: false }]);
    expect(boundary.newCycles).toEqual([{ from: "products.workflows", to: "ee" }]);
    expect(boundary.newUnresolvedImports).toEqual([{ file: "products/workflows/backend/logic.py", specifier: "ee.hogai.missing" }]);
    expect(scores.arms["C-1"]!.hygiene).toBe(40);
  });

  test("focus counts the change's files, lines, and added tests", () => {
    expect(scores.arms["B-1"]!.focus).toMatchObject({ filesChanged: 2, linesAdded: 11, linesRemoved: 1, testsAdded: 2 });
  });

  test("the scores are written next to the runs", async () => {
    expect(await Bun.file(join(taskDir, "scores.json")).json()).toEqual(JSON.parse(JSON.stringify(scores)));
  });
});

function task(baseCommit: string) {
  return { pr: 1, title: "Search workflows", session: { source: "t3", id: "thread" }, baseCommit, finalHead: baseCommit, taskStatement: "Let the agent search workflows.", attachments: [] };
}

async function writeArmDiff(arm: string, files: Files) {
  const worktree = join(taskDir, `${arm}-worktree`);
  await git(repository.dir, ["worktree", "add", "--detach", "--quiet", worktree, repository.base]);
  for (const [path, content] of Object.entries(files)) await Bun.write(join(worktree, path), content ?? "");
  await git(worktree, ["add", "--all", "--intent-to-add"]);
  const diff = await git(worktree, ["diff", repository.base]);
  await git(repository.dir, ["worktree", "remove", "--force", worktree]);
  await mkdir(join(taskDir, arm), { recursive: true });
  await Bun.write(join(taskDir, arm, "diff.patch"), diff);
}
