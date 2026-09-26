import { compare } from "../drivers.ts";
import { readChurn, type ChurnedCommit } from "./churn.ts";
import { factorsOf, round, scoredSignals, unavailableReason, type CoveringRule, type Factors } from "./factors.ts";
import { measureModules, type ModuleState, type ScopeModules } from "./modules.ts";
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
  activeDays?: number;
};

export type Provider = "complexity" | "review findings" | "open pull requests";
export type BusyFile = { path: string; pullRequests: number[] };
export type Target = { rank: number; module: string; score: number; files: number; lines: number; busyFiles: BusyFile[]; factors: Factors; recommendation: Recommendation };
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
  openPullRequests: { repository: string; active: number; activeDays: number } | null;
  skipped: Skipped[];
  busyFiles: BusyFile[];
  targets: Target[];
};

type Provided<T> = { value: T; unavailable: null } | { value: null; unavailable: Unavailable };

export const churnDays = 90;
export const activePullRequestDays = 14;
export const formula = [
  "score = pressure × pain × safety, each in [0, 1]; counts saturate as n / (n + half).",
  "Pressure is the mean of commits, touched source lines, and authors over the window; agent co-authored commits are evidence only.",
  "Pain is 1 − Π(1 − c) over its available components, so any strong pain counts and a missing provider only drops out.",
  "Safety is (0.5 + 0.5 × tested share) × (1 − 0.5 × saturated traffic).",
  "Ties break on pain × safety. Files that pull requests updated within the active days touch are busy; modules with only busy files are skipped.",
].join(" ");

const sourceFile = /\.(?:py|[jt]sx?)$/;

export async function rankTargets({ repository, scope, commit = "HEAD", rules: rulesPath, signals, openPullRequests, days = churnDays, activeDays = activePullRequestDays }: TargetRequest): Promise<TargetReport> {
  const scopePath = normalisedScope(scope);
  if (signals !== null) assertCovers(signals, scopePath);
  const since = activeSince(activeDays);
  const [modules, churn, rules, pullRequests] = await Promise.all([
    measureModules(repository, scopePath, commit),
    readChurn(repository, commit, scopePath, days),
    provide("review findings", () => (rulesPath === undefined ? Promise.reject(new Error("no --rules file given")) : readHarvestedRules(rulesPath))),
    provide("open pull requests", openPullRequests),
  ]);
  const baselines = await readBaselineEntries(modules.root, modules.tree, modules.scope);
  const signalRows = signals === null ? [] : widestWindowRows(signals);
  const busy = busyFiles(pullRequests.value?.pullRequests ?? [], since);
  const busyIn = (module: ModuleState) => module.files.flatMap((path) => (busy.has(path) ? [{ path, pullRequests: busy.get(path)! }] : []));
  const skipped = modules.modules.flatMap((module) => (busyIn(module).length === module.files.length ? [{ module: module.path, pullRequests: pullRequestsOf(busyIn(module)) }] : []));
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
        busyFiles: busyIn(module),
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
    openPullRequests: pullRequests.value && { repository: pullRequests.value.repository, active: [...new Set([...busy.values()].flat())].length, activeDays },
    skipped,
    busyFiles: busyFilesTheLoopMayTouch(modules, busy),
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

function activeSince(activeDays: number): Date {
  return new Date(Date.now() - activeDays * 86_400_000);
}

function busyFiles(pullRequests: OpenPullRequest[], since: Date): Map<string, number[]> {
  const busy = new Map<string, number[]>();
  for (const { number, files } of pullRequests.filter(({ updatedAt }) => new Date(updatedAt) >= since)) {
    for (const file of new Set(files)) busy.set(file, [...(busy.get(file) ?? []), number].sort((a, b) => a - b));
  }
  return busy;
}

function busyFilesTheLoopMayTouch(modules: ScopeModules, busy: Map<string, number[]>): BusyFile[] {
  const facadeCallers = new Set(modules.modules.flatMap(({ inboundBypasses }) => inboundBypasses.map(({ from }) => from)));
  return [...busy]
    .filter(([path]) => modules.moduleOf(path) !== undefined || facadeCallers.has(path))
    .map(([path, pullRequests]) => ({ path, pullRequests }))
    .sort((a, b) => compare(a.path, b.path));
}

function pullRequestsOf(files: BusyFile[]): number[] {
  return [...new Set(files.flatMap(({ pullRequests }) => pullRequests))].sort((a, b) => a - b);
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
