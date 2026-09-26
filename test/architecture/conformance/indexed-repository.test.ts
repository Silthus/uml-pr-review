import { afterEach, expect, test } from "bun:test";
import type { ArchitecturePlan } from "../../../src/architecture/contracts/index.ts";
import { checkConformance } from "../../../src/architecture/conformance/index.ts";
import { createRepositoryIndexer } from "../../../src/architecture/index/index.ts";
import { ArchitectureModel } from "../../../src/architecture/model/index.ts";
import { type Files, type TemporaryRepository, temporaryRepository } from "../index/repository.ts";
import { planOf } from "./plan-builder.ts";

const indexer = createRepositoryIndexer({ workers: 1 });
let repository: TemporaryRepository | undefined;

afterEach(async () => {
  await repository?.cleanup();
  repository = undefined;
});

async function finalCheck({ committed, working, plan }: { committed: Files; working: Files; plan: ArchitecturePlan }) {
  repository = await temporaryRepository(committed);
  const base = await indexer.index(repository.dir, { commit: "HEAD" });
  await repository.write(working);
  const head = await indexer.index(repository.dir, "working-tree");
  const changes = await indexer.changes(repository.dir, base.tree, head.tree);
  return checkConformance({ plan, base: new ArchitectureModel(base), head: new ArchitectureModel(head), changes, phase: "final" });
}

test("a named import that gains a symbol outside the seam's interface is off-interface", async () => {
  const report = await finalCheck({
    committed: { "app/use.ts": 'import { good } from "../lib/api";\nexport const result = good;\n', "lib/api.ts": "export const good = 1;\nexport const bad = 2;\n" },
    working: { "app/use.ts": 'import { good, bad } from "../lib/api";\nexport const result = good + bad;\n' },
    plan: planOf({
      modules: [{ path: "app", action: "modify" }],
      seams: [{ from: "app", to: "lib", action: "keep", interface: { files: ["lib/api.ts"], symbols: ["good"] } }],
    }),
  });

  expect(report.findings.map(({ rule, severity, file, line, message, fix }) => ({ rule, severity, file, line, message, fix }))).toEqual([
    {
      rule: "off-interface",
      severity: "violation",
      file: "app/use.ts",
      line: 1,
      message: "app/use.ts:1 imports `bad` from `lib/api.ts`, but seam `app` -> `lib` allows only good.",
      fix: "Use good, or expose what you need through `lib/api.ts` (symbols good).",
    },
  ]);
});

test("a tsconfig alias retargeted without a source change is an unplanned dependency at the importing line", async () => {
  const aliasTo = (target: string) => JSON.stringify({ compilerOptions: { paths: { "@api": [target] } } });
  const report = await finalCheck({
    committed: {
      "app/use.ts": 'import { api } from "@api";\nexport const value = api;\n',
      "app/tests/use.test.ts": 'import { value } from "../use";\nvalue;\n',
      "good/api.ts": "export const api = 1;\n",
      "bad/api.ts": "export const api = 2;\n",
      "tsconfig.json": aliasTo("./good/api.ts"),
    },
    working: { "tsconfig.json": aliasTo("./bad/api.ts") },
    plan: planOf({ modules: [{ path: "app/tests", action: "modify" }, { path: "app", action: "modify" }] }),
  });

  expect(report.findings.map(({ rule, severity, file, line, message, fix }) => ({ rule, severity, file, line, message, fix }))).toEqual([
    {
      rule: "missing-module",
      severity: "violation",
      file: "app/use.ts",
      line: 1,
      message: "`app` is unchanged; the plan modifies it to show feature flag usage on issues.",
      fix: "Make the planned change in `app`, or ask the human to unlock the plan and drop `app` from it.",
    },
    {
      rule: "unplanned-dependency",
      severity: "violation",
      file: "app/use.ts",
      line: 1,
      message: "app/use.ts:1 imports `bad/api.ts`: a new dependency from `app` on `bad` that the plan does not name.",
      fix: "Remove the import, or ask the human to unlock the plan and add seam `app` -> `bad`.",
    },
    {
      rule: "missing-module",
      severity: "warning",
      file: "app/tests/use.test.ts",
      line: 1,
      message: "`app/tests` is unchanged; the plan modifies it to show feature flag usage on issues.",
      fix: "Make the planned change in `app/tests`, or ask the human to unlock the plan and drop `app/tests` from it.",
    },
  ]);
});
