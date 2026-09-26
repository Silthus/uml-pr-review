import { compare } from "../drivers.ts";
import { readChurn, type ChurnedCommit } from "./churn.ts";
import { factorsOf, round, scoredSignals, unavailableReason, type CoveringRule, type Factors } from "./factors.ts";
import { measureModules, type ScopeModules } from "./modules.ts";
import type { OpenPullRequest, OpenPullRequests } from "./pull-requests.ts";
import { readBaselineEntries } from "./ratchets.ts";
import { nextStep, type Recommendation } from "./recipe.ts";
import { signalKinds, widestWindowRows, type SignalKind, type SignalReport } from "./report.ts";
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

export type Provider = "complexity" | "review findings" | "open pull requests";
export type Target = { rank: number; module: string; score: number; files: number; lines: number; factors: Factors; recommendation: Recommendation };
export type Unavailable = { signal: Provider | SignalKind; reason: string };
export type Skipped = { module: string; pullRequests: number[] };

export type TargetReport = {
  scope: string;
  commit: string;
  window: { since: string; until: string; days: number };
  formula: string;
  available: (Provider | SignalKind)[];
  unavailable: Unavailable[];
  ignored: SignalKind[];
  openPullRequests: { repository: string; open: number } | null;
  skipped: Skipped[];
  targets: Target[];
};

type Provided<T> = { value: T; unavailable: null } | { value: null; unavailable: Unavailable };

export const churnDays = 90;
export const formula = [
  "score = pressure × pain × safety, each in [0, 1]; counts saturate as n / (n + half).",
  "Pressure is the mean of commits, touched source lines, and authors over the window; agent co-authored commits are evidence only.",
  "Pain is 1 − Π(1 − c) over its available components, so any strong pain counts and a missing provider only drops out.",
  "Safety is (0.5 + 0.5 × tested share) × (1 − 0.5 × saturated traffic).",
  "Ties break on pain × safety. Modules that open pull requests touch are skipped.",
].join(" ");

const sourceFile = /\.(?:py|[jt]sx?)$/;

export async function rankTargets({ repository, scope, commit = "HEAD", rules: rulesPath, signals, openPullRequests, days = churnDays }: TargetRequest): Promise<TargetReport> {
  const scopePath = normalisedScope(scope);
  if (signals !== null) assertCovers(signals, scopePath);
  const [modules, churn, rules, pullRequests] = await Promise.all([
    measureModules(repository, scopePath, commit),
    readChurn(repository, commit, scopePath, days),
    provide("review findings", () => (rulesPath === undefined ? Promise.reject(new Error("no --rules file given")) : readHarvestedRules(rulesPath))),
    provide("open pull requests", openPullRequests),
  ]);
  const baselines = await readBaselineEntries(modules.root, modules.tree, modules.scope);
  const signalRows = signals === null ? [] : widestWindowRows(signals);
  const skipped = skippedModules(modules, pullRequests.value?.pullRequests ?? []);
  const skippedPaths = new Set(skipped.map(({ module }) => module));
  const targets = modules.modules
    .filter(({ path }) => !skippedPaths.has(path))
    .map((module) => {
      const owns = (path: string) => modules.moduleOf(path) === module.path;
      const covering = rules.value?.flatMap((rule) => coverage(modules, rule, module.path)) ?? null;
      const factors = factorsOf({ module, commits: ownedCommits(churn.commits, owns), rules: covering, signals: signalRows.filter(({ path }) => owns(path)), signalReport: signals });
      return {
        module: module.path,
        score: round(factors.pressure.value * factors.pain.value * factors.safety.value),
        files: module.files.length,
        lines: module.lines,
        factors,
        recommendation: nextStep({ module, rules: covering ?? [], baselines: baselines.filter(({ path }) => owns(path)) }),
      };
    })
    .sort((a, b) => b.score - a.score || tieBreak(b.factors) - tieBreak(a.factors) || compare(a.module, b.module))
    .map((target, index) => ({ rank: index + 1, ...target }));
  const complexity: Unavailable | null = modules.complexityUnavailable === null ? null : { signal: "complexity", reason: modules.complexityUnavailable };
  return {
    scope: modules.scope,
    commit: modules.commit,
    window: { since: churn.since, until: churn.until, days },
    formula,
    ...availability(signals, [complexity, rules.unavailable, pullRequests.unavailable]),
    openPullRequests: pullRequests.value && { repository: pullRequests.value.repository, open: pullRequests.value.pullRequests.length },
    skipped,
    targets,
  };
}

function assertCovers(signals: SignalReport, scope: string): void {
  const reportScope = normalisedScope(signals.scope);
  if (reportScope !== "." && scope !== reportScope && !scope.startsWith(`${reportScope}/`)) {
    throw new Error(`the signal report covers ${signals.scope}, not ${scope}`);
  }
}

async function provide<T>(signal: Provider, load: () => Promise<T>): Promise<Provided<T>> {
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
  const share = rule.paths.reduce((total, path) => total + pathShare(modules, path, module), 0) / rule.paths.length;
  return share === 0 ? [] : [{ ...rule, share }];
}

function pathShare(modules: ScopeModules, path: string, module: string): number {
  if (!path.endsWith("/")) return modules.moduleOf(path) === module ? 1 : 0;
  const folder = path.replace(/\/+$/, "");
  const below = modules.modules.filter(({ path: candidate }) => candidate === folder || candidate.startsWith(`${folder}/`)).map(({ path: candidate }) => candidate);
  return below.includes(module) ? 1 / below.length : 0;
}

function ownedCommits(commits: ChurnedCommit[], owns: (path: string) => boolean): ChurnedCommit[] {
  return commits.flatMap((commit) => {
    const files = commit.files.filter(({ path }) => sourceFile.test(path) && owns(path));
    return files.length === 0 ? [] : [{ ...commit, files }];
  });
}

function tieBreak({ pain, safety }: Factors): number {
  return pain.value * safety.value;
}

function availability(signals: SignalReport | null, providers: (Unavailable | null)[]): Pick<TargetReport, "available" | "unavailable" | "ignored"> {
  const missingProviders = providers.filter((entry) => entry !== null);
  const missingSignals = scoredSignals.flatMap((signal) => {
    const reason = unavailableReason([signal], signals);
    return reason === null ? [] : [{ signal, reason }];
  });
  const unavailable = [...missingProviders, ...missingSignals];
  const known: (Provider | SignalKind)[] = ["complexity", "review findings", "open pull requests", ...scoredSignals];
  return {
    available: known.filter((signal) => !unavailable.some((entry) => entry.signal === signal)),
    unavailable,
    ignored: signalKinds.filter((signal) => !scoredSignals.includes(signal)),
  };
}

function normalisedScope(scope: string): string {
  const trimmed = scope.replace(/^\.\//, "").replace(/\/+$/, "");
  return trimmed === "" ? "." : trimmed;
}
