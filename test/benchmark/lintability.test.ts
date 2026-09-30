import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CorpusRow } from "../../benchmark/corrections/corpus.ts";
import { type LintabilityWorkspace, preparePackets, status, writeResults } from "../../benchmark/lintability/pipeline.ts";
import type { Sources } from "../../benchmark/lintability/sources.ts";

let directory: string;
let workspace: LintabilityWorkspace;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "lintability-"));
  workspace = { corpus: join(directory, "corpus.jsonl"), work: join(directory, "work"), docs: join(directory, "docs") };
});

afterEach(() => rm(directory, { recursive: true, force: true }));

function row(id: string, path: string, overrides: Partial<CorpusRow> = {}): CorpusRow {
  const pr = Number(id.split(":")[1]);
  return {
    id,
    pr,
    prUrl: `https://github.com/PostHog/posthog/pull/${pr}`,
    commentUrl: `https://github.com/PostHog/posthog/pull/${pr}#discussion_r${id.split(":")[2]}`,
    reviewer: "reviewer",
    mergedAt: "2026-07-01T00:00:00Z",
    commentedAt: "2026-06-30T00:00:00Z",
    path,
    line: 3,
    product: "workflows",
    subtype: "reuse",
    quote: `quote of ${id}`,
    commentCommit: `comment${pr}`,
    before: `before${pr}`,
    fix: `fix${pr}`,
    fixUrl: `https://github.com/PostHog/posthog/pull/${pr}/commits/fix${pr}`,
    isolable: true,
    verified: null,
    split: "development",
    ...overrides,
  };
}

const fakeSources: Sources = async (corpusRow) => ({
  body: `full comment on ${corpusRow.path}`,
  diff: `-old ${corpusRow.id}\n+new ${corpusRow.id}`,
  stat: corpusRow.pr === 6 ? { files: 1, added: 1, removed: 1 } : { files: 2, added: 10, removed: 4 },
  base: `base${corpusRow.pr}`,
});

async function writeCorpus(rows: CorpusRow[]) {
  await writeFile(workspace.corpus, rows.map((each) => `${JSON.stringify(each)}\n`).join(""));
}

async function writeLabels(stage: string, file: string, labels: object[]) {
  await mkdir(join(workspace.work, "labels", stage), { recursive: true });
  await writeFile(join(workspace.work, "labels", stage, file), JSON.stringify(labels));
}

async function packets(): Promise<Record<string, string>> {
  const names = (await readdir(join(workspace.work, "packets"))).sort();
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(join(workspace.work, "packets", name), "utf8")] as const)));
}

const passing = { general: "pass", existed: "pass", syntactic: "pass", firesAndClears: "pass" };

function caught(id: string, ruleKind: string, tool: string, ruleSketch: string, catchable = "yes") {
  return { id, catchable, ruleKind, tier: "lintable-now", tool, ruleSketch, guards: passing, note: "routes the call through the existing helper" };
}

function reviewOnly(id: string, ruleKind: string, failed: keyof typeof passing, ruleSketch = "") {
  return { id, catchable: "no", ruleKind, tier: "not-lintable", tool: "review-only", ruleSketch, guards: { ...passing, existed: "n/a", [failed]: "fail" }, note: "needs judgment about where the logic belongs" };
}

describe("labelling packets", () => {
  test("cover only development corrections with an isolable fix that still lack a label, so a stopped run resumes where it left off", async () => {
    await writeCorpus([
      row("gh:1:11", "products/workflows/frontend/workflowLogic.ts"),
      row("gh:2:22", "products/workflows/backend/api.py"),
      row("gh:3:33", "rust/feature-flags/src/lib.rs"),
      row("gh:4:44", "products/workflows/backend/models.py", { split: "heldout" }),
      row("gh:5:55", "products/workflows/backend/views.py", { isolable: false }),
    ]);

    await preparePackets(workspace, "label", fakeSources);
    const [first] = Object.values(await packets());
    expect(first).toContain('<entry id="gh:1:11">');
    expect(first).toContain("full comment on products/workflows/frontend/workflowLogic.ts");
    expect(first).toContain("+new gh:3:33");
    expect(first).toContain("base: base1");
    expect(first).not.toContain("gh:4:44");
    expect(first).not.toContain("gh:5:55");

    await writeLabels("label", "label-r1-001.json", [caught("gh:1:11", "paved-path", "oxlint", "ban fetch() in *Logic.ts; use api.*"), reviewOnly("gh:2:22", "logic-placement", "general")]);
    expect(await status(workspace)).toContain("label: 2/3 labelled, missing gh:3:33");

    await preparePackets(workspace, "label", fakeSources);
    const resumed = await packets();
    expect(Object.keys(resumed)).toEqual(["label-r1-001.md", "label-r2-001.md"]);
    expect(resumed["label-r2-001.md"]).toContain('<entry id="gh:3:33">');
    expect(resumed["label-r2-001.md"]).not.toContain("gh:1:11");
  });

  test("refuse a label that claims a catch while one of its honesty guards failed", async () => {
    await writeCorpus([row("gh:1:11", "products/workflows/frontend/workflowLogic.ts")]);
    await writeLabels("label", "label-r1-001.json", [{ ...caught("gh:1:11", "paved-path", "oxlint", "ban fetch() in *Logic.ts; use api.*"), guards: { ...passing, existed: "fail" } }]);

    await expect(status(workspace)).rejects.toThrow("gh:1:11");
  });

  test("let a recheck of the caught corrections override their first label", async () => {
    await writeCorpus([row("gh:1:11", "products/workflows/frontend/workflowLogic.ts"), row("gh:2:22", "products/workflows/backend/api.py")]);
    await writeLabels("label", "label-r1-001.json", [caught("gh:1:11", "paved-path", "oxlint", "ban fetch() in *Logic.ts; use api.*"), reviewOnly("gh:2:22", "logic-placement", "general")]);

    await preparePackets(workspace, "recheck", fakeSources);
    const [recheck] = Object.values(await packets());
    expect(recheck).toContain('<entry id="gh:1:11">');
    expect(recheck).not.toContain("gh:2:22");

    await writeLabels("recheck", "recheck-r1-001.json", [{ ...reviewOnly("gh:1:11", "reuse-unnamed", "existed", "ban fetch() in *Logic.ts; use api.*"), guards: { ...passing, existed: "fail" } }]);
    await writeResults(workspace, fakeSources);

    const [first] = (await readFile(join(workspace.docs, "labels.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(first).toMatchObject({ id: "gh:1:11", catchable: "no", failedGuards: ["existed"] });
  });
});

describe("results", () => {
  const corpus = [
    row("gh:1:11", "products/workflows/frontend/workflowLogic.ts", { subtype: "reuse" }),
    row("gh:2:22", "products/workflows/backend/api.py", { subtype: "facade-boundary" }),
    row("gh:3:33", "posthog/api/insight.py", { subtype: "layer" }),
    row("gh:4:44", "rust/feature-flags/src/lib.rs", { subtype: "dependency" }),
    row("gh:5:55", ".github/workflows/ci.yml", { subtype: "naming" }),
    row("gh:6:66", "frontend/src/scenes/dashboard/Dashboard.tsx", { subtype: "reuse" }),
  ];
  const primary = [
    caught("gh:1:11", "paved-path", "oxlint", "ban fetch() in frontend logics; use api.*"),
    caught("gh:2:22", "public-entry", "tach", "products.workflows is reachable only through backend.facade"),
    reviewOnly("gh:3:33", "logic-placement", "general", "posthog/api may not hold insight query logic"),
    caught("gh:4:44", "banned-api", "clippy", "ban reqwest::blocking in rust/feature-flags", "partial"),
    reviewOnly("gh:5:55", "concept-naming", "syntactic"),
    caught("gh:6:66", "paved-path", "oxlint", "use LemonButton, not <button>"),
  ];
  const second = [caught("gh:1:11", "paved-path", "oxlint", "ban raw fetch"), reviewOnly("gh:2:22", "design-other", "existed"), reviewOnly("gh:3:33", "logic-placement", "general")];
  const rules = [
    { id: "gh:1:11", rule: "Frontend logics call the API only through api.*" },
    { id: "gh:2:22", rule: "Products are reachable only through their facade" },
    { id: "gh:4:44", rule: "No blocking HTTP clients in async services" },
    { id: "gh:6:66", rule: "Frontend logics call the API only through api.*" },
  ];

  async function labelEverything() {
    await writeCorpus(corpus);
    await writeLabels("label", "label-r1-001.json", primary);
    await writeLabels("agreement", "agreement-r1-001.json", second);
    await writeLabels("rules", "rules-r1-001.json", rules);
  }

  test("write one labelled row per development correction, joined with its corpus fields and guards", async () => {
    await labelEverything();

    await writeResults(workspace, fakeSources);

    const rows = (await readFile(join(workspace.docs, "labels.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ id: "gh:1:11", language: "TypeScript/JavaScript", subtype: "reuse", catchable: "yes", ruleKind: "paved-path", tool: "oxlint", rule: "Frontend logics call the API only through api.*", failedGuards: [] });
    expect(rows[2]).toMatchObject({ id: "gh:3:33", language: "Python", catchable: "no", tool: "review-only", rule: null, failedGuards: ["general"] });
    expect(rows[3]).toMatchObject({ language: "Rust", catchable: "partial" });
    expect(rows[4]).toMatchObject({ language: "other" });
  });

  test("report the coverage overall, for the first slice, and the agreement between labellers", async () => {
    await labelEverything();

    await writeResults(workspace, fakeSources);

    const report = await readFile(join(workspace.docs, "report.md"), "utf8");
    expect(report).toContain("**3 of 6 development corrections (50.0%)** are catchable at write time, and 1 more (16.7%) partly");
    expect(report).toContain("the first slice catches **3 of 6 (50.0%)**, which is 3 of the 4 TypeScript and Python corrections (75.0%)");
    expect(report).toContain("| Python | 2 | 1 | 0 | 50.0% |");
    expect(report).toContain("| Rust | 1 | 0 | 1 | 0.0% |");
    expect(report).toContain("Cohen's kappa on `catchable` is **0.40** over 3 rows (raw agreement 66.7%)");
    expect(report).toContain("| 1 | Frontend logics call the API only through api.* | 2 | 0 | 2 | oxlint |");
    expect(report).toContain("| 2 | Products are reachable only through their facade | 1 | 0 | 1 | tach |");
    expect(report).toContain("| 3 | No blocking HTTP clients in async services | 0 | 1 | 1 | clippy |");
  });

  test("count failed guards only for corrections where a candidate rule was tried", async () => {
    await labelEverything();

    await writeResults(workspace, fakeSources);

    const report = await readFile(join(workspace.docs, "report.md"), "utf8");
    expect(report).toContain("Of the 2 corrections that stay in review, 1 had no candidate rule at all");
    expect(report).toContain("| general | 1 |");
    expect(report).toContain("| syntactic | 0 |");
  });

  test("list replay candidates from caught TypeScript and Python corrections, preferred areas first", async () => {
    await labelEverything();

    await writeResults(workspace, fakeSources);

    const report = await readFile(join(workspace.docs, "report.md"), "utf8");
    const replay = report.slice(report.indexOf("## Replay candidates"));
    expect(replay).toContain("[#1](https://github.com/PostHog/posthog/pull/1)");
    expect(replay).toContain("[#2](https://github.com/PostHog/posthog/pull/2)");
    expect(replay).toContain("`before1`");
    expect(replay).toContain("2 files, +10/−4");
    expect(replay).not.toContain("pull/4)");
    expect(replay.indexOf("pull/1)")).toBeLessThan(replay.indexOf("pull/6)"));
  });
});
