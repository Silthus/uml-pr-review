#!/usr/bin/env bun
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { CoherenceReport } from "./contract.ts";
import { measureCoherence } from "./measure.ts";

const usage = "Usage: bun coherence/index.ts --repo <path> --scope <path> [--commit <rev>] [--rules <rules.json>] [--json]";

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    scope: { type: "string" },
    commit: { type: "string", default: "HEAD" },
    rules: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

if (!values.repo || !values.scope) {
  console.error(usage);
  process.exit(2);
}

const report = await measureCoherence({
  repository: resolve(values.repo),
  scope: values.scope,
  commit: values.commit,
  rules: values.rules ?? join(import.meta.dir, "..", "docs", "harvest", harvestName(values.scope), "rules.json"),
});

console.log(values.json ? JSON.stringify(report, null, 2) : summary(report));

function harvestName(scope: string): string {
  return /^(?:\.\/)?products\/([^/]+)/.exec(scope)?.[1] ?? basename(resolve(scope));
}

function summary({ index, timing }: CoherenceReport): string {
  const { architecture, complexity, smells, tests, ladder } = index.dimensions;
  const row = (name: string, score: number | null) => `  ${name.padEnd(13)} ${score === null ? "n/a" : score.toFixed(1)}`;
  return [
    `Coherence Index for ${index.scope} at ${index.commit.slice(0, 12)}: ${index.composite.score.toFixed(1)}`,
    row("architecture", architecture.score),
    row("complexity", complexity.score),
    row("smells", smells.score),
    row("tests", tests.score),
    `  ladder        ${ladder === null ? "no rules file" : Object.entries(ladder.levels).map(([level, count]) => `${level} ${count}`).join(", ")}`,
    `Measured in ${(timing.milliseconds / 1000).toFixed(1)} s (${timing.cache.hits} cached, ${timing.cache.misses} measured). Add --json for every measure and its drivers.`,
  ].join("\n");
}
