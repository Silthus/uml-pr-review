#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { BlobCache } from "../../coherence/blob-cache.ts";
import { createRepositoryIndexer } from "../../src/architecture/index/index.ts";
import { git } from "../../src/architecture/index/git.ts";
import { readChange } from "./change.ts";
import { readConfig, weightOf, type GraderConfig } from "./config.ts";
import type { Detector, DetectorResult, GradeContext } from "./context.ts";
import { complexity } from "./detectors/complexity.ts";
import { cycles, facade } from "./detectors/imports.ts";
import { layering } from "./detectors/layering.ts";
import { duplication } from "./detectors/clones.ts";
import { reuse } from "./detectors/reuse.ts";
import { vocabulary } from "./detectors/vocabulary.ts";
import { FingerprintCache, fingerprintIndex } from "./fingerprints.ts";
import { importGraphOf } from "./graph.ts";
import { symbolIndex } from "./symbols.ts";
import type { DetectorName } from "./violations.ts";

export type ChangedFileSummary = { path: string; addedLines: number };
export type GradeReport = { base: string; head: string; files: ChangedFileSummary[]; grade: number; detectors: Partial<Record<DetectorName, DetectorResult>>; seconds: number };

export type Grader = { grade(base: string, head: string): Promise<GradeReport>; close(): void };

const detectors: Record<DetectorName, Detector> = { cycles, facade, layering, complexity, vocabulary, reuse, duplication };

export async function createGrader(repository: string, config: GraderConfig, cacheDirectory?: string): Promise<Grader> {
  const directory = cacheDirectory ?? join((await git(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim(), "uml-pr-review");
  const indexer = createRepositoryIndexer();
  const fingerprintCache = new FingerprintCache(directory, { windowTokens: config.clones.windowTokens, winnow: config.clones.winnow });
  const fingerprints = fingerprintIndex(repository, fingerprintCache);
  const resultCache = new BlobCache(directory);
  const symbols = symbolIndex(repository, resultCache);

  return {
    async grade(base, head) {
      const started = performance.now();
      const change = await readChange(repository, base, head);
      const context: GradeContext = {
        change,
        config,
        graphs: once(async () => ({ before: importGraphOf(await indexer.index(repository, { commit: base })), after: importGraphOf(await indexer.index(repository, { commit: head })) })),
        fingerprintsAtBase: once(() => fingerprints.at(base)),
        symbolsAtBase: once(() => symbols.at(base)),
        fingerprintCache,
        resultCache,
      };
      const results: Partial<Record<DetectorName, DetectorResult>> = {};
      for (const name of config.detectors) results[name] = await detectors[name](context);
      return {
        base,
        head,
        files: change.files.map(({ path, addedLines }) => ({ path, addedLines })),
        grade: gradeOf(results, config),
        detectors: results,
        seconds: (performance.now() - started) / 1000,
      };
    },
    close() {
      fingerprintCache.close();
      resultCache.close();
    },
  };
}

function gradeOf(results: Partial<Record<DetectorName, DetectorResult>>, config: GraderConfig): number {
  return (Object.entries(results) as [DetectorName, DetectorResult][]).reduce((sum, [name, { introduced, removed }]) => sum + weightOf(config, name) * (introduced.length - removed.length), 0);
}

function once<T>(compute: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | undefined;
  return () => (result ??= compute());
}

function render(report: GradeReport): string {
  const lines = [`grade ${report.grade} for ${report.base.slice(0, 12)}..${report.head.slice(0, 12)} (${report.files.length} files, ${report.seconds.toFixed(1)} s)`];
  for (const [name, result] of Object.entries(report.detectors)) {
    lines.push(`${name}: +${result.introduced.length} -${result.removed.length}`);
    for (const violation of result.introduced) lines.push(`  + ${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`);
    for (const violation of result.removed) lines.push(`  - ${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { repo: { type: "string" }, commit: { type: "string" }, base: { type: "string" }, json: { type: "boolean", default: false }, config: { type: "string" }, cache: { type: "string" } } });
  if (!values.repo || !values.commit) {
    console.error("Usage: bun benchmark/grader/grade.ts --repo <path> --commit <sha> [--base <sha>] [--json] [--config benchmark/grader/config.json] [--cache <dir>]");
    process.exit(2);
  }
  const repository = resolve(values.repo);
  const grader = await createGrader(repository, await readConfig(values.config), values.cache && resolve(values.cache));
  try {
    const report = await grader.grade(values.base ?? `${values.commit}^`, values.commit);
    console.log(values.json ? JSON.stringify(report, null, 1) : render(report));
  } finally {
    grader.close();
  }
}
