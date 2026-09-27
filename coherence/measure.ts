import { parseTach, type TachConfig } from "../benchmark/lib/tach.ts";
import { createRepositoryIndexer, git } from "../src/architecture/index/index.ts";
import { measureArchitecture } from "./architecture.ts";
import { BlobCache } from "./blob-cache.ts";
import { measureComplexity } from "./complexity.ts";
import { CoherenceReportSchema, type CoherenceReport } from "./contract.ts";
import { readLadder } from "./ladder.ts";
import { compositeOf } from "./rescore.ts";
import { readScope, totalLines } from "./scope.ts";
import { measureSmells } from "./smells.ts";
import { measureTests } from "./tests.ts";
import { toolVersions, withToolbox } from "./tools.ts";

export type CoherenceRequest = { repository: string; scope: string; commit: string; rules?: string };

export async function measureCoherence({ repository, scope: scopePath, commit, rules }: CoherenceRequest): Promise<CoherenceReport> {
  const started = performance.now();
  const payload = await createRepositoryIndexer().index(repository, { commit });
  const scope = await readScope(payload.repository.root, payload, normalisedScope(scopePath));
  const cache = new BlobCache(payload.repository.commonDir);
  try {
    const [complexity, smells] = await withToolbox(repository, scope.production, (toolbox) =>
      Promise.all([measureComplexity(scope.production, toolbox, cache), measureSmells(scope.production, toolbox, cache)]),
    );
    const architecture = measureArchitecture(payload, scope, await readTach(payload.repository.root, payload.tree));
    const tests = measureTests(payload, scope);
    return CoherenceReportSchema.parse({
      index: {
        version: 1,
        scope: scope.path,
        commit: payload.commit,
        tree: payload.tree,
        tools: toolVersions,
        files: {
          production: scope.production.length,
          test: scope.tests.length,
          excluded: scope.excluded.length,
          productionLines: totalLines(scope.production),
          testLines: totalLines(scope.tests),
          generatedLines: scope.production.reduce((total, { generatedLines }) => total + generatedLines, 0),
        },
        composite: compositeOf({ architecture, complexity, smells, tests }),
        dimensions: { architecture, complexity, smells, tests, ladder: await readLadder(rules) },
      },
      timing: { milliseconds: Math.round(performance.now() - started), cache: cache.counts },
    });
  } finally {
    cache.close();
  }
}

async function readTach(root: string, tree: string): Promise<TachConfig | null> {
  const text = await git(root, ["cat-file", "blob", `${tree}:tach.toml`]).catch(() => null);
  return text === null ? null : parseTach(text);
}

function normalisedScope(scope: string): string {
  const trimmed = scope.replace(/^\.\//, "").replace(/\/+$/, "");
  return trimmed === "" ? "." : trimmed;
}
