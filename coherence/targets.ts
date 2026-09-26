#!/usr/bin/env bun
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Factor } from "./signals/factors.ts";
import { githubOpenPullRequests } from "./signals/pull-requests.ts";
import { rankTargets, type Target, type TargetReport } from "./signals/rank.ts";
import { readSignalReport } from "./signals/report.ts";

const usage = "Usage: bun coherence/targets.ts --repo <path> --scope <path> [--commit <rev>] [--rules <rules.json>] [--posthog-signals <SignalReport.json>] [--github <owner/name>] [--json]";
const detailed = 5;

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    scope: { type: "string" },
    commit: { type: "string", default: "HEAD" },
    rules: { type: "string" },
    "posthog-signals": { type: "string" },
    github: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

if (!values.repo || !values.scope) {
  console.error(usage);
  process.exit(2);
}

const repository = resolve(values.repo);
const signalsPath = values["posthog-signals"];

try {
  const report = await rankTargets({
    repository,
    scope: values.scope,
    commit: values.commit,
    rules: values.rules ?? join(import.meta.dir, "..", "docs", "harvest", harvestName(values.scope), "rules.json"),
    signals: signalsPath === undefined ? null : await readSignalReport(resolve(signalsPath)),
    openPullRequests: githubOpenPullRequests(repository, values.github),
  });
  console.log(values.json ? JSON.stringify(report, null, 2) : summary(report));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function harvestName(scope: string): string {
  return /^(?:\.\/)?products\/([^/]+)/.exec(scope)?.[1] ?? basename(resolve(scope));
}

function summary(report: TargetReport): string {
  return [
    `Targets in ${report.scope} at ${report.commit.slice(0, 12)}, churn from ${report.window.since.slice(0, 10)} to ${report.window.until.slice(0, 10)}`,
    report.formula,
    `Available: ${report.available.join(", ")}`,
    ...report.unavailable.map(({ signal, reason }) => `Unavailable: ${signal} (${reason})`),
    report.openPullRequests === null ? "Open pull requests: unavailable" : `Open pull requests: ${report.openPullRequests.open} in ${report.openPullRequests.repository}`,
    ...report.skipped.map(({ module, pullRequests }) => `Skipped ${module}: open pull requests ${pullRequests.map((number) => `#${number}`).join(", ")}`),
    "",
    ...report.targets.map(targetLine),
    "",
    ...report.targets.slice(0, detailed).flatMap(targetDetail),
  ].join("\n");
}

function targetLine({ rank, module, score, factors, recommendation }: Target): string {
  const { pressure, pain, safety } = factors;
  return `${String(rank).padStart(3)}. ${(100 * score).toFixed(2).padStart(6)}  ${module}  pressure ${pressure.value.toFixed(2)} × pain ${pain.value.toFixed(2)} × safety ${safety.value.toFixed(2)}  -> ${recommendation.step} (${recommendation.verification})`;
}

function targetDetail({ rank, module, files, lines, factors, recommendation }: Target): string[] {
  return [
    `#${rank} ${module} (${files} files, ${lines} lines)`,
    `  next: ${recommendation.step}, ${recommendation.verification}: ${recommendation.reason}`,
    ...factorLines("pressure", factors.pressure),
    ...factorLines("pain", factors.pain),
    ...factorLines("safety", factors.safety),
    "",
  ];
}

function factorLines(name: string, { value, combination, components }: Factor): string[] {
  return [
    `  ${name} ${value.toFixed(2)} (${combination})`,
    ...components.map(({ name: component, raw, value: score, evidence }) =>
      score === null ? `    ${component}: unavailable` : `    ${component}: ${raw} -> ${score.toFixed(2)}${evidence.length > 0 ? `  [${evidence.join("; ")}]` : ""}`,
    ),
  ];
}
