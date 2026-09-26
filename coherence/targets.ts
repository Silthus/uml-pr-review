#!/usr/bin/env bun
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Factor } from "./signals/factors.ts";
import { githubOpenPullRequests } from "./signals/pull-requests.ts";
import { activePullRequestDays, rankTargets, type Target, type TargetReport } from "./signals/rank.ts";
import { readSignalReport } from "./signals/report.ts";

const usage = "Usage: bun coherence/targets.ts --repo <path> --scope <path> [--commit <rev>] [--rules <rules.json>] [--posthog-signals <SignalReport.json>] [--github <owner/name>] [--active-days <n>] [--json]";
const detailed = 5;

const { values } = parseOptions();

const activeDays = Number(values["active-days"]);

if (!values.repo || !values.scope || !Number.isInteger(activeDays) || activeDays < 1) {
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
    activeDays,
  });
  console.log(values.json ? JSON.stringify(report, null, 2) : summary(report));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseOptions() {
  try {
    return parseArgs({
      options: {
        repo: { type: "string" },
        scope: { type: "string" },
        commit: { type: "string", default: "HEAD" },
        rules: { type: "string" },
        "posthog-signals": { type: "string" },
        github: { type: "string" },
        "active-days": { type: "string", default: String(activePullRequestDays) },
        json: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
    process.exit(2);
  }
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
    `Not scored: ${report.ignored.join(", ")}`,
    report.openPullRequests === null
      ? "Open pull requests: unavailable"
      : `Active pull requests: ${report.openPullRequests.active} in ${report.openPullRequests.repository}, updated within ${report.openPullRequests.activeDays} days`,
    ...report.skipped.map(({ module, pullRequests }) => `Skipped ${module}: every file is busy in ${pullRequestList(pullRequests)}`),
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

function targetDetail({ rank, module, files, lines, busyFiles, factors, recommendation }: Target): string[] {
  return [
    `#${rank} ${module} (${files} files, ${lines} lines)`,
    `  next: ${recommendation.step}, ${recommendation.verification}: ${recommendation.reason}`,
    ...busyFiles.map(({ path, pullRequests }) => `  busy: ${path} in ${pullRequestList(pullRequests)}`),
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

function pullRequestList(numbers: number[]): string {
  return numbers.map((number) => `#${number}`).join(", ");
}
