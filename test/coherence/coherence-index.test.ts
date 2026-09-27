import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoherenceReportSchema, type CoherenceIndex } from "../../coherence/contract.ts";
import { measureCoherence } from "../../coherence/measure.ts";
import { temporaryRepository, type Files, type TemporaryRepository } from "../architecture/index/repository.ts";

const toolTimeoutMs = 120_000;
const scope = "products/a";

const product: Files = {
  "products/__init__.py": "",
  "products/a/__init__.py": "",
  "products/a/backend/__init__.py": "",
  "products/a/backend/facade/__init__.py": "",
  "products/a/backend/facade/api.py": "from products.a.backend.logic import compute\n\n\ndef run(value):\n    return compute(value)\n\n\ndef stop(value):\n    return value\n",
  "products/a/backend/logic.py": "from products.a.backend.helpers import double\n\n\ndef compute(value):\n    return double(value) + 1\n",
  "products/a/backend/helpers.py": "def double(value):\n    return value * 2\n",
  "products/a/backend/limits.py": "LIMIT = 3\n",
  "products/a/backend/test/__init__.py": "",
  "products/a/backend/test/test_api.py": "from products.a.backend.facade.api import run\n\n\ndef test_run():\n    assert run(1) == 3\n",
  "products/a/frontend/view.tsx": "export function View({ count }: { count: number }): string {\n  return count > 1 ? 'many' : 'one';\n}\n",
  "products/b/__init__.py": "",
  "products/b/backend/__init__.py": "",
  "products/b/backend/facade/__init__.py": "",
  "products/b/backend/facade/api.py": "def lookup():\n    return 1\n",
  "products/b/backend/consumer.py": "from products.a.backend.logic import compute\n\n\ndef consume():\n    return compute(2)\n",
};

const busyFunction = `def busy(value):\n${Array.from({ length: 24 }, (_, index) => `    if value == ${index}:\n        return ${index}\n`).join("")}    return -1\n`;
const duplicatedBlock = `def first(rows):\n${Array.from({ length: 12 }, (_, index) => `    rows.append({"name": "row", "index": ${index}, "enabled": True})\n`).join("")}    return rows\n`;
const facadeFunctions = (names: string[]) => names.map((name) => `def ${name}(value):\n    return value\n`).join("\n\n");
const helpersImporting =(line: string) => `${line}\n\n\ndef double(value):\n    return value * 2\n`;

let repository: TemporaryRepository;
let base: string;
const measured = new Map<string, CoherenceIndex>();

async function variant(changes: Files): Promise<string> {
  const commit = await repository.commit(changes);
  await repository.git("reset", "--quiet", "--hard", base);
  return commit;
}

async function indexAt(commit: string, scopePath = scope): Promise<CoherenceIndex> {
  const key = `${commit}:${scopePath}`;
  const known = measured.get(key);
  if (known) return known;
  const { index } = await measureCoherence({ repository: repository.dir, scope: scopePath, commit });
  measured.set(key, index);
  return index;
}

beforeAll(async () => {
  repository = await temporaryRepository(product);
  base = (await repository.git("rev-parse", "HEAD")).trim();
});

afterAll(() => repository.cleanup());

describe("architecture", () => {
  test(
    "a new internal import raises propagation cost and lowers the architecture score",
    async () => {
      const before = await indexAt(base);
      const after = await indexAt(await variant({ "products/a/backend/helpers.py": helpersImporting("from products.a.backend.limits import LIMIT") }));

      expect(after.dimensions.architecture.propagationCost.value).toBeGreaterThan(before.dimensions.architecture.propagationCost.value);
      expect(after.dimensions.architecture.cycles.count).toBe(0);
      expect(after.dimensions.architecture.score).toBeLessThan(before.dimensions.architecture.score!);
    },
    toolTimeoutMs,
  );

  test(
    "a dependency cycle lowers the cycle score and names the files on it",
    async () => {
      const before = await indexAt(base);
      const after = await indexAt(await variant({ "products/a/backend/helpers.py": helpersImporting("from products.a.backend import logic") }));

      expect(before.dimensions.architecture.cycles).toEqual({ count: 0, files: [] });
      expect(after.dimensions.architecture.cycles).toEqual({ count: 1, files: ["products/a/backend/helpers.py", "products/a/backend/logic.py"] });
      expect(after.dimensions.architecture.measures.cycleShare!.score).toBeLessThan(before.dimensions.architecture.measures.cycleShare!.score!);
      expect(after.composite.score).toBeLessThan(before.composite.score);
    },
    toolTimeoutMs,
  );

  test(
    "a type-only back-edge does not form a cycle",
    async () => {
      const typeOnly = await indexAt(
        await variant({ "products/a/backend/helpers.py": helpersImporting("from typing import TYPE_CHECKING\n\nif TYPE_CHECKING:\n    from products.a.backend import logic") }),
      );

      expect(typeOnly.dimensions.architecture.cycles).toEqual({ count: 0, files: [] });
    },
    toolTimeoutMs,
  );

  test(
    "routing an inbound cross-product import through the facade removes its bypass and raises the architecture score",
    async () => {
      const before = await indexAt(base);
      const after = await indexAt(await variant({ "products/b/backend/consumer.py": "from products.a.backend.facade.api import run\n\n\ndef consume():\n    return run(2)\n" }));

      expect(before.dimensions.architecture.facade).toMatchObject({
        crossings: 1,
        share: 0,
        inbound: { crossings: 1, bypasses: 1 },
        bypasses: [{ from: "products/b/backend/consumer.py", to: "products/a/backend/logic.py", direction: "inbound" }],
      });
      expect(after.dimensions.architecture.facade).toMatchObject({ crossings: 1, share: 1, bypasses: [] });
      expect(after.dimensions.architecture.score).toBeGreaterThan(before.dimensions.architecture.score!);
    },
    toolTimeoutMs,
  );

  test(
    "an outbound import is a bypass unless it goes through the other product's facade",
    async () => {
      const bypassing = await indexAt(await variant({ "products/a/backend/helpers.py": helpersImporting("from products.b.backend.consumer import consume") }));
      const throughFacade = await indexAt(await variant({ "products/a/backend/helpers.py": helpersImporting("from products.b.backend.facade.api import lookup") }));

      expect(bypassing.dimensions.architecture.facade).toMatchObject({ crossings: 2, share: 0, outbound: { crossings: 1, bypasses: 1 } });
      expect(throughFacade.dimensions.architecture.facade).toMatchObject({ crossings: 2, share: 0.5, outbound: { crossings: 1, bypasses: 0 } });
      expect(throughFacade.dimensions.architecture.score).toBeGreaterThan(bypassing.dimensions.architecture.score!);
    },
    toolTimeoutMs,
  );

  test(
    "every facade bypass costs the same, however many bypasses and compliant crossings the scope already has",
    async () => {
      const bypass = (file: string) => ({ [`products/b/backend/${file}.py`]: "from products.a.backend.helpers import double\n\n\ndef use():\n    return double(2)\n" });
      const compliant = (file: string) => ({ [`products/b/backend/${file}.py`]: "from products.a.backend.facade.api import run\n\n\ndef use():\n    return run(2)\n" });
      const none = await indexAt(await variant({ "products/b/backend/consumer.py": null }));
      const one = await indexAt(base);
      const two = await indexAt(await variant(bypass("second")));
      const twoAmongCompliant = await indexAt(await variant({ ...bypass("second"), ...compliant("third"), ...compliant("fourth") }));
      const architectureScores = [none, one, two].map(({ dimensions }) => dimensions.architecture.score!);

      expect([none, one, two].map(({ dimensions }) => dimensions.architecture.measures.facadeBypasses!.value)).toEqual([0, 1, 2]);
      expect(architectureScores[0]! - architectureScores[1]!).toBeGreaterThan(0);
      expect(architectureScores[1]! - architectureScores[2]!).toBeCloseTo(architectureScores[0]! - architectureScores[1]!, 10);
      expect(twoAmongCompliant.dimensions.architecture.score).toBe(two.dimensions.architecture.score);
    },
    toolTimeoutMs,
  );
});

describe("complexity", () => {
  test(
    "a function with cyclomatic complexity 25 lowers the complexity score and leads its drivers",
    async () => {
      const before = await indexAt(base);
      const after = await indexAt(await variant({ "products/a/backend/busy.py": busyFunction }));

      expect(after.dimensions.complexity.functions.overTwenty).toBe(1);
      expect(after.dimensions.complexity.drivers[0]).toEqual({ file: "products/a/backend/busy.py", function: "busy", ccn: 25, nloc: 50 });
      expect(after.dimensions.complexity.score).toBeLessThan(before.dimensions.complexity.score!);
    },
    toolTimeoutMs,
  );

  test(
    "migrations are left out of every measure and counted as excluded",
    async () => {
      const before = await indexAt(base);
      const after = await indexAt(await variant({ "products/a/backend/migrations/__init__.py": "", "products/a/backend/migrations/0001_initial.py": busyFunction }));

      expect(after.files.excluded).toBe(before.files.excluded + 2);
      expect(after.dimensions).toEqual(before.dimensions);
    },
    toolTimeoutMs,
  );
});

describe("smells", () => {
  test(
    "lint findings, duplicated code, workaround comments, and type escapes lower the smells score",
    async () => {
      const before = await indexAt(base);
      const after = await indexAt(
        await variant({
          "products/a/backend/rows.py": duplicatedBlock,
          "products/a/backend/rows_copy.py": duplicatedBlock.replace("first", "second"),
          "products/a/backend/helpers.py":
            "import os\nfrom typing import Any\n\nLINK = 'https://example.com/todo/list'\n\n\ndef double(value: Any):  # type: ignore\n    # TODO: temporary workaround until the API settles\n    return value * 2\n",
          "products/a/frontend/view.tsx": "export function View({ count }: { count: any }): string {\n  debugger;\n  return count > 1 ? 'many' : 'one';\n}\n",
        }),
      );

      expect(after.dimensions.smells.ruff).toMatchObject({ count: before.dimensions.smells.ruff.count + 1, rules: { F401: 1 }, drivers: [{ file: "products/a/backend/helpers.py", count: 1 }] });
      expect(after.dimensions.smells.oxlint).toMatchObject({ count: 1, rules: { "eslint(no-debugger)": 1 }, drivers: [{ file: "products/a/frontend/view.tsx", count: 1 }] });
      expect(after.dimensions.smells.duplication).toMatchObject({ clones: 1, drivers: [{ file: "products/a/backend/rows.py", count: 14 }, { file: "products/a/backend/rows_copy.py", count: 14 }] });
      expect(after.dimensions.smells.markers.count).toBe(1);
      expect(after.dimensions.smells.typeEscapes.counts).toEqual({ any: 2, typeIgnore: 1, tsIgnore: 0, asAny: 0, eslintDisable: 0 });
      expect(after.dimensions.smells.score).toBeLessThan(before.dimensions.smells.score!);
    },
    toolTimeoutMs,
  );

  test(
    "code under a generated-code marker, such as kea-typegen's inline types, is left out of every measure",
    async () => {
      const before = await indexAt(base);
      const generatedTypes = "\n// Generated by kea-typegen. Update if you're an agent, ignore if you're human.\nexport interface viewLogicActions {\n  load: (payload?: Payload) => {\n    payload?: any\n  }\n}\n";
      const after = await indexAt(
        await variant({ "products/a/frontend/view.tsx": `import type { Payload } from './payload'\n\n${product["products/a/frontend/view.tsx"]}${generatedTypes}` }),
      );

      expect(after.files).toEqual({ ...before.files, productionLines: before.files.productionLines + 1, generatedLines: 6 });
      expect(after.dimensions.complexity.functions).toEqual(before.dimensions.complexity.functions);
      expect(after.dimensions.smells.oxlint.count).toBe(before.dimensions.smells.oxlint.count);
      expect(after.dimensions.smells.typeEscapes.count).toBe(before.dimensions.smells.typeEscapes.count);
      expect(after.dimensions.smells.duplication).toEqual(before.dimensions.smells.duplication);
    },
    toolTimeoutMs,
  );

  test(
    "a scope too small for clone detection measures no duplication",
    async () => {
      const small = await indexAt(base, "products/b/backend/facade");

      expect(small.dimensions.smells.duplication).toEqual({ percentage: 0, duplicatedLines: 0, clones: 0, drivers: [] });
    },
    toolTimeoutMs,
  );
});

describe("tests", () => {
  test(
    "facade coverage counts the public facade functions a test in the scope imports",
    async () => {
      const before = await indexAt(base);
      const mentionOnly = await indexAt(await variant({ "products/a/backend/test/test_client.py": "def test_client(client):\n    client.stop()\n" }));
      const imported = await indexAt(
        await variant({ "products/a/backend/test/test_stop.py": "from products.a.backend.facade.api import stop\n\n\ndef test_stop():\n    assert stop(1) == 1\n" }),
      );

      expect(before.dimensions.tests.facadeCoverage).toEqual({ functions: 2, covered: 1, share: 0.5, uncovered: ["products/a/backend/facade/api.py:stop"] });
      expect(mentionOnly.dimensions.tests.facadeCoverage.covered).toBe(1);
      expect(imported.dimensions.tests.facadeCoverage).toMatchObject({ functions: 2, covered: 2, uncovered: [] });
    },
    toolTimeoutMs,
  );

  test(
    "facade coverage is reported but unscored below ten facade functions, so growing a small facade never lowers the score",
    async () => {
      const small = await indexAt(base);
      const grown = await indexAt(await variant({ "products/a/backend/facade/more.py": facadeFunctions(["pause", "resume", "retry"]) }));
      const withoutFacade = await indexAt(base, "products/a/frontend");

      expect(small.dimensions.tests.measures.facadeCoverage).toEqual({ value: 0.5, score: null, best: 1, worst: 0 });
      expect(grown.dimensions.tests.facadeCoverage).toMatchObject({ functions: 5, covered: 1 });
      for (const index of [small, grown]) expect(index.dimensions.tests.score).toBe(index.dimensions.tests.measures.testRatio!.score);
      expect(withoutFacade.dimensions.tests.measures.facadeCoverage).toEqual({ value: null, score: null, best: 1, worst: 0 });
    },
    toolTimeoutMs,
  );

  test(
    "the test ratio moves the composite at a ninth of the weight, since the tests dimension counts 10 of 90",
    async () => {
      const before = await indexAt(base);
      const moreTests = await indexAt(await variant({ "products/a/backend/test/test_more.py": "def test_more():\n    assert True\n" }));
      const change = (read: (index: CoherenceIndex) => number) => read(moreTests) - read(before);

      expect(change(({ dimensions }) => dimensions.tests.score!)).toBeGreaterThan(0);
      expect(change(({ composite }) => composite.score)).toBeCloseTo(change(({ dimensions }) => dimensions.tests.score!) / 9, 10);
    },
    toolTimeoutMs,
  );

  test(
    "from ten facade functions on, facade coverage is scored, and adding a tested facade function raises it",
    async () => {
      const tenFunctions = { "products/a/backend/facade/more.py": facadeFunctions(Array.from({ length: 8 }, (_, index) => `step_${index}`)) };
      const ten = await indexAt(await variant(tenFunctions));
      const elevenTested = await indexAt(
        await variant({
          ...tenFunctions,
          "products/a/backend/facade/extra.py": facadeFunctions(["extra"]),
          "products/a/backend/test/test_extra.py": "from products.a.backend.facade.extra import extra\n\n\ndef test_extra():\n    assert extra(1) == 1\n",
        }),
      );

      expect(ten.dimensions.tests.measures.facadeCoverage).toMatchObject({ value: 0.1, score: 10 });
      expect(elevenTested.dimensions.tests.facadeCoverage).toMatchObject({ functions: 11, covered: 2 });
      expect(elevenTested.dimensions.tests.measures.facadeCoverage!.score).toBeGreaterThan(ten.dimensions.tests.measures.facadeCoverage!.score!);
    },
    toolTimeoutMs,
  );
});

describe("the index", () => {
  test(
    "the same commit gives byte-identical JSON, cold or warm, apart from the timing",
    async () => {
      const warm = await measureCoherence({ repository: repository.dir, scope, commit: base });
      await rm(join(repository.dir, ".git", "uml-pr-review", "coherence-cache.sqlite"), { force: true });
      const cold = await measureCoherence({ repository: repository.dir, scope, commit: base });

      expect(JSON.stringify(cold.index)).toBe(JSON.stringify(warm.index));
      expect(cold.timing.cache.hits).toBe(0);
      expect(warm.timing.cache.misses).toBe(0);
    },
    toolTimeoutMs,
  );

  test(
    "reports rule counts per enforcement level when a rules file exists, and null when it does not",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "coherence-rules-"));
      const rules = join(directory, "rules.json");
      await writeFile(rules, JSON.stringify({ rules: [{ id: "one", currentLevel: "lint" }, { id: "two", currentLevel: "review" }, { id: "three", currentLevel: "lint" }] }));
      try {
        const withRules = await measureCoherence({ repository: repository.dir, scope, commit: base, rules });
        const withoutRules = await measureCoherence({ repository: repository.dir, scope, commit: base, rules: join(directory, "missing.json") });

        expect(withRules.index.dimensions.ladder).toEqual({ source: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), rules: 3, levels: { lint: 2, review: 1 } });
        expect(withoutRules.index.dimensions.ladder).toBeNull();
        expect(withRules.index.composite).toEqual(withoutRules.index.composite);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    toolTimeoutMs,
  );

  test(
    "the command line prints one schema-valid JSON document",
    async () => {
      const cli = Bun.spawn(["bun", join(import.meta.dir, "../../coherence/index.ts"), "--repo", repository.dir, "--scope", scope, "--commit", base, "--json"], { stdout: "pipe", stderr: "pipe" });
      const [stdout, code] = await Promise.all([new Response(cli.stdout).text(), cli.exited]);

      expect(code).toBe(0);
      const report = CoherenceReportSchema.parse(JSON.parse(stdout));
      expect(report.index).toEqual(await indexAt(base));
    },
    toolTimeoutMs,
  );
});
