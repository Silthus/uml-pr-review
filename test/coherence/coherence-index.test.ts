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
  "products/a/backend/test/__init__.py": "",
  "products/a/backend/test/test_api.py": "from products.a.backend.facade.api import run\n\n\ndef test_run():\n    assert run(1) == 3\n",
  "products/a/frontend/view.tsx": "export function View({ count }: { count: number }): string {\n  return count > 1 ? 'many' : 'one';\n}\n",
  "products/b/__init__.py": "",
  "products/b/backend/__init__.py": "",
  "products/b/backend/consumer.py": "from products.a.backend.logic import compute\n\n\ndef consume():\n    return compute(2)\n",
};

const cyclicHelpers = "from products.a.backend import logic\n\n\ndef double(value):\n    return value * 2 if logic else value\n";
const throughFacade = "from products.a.backend.facade.api import run\n\n\ndef consume():\n    return run(2)\n";
const busyFunction = `def busy(value):\n${Array.from({ length: 24 }, (_, index) => `    if value == ${index}:\n        return ${index}\n`).join("")}    return -1\n`;
const duplicatedBlock = `def first(rows):\n${Array.from({ length: 12 }, (_, index) => `    rows.append({"name": "row", "index": ${index}, "enabled": True})\n`).join("")}    return rows\n`;

let repository: TemporaryRepository;
let base: string;
const measured = new Map<string, CoherenceIndex>();

async function variant(changes: Files): Promise<string> {
  const commit = await repository.commit(changes);
  await repository.git("reset", "--quiet", "--hard", base);
  return commit;
}

async function indexAt(commit: string): Promise<CoherenceIndex> {
  const known = measured.get(commit);
  if (known) return known;
  const { index } = await measureCoherence({ repository: repository.dir, scope, commit });
  measured.set(commit, index);
  return index;
}

beforeAll(async () => {
  repository = await temporaryRepository(product);
  base = (await repository.git("rev-parse", "HEAD")).trim();
});

afterAll(() => repository.cleanup());

describe("coherence index", () => {
  test(
    "a dependency cycle lowers the architecture score and names the files on it",
    async () => {
      const before = await indexAt(base);
      const after = await indexAt(await variant({ "products/a/backend/helpers.py": cyclicHelpers }));

      expect(before.dimensions.architecture.cycles).toEqual({ count: 0, files: [] });
      expect(after.dimensions.architecture.cycles).toEqual({ count: 1, files: ["products/a/backend/helpers.py", "products/a/backend/logic.py"] });
      expect(after.dimensions.architecture.score).toBeLessThan(before.dimensions.architecture.score!);
      expect(after.composite.score).toBeLessThan(before.composite.score);
    },
    toolTimeoutMs,
  );

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
    "routing a cross-product import through the facade raises the facade share",
    async () => {
      const before = await indexAt(base);
      const after = await indexAt(await variant({ "products/b/backend/consumer.py": throughFacade }));

      expect(before.dimensions.architecture.facade).toMatchObject({ crossings: 1, share: 0, bypasses: [{ from: "products/b/backend/consumer.py", to: "products/a/backend/logic.py" }] });
      expect(after.dimensions.architecture.facade).toMatchObject({ crossings: 1, share: 1, bypasses: [] });
      expect(after.dimensions.architecture.score).toBeGreaterThan(before.dimensions.architecture.score!);
    },
    toolTimeoutMs,
  );

  test(
    "lint findings, duplicated code, workaround comments, and type escapes lower the smells score",
    async () => {
      const before = await indexAt(base);
      const after = await indexAt(
        await variant({
          "products/a/backend/rows.py": duplicatedBlock,
          "products/a/backend/rows_copy.py": duplicatedBlock.replace("first", "second"),
          "products/a/backend/helpers.py": "import os\nfrom typing import Any\n\n\ndef double(value: Any):  # type: ignore\n    # TODO: temporary workaround until the API settles\n    return value * 2\n",
          "products/a/frontend/view.tsx": "export function View({ count }: { count: number }): string {\n  debugger;\n  return count > 1 ? 'many' : 'one';\n}\n",
        }),
      );

      expect(after.dimensions.smells.ruff).toMatchObject({ count: before.dimensions.smells.ruff.count + 1, rules: { F401: 1 }, drivers: [{ file: "products/a/backend/helpers.py", count: 1 }] });
      expect(after.dimensions.smells.oxlint).toMatchObject({ count: 1, rules: { "eslint(no-debugger)": 1 }, drivers: [{ file: "products/a/frontend/view.tsx", count: 1 }] });
      expect(after.dimensions.smells.duplication.percentage).toBeGreaterThan(before.dimensions.smells.duplication.percentage);
      expect(after.dimensions.smells.markers.count).toBe(1);
      expect(after.dimensions.smells.typeEscapes.counts).toMatchObject({ any: 2, typeIgnore: 1 });
      expect(after.dimensions.smells.score).toBeLessThan(before.dimensions.smells.score!);
    },
    toolTimeoutMs,
  );

  test(
    "facade coverage counts the public facade functions a test in the scope references",
    async () => {
      const before = await indexAt(base);
      const after = await indexAt(
        await variant({ "products/a/backend/test/test_stop.py": "from products.a.backend.facade.api import stop\n\n\ndef test_stop():\n    assert stop(1) == 1\n" }),
      );

      expect(before.dimensions.tests.facadeCoverage).toMatchObject({ functions: 2, covered: 1, uncovered: ["products/a/backend/facade/api.py:stop"] });
      expect(after.dimensions.tests.facadeCoverage).toMatchObject({ functions: 2, covered: 2, uncovered: [] });
      expect(after.dimensions.tests.score).toBeGreaterThan(before.dimensions.tests.score!);
    },
    toolTimeoutMs,
  );

  test(
    "the same commit gives byte-identical JSON, cold or warm, apart from the timing",
    async () => {
      const warm = await measureCoherence({ repository: repository.dir, scope, commit: base });
      await rm(join(repository.dir, ".git", "uml-pr-review", "coherence-cache.sqlite"), { force: true });
      const cold = await measureCoherence({ repository: repository.dir, scope, commit: base });

      expect(JSON.stringify(cold.index)).toBe(JSON.stringify(warm.index));
      expect(cold.timing.cache.misses).toBeGreaterThan(0);
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

        expect(withRules.index.dimensions.ladder).toEqual({ rules: 3, levels: { lint: 2, review: 1 } });
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
