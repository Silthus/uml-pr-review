import { compare } from "../drivers.ts";
import { readChurn, type ChurnedCommit } from "./churn.ts";
import { factorsOf, round, unavailableReason, type CoveringRule, type Factors } from "./factors.ts";
import { measureModules, type ScopeModules } from "./modules.ts";
import type { OpenPullRequest, OpenPullRequests } from "./pull-requests.ts";
import { readConfigMentions, type ConfigMention } from "./ratchets.ts";
import { nextStep, type Recommendation } from "./recipe.ts";
import { signalKinds, type SignalReport, type SignalRow } from "./report.ts";
import { readHarvestedRules, type HarvestedRule } from "./rules.ts";

export type TargetRequest = {
  repository: string;
  scope: string;
  commit?: string;
  rules?: string;
  signals: SignalReport | null;
  openPullRequests: OpenPullRequests;
  days?: number;
};

export type Target = { rank: number; module: string; score: number; files: number; lines: number; factors: Factors; recommendation: Recommendation };
export type Unavailable = { signal: string; reason: string };
export type Skipped = { module: string; pullRequests: number[] };

export type TargetReport = {
  scope: string;
  commit: string;
  window: { since: string; until: string; days: number };
  formula: string;
  available: string[];
  unavailable: Unavailable[];
  openPullRequests: { repository: string; open: number } | null;
  skipped: Skipped[];
  targets: Target[];
};

type Provided<T> = { value: T; unavailable: null } | { value: null; unavailable: Unavailable };

export const churnDays = 90;
export const formula =
  "score = pressure × pain × safety, each in [0, 1]. Counts saturate as n / (n + half). Pressure is the mean of commits, touched lines, and authors over the window. Pain is 1 − Π(1 − c) over its available components, so any strong pain counts and a missing provider only drops out. Safety is (0.5 + 0.5 × tested share) × (1 − 0.5 × saturated traffic). Modules that open pull requests touch are skipped.";

export async function rankTargets({ repository, scope, commit = "HEAD", rules: rulesPath, signals, openPullRequests, days = churnDays }: TargetRequest): Promise<TargetReport> {
  const scopePath = normalisedScope(scope);
  const [modules, churn, rules, pullRequests] = await Promise.all([
    measureModules(repository, scopePath, commit),
    readChurn(repository, commit, scopePath, days),
    provide("review findings", () => (rulesPath === undefined ? Promise.reject(new Error("no --rules file given")) : readHarvestedRules(rulesPath))),
    provide("open pull requests", openPullRequests),
  ]);
  const mentions = await readConfigMentions(modules.root, modules.tree, modules.scope);
  const skipped = skippedModules(modules, pullRequests.value?.pullRequests ?? []);
  const skippedPaths = new Set(skipped.map(({ module }) => module));
  const ranked = modules.modules
    .filter(({ path }) => !skippedPaths.has(path))
    .map((module) => {
      const owns = (path: string) => modules.moduleOf(path) === module.path;
      const covering = rules.value?.flatMap((rule) => coverage(modules, rule, module.path)) ?? null;
      const factors = factorsOf({ module, commits: ownedCommits(churn.commits, owns), rules: covering, signals: signals?.rows.filter(({ path }) => owns(path)) ?? [], signalReport: signals });
      return {
        module: module.path,
        score: round(factors.pressure.value * factors.pain.value * factors.safety.value),
        files: module.files.length,
        lines: module.lines,
        factors,
        recommendation: nextStep({ module, rules: covering ?? [], mentions: mentions.filter(({ path }) => owns(path)) }),
      };
    })
    .sort((a, b) => b.score - a.score || compare(a.module, b.module))
    .map((target, index) => ({ rank: index + 1, ...target }));
  return {
    scope: modules.scope,
    commit: modules.commit,
    window: { since: churn.since, until: churn.until, days },
    formula,
    ...availability(signals, [rules.unavailable, pullRequests.unavailable]),
    openPullRequests: pullRequests.value && { repository: pullRequests.value.repository, open: pullRequests.value.pullRequests.length },
    skipped,
    targets: ranked,
  };
}

async function provide<T>(signal: string, load: () => Promise<T>): Promise<Provided<T>> {
  try {
    return { value: await load(), unavailable: null };
  } catch (error) {
    return { value: null, unavailable: { signal, reason: error instanceof Error ? error.message : String(error) } };
  }
}

function skippedModules(modules: ScopeModules, pullRequests: OpenPullRequest[]): Skipped[] {
  const touching = new Map<string, number[]>();
  for (const { number, files } of pullRequests) {
    for (const module of new Set(files.flatMap((file) => modules.moduleOf(file) ?? []))) touching.set(module, [...(touching.get(module) ?? []), number]);
  }
  return [...touching]
    .map(([module, numbers]) => ({ module, pullRequests: numbers.sort((a, b) => a - b) }))
    .sort((a, b) => compare(a.module, b.module));
}

function coverage(modules: ScopeModules, rule: HarvestedRule, module: string): CoveringRule[] {
  const covering = rule.paths.filter((path) => {
    const folder = path.replace(/\/+$/, "");
    return path.endsWith("/") ? module === folder || module.startsWith(`${folder}/`) : modules.moduleOf(path) === module;
  });
  return covering.length === 0 ? [] : [{ ...rule, share: covering.length / rule.paths.length }];
}

function ownedCommits(commits: ChurnedCommit[], owns: (path: string) => boolean): ChurnedCommit[] {
  return commits.flatMap((commit) => {
    const files = commit.files.filter(({ path }) => owns(path));
    return files.length === 0 ? [] : [{ ...commit, files }];
  });
}

function availability(signals: SignalReport | null, providers: (Unavailable | null)[]): { available: string[]; unavailable: Unavailable[] } {
  const missingProviders = providers.filter((entry) => entry !== null);
  const missingSignals = signalKinds.flatMap((signal) => {
    const reason = unavailableReason([signal], signals);
    return reason === null ? [] : [{ signal, reason }];
  });
  const unavailable = [...missingProviders, ...missingSignals];
  const known = ["git churn", "coherence index", "review findings", "open pull requests", ...signalKinds];
  return { available: known.filter((signal) => !unavailable.some((entry) => entry.signal === signal)), unavailable };
}

function normalisedScope(scope: string): string {
  const trimmed = scope.replace(/^\.\//, "").replace(/\/+$/, "");
  return trimmed === "" ? "." : trimmed;
}
