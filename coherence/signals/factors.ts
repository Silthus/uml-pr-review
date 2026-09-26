import type { ChurnedCommit } from "./churn.ts";
import type { ModuleState } from "./modules.ts";
import type { Attribution, SignalKind, SignalReport, SignalRow } from "./report.ts";
import { findingSources, type HarvestedRule } from "./rules.ts";

export type Component = { name: string; raw: number | null; value: number | null; basis: string; evidence: string[] };
export type Factor = { value: number; combination: "mean" | "any" | "product"; components: Component[] };
export type Factors = { pressure: Factor; pain: Factor; safety: Factor };
export type CoveringRule = HarvestedRule & { share: number };

export type ModuleEvidence = {
  module: ModuleState;
  commits: ChurnedCommit[];
  rules: CoveringRule[] | null;
  signals: SignalRow[];
  signalReport: SignalReport | null;
};

type SignalComponent = { name: string; signals: SignalKind[]; aggregate: "sum" | "max"; half: number };

export const halfSaturation = { commits: 10, lines: 1000, authors: 3, reviewFindings: 10, complexFunctions: 5, architectureViolations: 3, traffic: 100_000 } as const;
export const complexThreshold = 10;

const attributionWeight: Record<Attribution, number> = { exact: 1, route: 1, service: 0.5 };
const evidenceLimit = 5;

const painSignals: SignalComponent[] = [
  { name: "ci flakiness", signals: ["ci.test_failures", "ci.test_retries"], aggregate: "sum", half: 10 },
  { name: "production errors", signals: ["errors.occurrences"], aggregate: "sum", half: 100 },
  { name: "apm errors", signals: ["apm.error_rate"], aggregate: "max", half: 0.02 },
  { name: "error logs", signals: ["logs.warn_error_lines"], aggregate: "sum", half: 1000 },
];

const trafficSignals: SignalComponent = { name: "traffic", signals: ["apm.requests", "usage.pageviews"], aggregate: "sum", half: halfSaturation.traffic };

export const scoredSignals: SignalKind[] = [...painSignals, trafficSignals].flatMap(({ signals }) => signals);

export function saturate(raw: number, half: number): number {
  return raw / (raw + half);
}

export function factorsOf(evidence: ModuleEvidence): Factors {
  return { pressure: pressureOf(evidence), pain: painOf(evidence), safety: safetyOf(evidence) };
}

function pressureOf({ commits }: ModuleEvidence): Factor {
  const lines = commits.reduce((total, { files }) => total + files.reduce((sum, file) => sum + file.lines, 0), 0);
  const authors = new Set(commits.map(({ author }) => author)).size;
  const agentCommits = commits.filter(({ agent }) => agent).length;
  return mean([
    counted("commits", commits.length, halfSaturation.commits, [
      ...commits.slice(0, evidenceLimit).map(({ sha }) => sha.slice(0, 12)),
      ...(agentCommits > 0 ? [`${agentCommits} of ${commits.length} co-authored by an agent`] : []),
    ]),
    counted("lines", lines, halfSaturation.lines, []),
    counted("authors", authors, halfSaturation.authors, []),
  ]);
}

function painOf(evidence: ModuleEvidence): Factor {
  return any([reviewFindingsOf(evidence), complexityOf(evidence.module), architectureOf(evidence.module), ...painSignals.map((component) => signalComponent(component, evidence))]);
}

function reviewFindingsOf({ rules }: ModuleEvidence): Component {
  if (rules === null) return unavailable("review findings", "no harvested rules");
  const cited = rules.map((rule) => ({ rule, findings: rule.evidence.filter(({ source }) => findingSources.has(source)) })).filter(({ findings }) => findings.length > 0);
  const shareOfFinding = new Map<string, number>();
  for (const { rule, findings } of cited) for (const { url } of findings) shareOfFinding.set(url, Math.max(shareOfFinding.get(url) ?? 0, rule.share));
  const total = [...shareOfFinding.values()].reduce((sum, share) => sum + share, 0);
  return {
    ...counted("review findings", round(total), halfSaturation.reviewFindings, cited.map(({ rule, findings }) => `${rule.id}: ${findings.length} findings × ${round(rule.share)} of its component, e.g. ${findings[0]!.url}`)),
    basis: `Σ distinct findings × the module's share of the citing rule's component / (that + ${halfSaturation.reviewFindings})`,
  };
}

function complexityOf({ complexity }: ModuleState): Component {
  if (complexity === null) return unavailable("complexity", "complexity tools failed");
  const complex = complexity.drivers.filter(({ ccn }) => ccn > complexThreshold);
  return counted(
    "complexity",
    complexity.functions.overTen,
    halfSaturation.complexFunctions,
    complex.slice(0, evidenceLimit).map(({ file, function: name, ccn }) => `${file}:${name} CCN ${ccn}`),
  );
}

function architectureOf(module: ModuleState): Component {
  const bypasses = [...module.inboundBypasses, ...module.outboundBypasses].map(({ from, to, direction }) => `${direction} facade bypass ${from} -> ${to}`);
  const cycles = module.cycleFiles.map((file) => `on an import cycle: ${file}`);
  return counted("architecture", bypasses.length + cycles.length, halfSaturation.architectureViolations, [...bypasses, ...cycles].slice(0, evidenceLimit));
}

function safetyOf(evidence: ModuleEvidence): Factor {
  const { testedFiles, untestedFiles } = evidence.module;
  const testable = testedFiles.length + untestedFiles.length;
  const share = testable === 0 ? 0 : testedFiles.length / testable;
  const tests: Component = {
    name: "tests",
    raw: round(share),
    value: round(0.5 + 0.5 * share),
    basis: "0.5 + 0.5 × share of the module's files, stories aside, that a test imports",
    evidence: [`${testedFiles.length} of ${testable} files imported by tests`],
  };
  const traffic = signalComponent(trafficSignals, evidence);
  const damped: Component = traffic.raw === null ? traffic : { ...traffic, value: round(1 - 0.5 * saturate(traffic.raw, trafficSignals.half)), basis: `1 − 0.5 × traffic / (traffic + ${trafficSignals.half})` };
  return product([tests, damped]);
}

function signalComponent({ name, signals, aggregate, half }: SignalComponent, { signals: rows, signalReport }: ModuleEvidence): Component {
  const reason = unavailableReason(signals, signalReport);
  if (reason !== null) return unavailable(name, reason);
  const matching = rows.filter(({ signal }) => signals.includes(signal));
  const weighted = matching.map((row) => row.value * attributionWeight[row.attribution]);
  const raw = aggregate === "sum" ? weighted.reduce((total, value) => total + value, 0) : Math.max(0, ...weighted);
  return {
    name,
    raw: round(raw),
    value: round(saturate(raw, half)),
    basis: `${aggregate} of ${signals.join(" + ")} (service rows count half) / (that + ${half})`,
    evidence: matching.slice(0, evidenceLimit).map(({ path, signal, value, window, attribution }) => `${path}: ${signal} ${value} (${window}, ${attribution})`),
  };
}

export function unavailableReason(signals: SignalKind[], report: SignalReport | null): string | null {
  if (report === null) return "no --posthog-signals report given";
  const missing = signals.map((signal) => report.unavailable.find((entry) => entry.signal === signal));
  return missing.every((entry) => entry !== undefined) ? missing.map((entry) => entry!.reason).join("; ") : null;
}

function counted(name: string, raw: number, half: number, evidence: string[]): Component {
  return { name, raw, value: round(saturate(raw, half)), basis: `${name} / (${name} + ${half})`, evidence };
}

function unavailable(name: string, reason: string): Component {
  return { name, raw: null, value: null, basis: `unavailable: ${reason}`, evidence: [] };
}

function available(components: Component[]): number[] {
  return components.flatMap(({ value }) => (value === null ? [] : [value]));
}

function mean(components: Component[]): Factor {
  const values = available(components);
  return { value: round(values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length), combination: "mean", components };
}

function any(components: Component[]): Factor {
  return { value: round(1 - available(components).reduce((none, value) => none * (1 - value), 1)), combination: "any", components };
}

function product(components: Component[]): Factor {
  return { value: round(available(components).reduce((total, value) => total * value, 1)), combination: "product", components };
}

export function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
