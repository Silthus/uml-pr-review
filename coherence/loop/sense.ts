#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { git } from "../../src/git.ts";
import { listQuestions } from "../inbox.ts";
import { githubOpenPullRequests } from "../signals/pull-requests.ts";
import { activePullRequestDays, rankTargets } from "../signals/rank.ts";
import { readSignalReport } from "../signals/report.ts";
import { emit, today, usageError, wholeNumber } from "./cli.ts";
import { defaultRunsDirectory, scopeName, senseFile, writeJson, type Sense } from "./state.ts";

const usage =
  "Usage: bun coherence/loop/sense.ts --repo <path> --scope <path> [--base <ref>] [--fetch] [--budget <n>] [--max-questions <n>] [--posthog-signals <SignalReport.json>] [--rules <rules.json>] [--github <owner/name>] [--active-days <n>] [--runs <dir>]";

const baseCandidates = ["upstream/master", "upstream/main", "origin/master", "origin/main", "HEAD"];
const targetsShown = 10;

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    scope: { type: "string" },
    base: { type: "string" },
    fetch: { type: "boolean", default: false },
    budget: { type: "string", default: "1" },
    "max-questions": { type: "string", default: "2" },
    "posthog-signals": { type: "string" },
    rules: { type: "string" },
    github: { type: "string" },
    "active-days": { type: "string", default: String(activePullRequestDays) },
    runs: { type: "string", default: defaultRunsDirectory },
  },
});

if (!values.repo || !values.scope) usageError(usage);

await emit(async () => {
  const repository = resolve(values.repo!);
  const scope = values.scope!.replace(/^\.\//, "").replace(/\/+$/, "");
  const name = scopeName(scope);
  const baseRef = values.base ?? (await defaultBase(repository));
  if (values.fetch) await fetchBase(repository, baseRef);
  const commit = (await git(repository, ["rev-parse", "--verify", `${baseRef}^{commit}`])).trim();
  const rules = resolve(values.rules ?? join(import.meta.dir, "..", "..", "docs", "harvest", name, "rules.json"));
  const signals = values["posthog-signals"] === undefined ? null : resolve(values["posthog-signals"]);
  const [questions, report] = await Promise.all([
    listQuestions(),
    rankTargets({
      repository,
      scope,
      commit,
      rules,
      signals: signals === null ? null : await readSignalReport(signals),
      openPullRequests: githubOpenPullRequests(repository, values.github),
      activeDays: wholeNumber(values["active-days"], "active-days"),
    }),
  ]);
  const sense: Sense = {
    id: new Date().toISOString(),
    repository,
    scope,
    scopeName: name,
    base: { ref: baseRef, commit },
    budget: Math.max(1, wholeNumber(values.budget, "budget")),
    maxQuestions: wholeNumber(values["max-questions"], "max-questions"),
    rules,
    signals,
    questions,
    report,
  };
  const path = senseFile(resolve(values.runs), today(), name);
  await writeJson(path, sense);
  return summary(path, sense);
});

async function defaultBase(repository: string): Promise<string> {
  for (const ref of baseCandidates) {
    if (await git(repository, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).then(() => true, () => false)) return ref;
  }
  throw new Error(`${repository} has none of ${baseCandidates.join(", ")}; pass --base <ref>`);
}

async function fetchBase(repository: string, ref: string): Promise<void> {
  const [remote, ...branch] = ref.split("/");
  if (branch.length === 0) throw new Error(`--fetch needs a remote-tracking base such as upstream/master, not ${ref}`);
  await git(repository, ["fetch", "--quiet", remote!, branch.join("/")]);
}

function summary(path: string, { id, base, budget, questions, report }: Sense) {
  return {
    sense: path,
    id,
    base,
    budget,
    available: report.available,
    unavailable: report.unavailable,
    activePullRequests: report.openPullRequests,
    skippedModules: report.skipped.length,
    questions: {
      open: questions.filter(({ state }) => state === "open").map(({ number, module, step }) => ({ number, module, step })),
      resolved: questions.filter(({ state }) => state === "resolved").map(({ number, module, step, answer }) => ({ number, module, step, answer })),
    },
    targets: report.targets.slice(0, targetsShown).map(({ rank, module, score, busyFiles, recommendation }) => ({
      rank,
      module,
      score,
      step: recommendation.step,
      verification: recommendation.verification,
      busyFiles: busyFiles.length,
    })),
  };
}
