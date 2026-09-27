#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createRepositoryIndexer } from "../../src/architecture/index/index.ts";
import { git } from "../../src/git.ts";
import { BlobCache } from "../blob-cache.ts";
import { measureComplexity } from "../complexity.ts";
import { readScope, totalLines } from "../scope.ts";
import { measureSmells } from "../smells.ts";
import { withToolbox } from "../tools.ts";
import { storedIndex } from "./attribute.ts";
import { readAttribution } from "./selection.ts";

const FindingsSchema = z.object({ lines: z.number(), functions: z.number(), overTen: z.number(), overTwenty: z.number(), lint: z.number(), typeEscapes: z.number(), markers: z.number(), bypasses: z.number(), cycleFiles: z.number() });
export const DiffLocalSchema = z.object({ before: FindingsSchema, after: FindingsSchema, files: z.number(), score: z.number() });
export const DiffLocalRunSchema = z.array(DiffLocalSchema.extend({ commit: z.string(), pr: z.number().nullable() }));

export type Findings = z.infer<typeof FindingsSchema>;
export type DiffLocal = z.infer<typeof DiffLocalSchema>;

const indexer = createRepositoryIndexer();

const weights: Record<Exclude<keyof Findings, "lines" | "functions">, number> = { overTen: 1, overTwenty: 2, lint: 1, typeEscapes: 1, markers: 1, bypasses: 3, cycleFiles: 1 };

export function diffLocalScore(before: Findings, after: Findings): number {
  return weighted(before) - weighted(after);
}

export function diffLocalDensity(before: Findings, after: Findings): number {
  const perKloc = (findings: Findings) => (findings.lines === 0 ? 0 : (1000 * weighted(findings)) / findings.lines);
  return perKloc(before) - perKloc(after);
}

function weighted(findings: Findings): number {
  return (Object.keys(weights) as (keyof typeof weights)[]).reduce((sum, key) => sum + weights[key] * findings[key], 0);
}

export async function diffLocal(repository: string, scope: string, before: string, after: string, reports: string): Promise<DiffLocal> {
  const changed = new Set((await git(repository, ["diff", "--name-only", "--no-renames", before, after, "--", scope])).split("\n").filter(Boolean));
  const [was, now] = [await findingsIn(repository, scope, before, changed, reports), await findingsIn(repository, scope, after, changed, reports)];
  return { before: was, after: now, files: changed.size, score: diffLocalScore(was, now) };
}

async function findingsIn(repository: string, scopePath: string, commit: string, changed: Set<string>, reports: string): Promise<Findings> {
  const index = await storedIndex(repository, scopePath, commit, reports);
  const architecture = {
    bypasses: index.dimensions.architecture.facade.bypasses.filter(({ from, to }) => changed.has(from) || changed.has(to)).length,
    cycleFiles: index.dimensions.architecture.cycles.files.filter((file) => changed.has(file)).length,
  };
  const payload = await indexer.index(repository, { commit });
  const scope = await readScope(payload.repository.root, payload, scopePath);
  const files = scope.production.filter(({ path }) => changed.has(path));
  if (files.length === 0) return { lines: 0, functions: 0, overTen: 0, overTwenty: 0, lint: 0, typeEscapes: 0, markers: 0, ...architecture };
  const cache = new BlobCache(payload.repository.commonDir);
  try {
    const [complexity, smells] = await withToolbox(repository, files, (toolbox) => Promise.all([measureComplexity(files, toolbox, cache), measureSmells(files, toolbox, cache)]));
    return {
      lines: totalLines(files),
      functions: complexity.functions.count,
      overTen: complexity.functions.overTen,
      overTwenty: complexity.functions.overTwenty,
      lint: smells.ruff.count + smells.oxlint.count,
      typeEscapes: smells.typeEscapes.count,
      markers: smells.markers.count,
      ...architecture,
    };
  } finally {
    cache.close();
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      reports: { type: "string", default: "/tmp/coherence-validation-reports" },
      concurrency: { type: "string", default: "3" },
      out: { type: "string", default: join(import.meta.dir, "data", "diff-local.json") },
    },
  });
  if (!values.repo) {
    console.error("Usage: bun coherence/validation/diff-local.ts --repo <path> [--reports /tmp/coherence-validation-reports] [--concurrency 3] [--out coherence/validation/data/diff-local.json]");
    process.exit(2);
  }
  const repository = resolve(values.repo);
  const { commits, scope } = await readAttribution();
  const results: z.infer<typeof DiffLocalRunSchema> = new Array(commits.length);
  let next = 0;
  const worker = async () => {
    for (let position = next++; position < commits.length; position = next++) {
      const { commit, parent, pr } = commits[position]!;
      results[position] = { commit, pr, ...(await diffLocal(repository, scope, parent, commit, resolve(values.reports!))) };
      console.error(`${position + 1}/${commits.length} ${commit.slice(0, 12)} diff-local ${results[position]!.score}`);
    }
  };
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
  await writeFile(resolve(values.out!), JSON.stringify(results, null, 1));
}
