import { z } from "zod";
import type { JudgeDimension, JudgeVerdict } from "./composite.ts";
import { parsePatch } from "./patch.ts";

export const judgeLabels = ["X", "Y", "Z", "W", "V", "U", "T", "S"] as const;
export const dimensions: { key: JudgeDimension; question: string }[] = [
  { key: "seams", question: "Seams and interfaces: does the change cross module boundaries through deliberate, narrow interfaces?" },
  { key: "cohesion", question: "Cohesion and module placement: does each new piece of code live in the module that owns its concern?" },
  { key: "coupling", question: "Coupling: does the change avoid new dependencies, and reaching into other modules' internals?" },
  { key: "fit", question: "Repository architecture fit: does the change follow PostHog's documented product architecture (products/architecture.md)?" },
  { key: "overall", question: "Overall architecture quality of the change, as a reviewer who owns this codebase would rate it." },
];

const diffBudget = 60_000;
const documentBudget = 60_000;

export type JudgeKey = { seed: number; labels: Record<string, string> };
export type LabelledDiff = { label: string; patch: string };

export function shuffledKey(runNames: string[], seed: number): JudgeKey {
  if (runNames.length > judgeLabels.length) throw new Error(`The judge takes at most ${judgeLabels.length} diffs per task, got ${runNames.length}.`);
  const random = mulberry32(seed);
  const order = [...runNames];
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  return { seed, labels: Object.fromEntries(order.map((name, index) => [judgeLabels[index]!, name])) };
}

export function judgePrompt({ taskStatement, architecture, diffs }: { taskStatement: string; architecture: string; diffs: LabelledDiff[] }): string {
  const labels = diffs.map(({ label }) => label).join(", ");
  return [
    "You are reviewing the architecture of independent implementations of the same task in the PostHog monorepo. Each implementation is a diff against the same base commit. You do not know who or what wrote them; judge only the diffs.",
    `## Task\n\n${taskStatement.trim()}`,
    `## PostHog's architecture rules (products/architecture.md at the base commit)\n\n${truncated(architecture, documentBudget, "document")}`,
    ...diffs.map(diffSection),
    "## How to score",
    `Score every diff (${labels}) from 1 (poor) to 10 (excellent) on each dimension, and justify every score in one to three sentences that cite files or imports from the diff:`,
    dimensions.map(({ key, question }) => `- \`${key}\`: ${question}`).join("\n"),
    "Judge architecture, not completeness of features or test coverage. A diff that is truncated here was truncated for length; judge what you can see and its file list. Answer with JSON only, matching the schema you were given.",
  ].join("\n\n");
}

export function verdictSchema(labels: string[]): object {
  const scored = { type: "object", additionalProperties: false, required: ["score", "justification"], properties: { score: { type: "integer", minimum: 1, maximum: 10 }, justification: { type: "string" } } };
  const verdict = {
    type: "object",
    additionalProperties: false,
    required: ["label", ...dimensions.map(({ key }) => key)],
    properties: { label: { type: "string", enum: labels }, ...Object.fromEntries(dimensions.map(({ key }) => [key, scored])) },
  };
  return { type: "object", additionalProperties: false, required: ["verdicts"], properties: { verdicts: { type: "array", items: verdict } } };
}

const ScoredSchema = z.object({ score: z.number().int().min(1).max(10), justification: z.string() });
const VerdictsSchema = z.object({
  verdicts: z.array(z.object({ label: z.string(), seams: ScoredSchema, cohesion: ScoredSchema, coupling: ScoredSchema, fit: ScoredSchema, overall: ScoredSchema })),
});

export function unshuffledVerdicts(output: string, key: JudgeKey): Record<string, JudgeVerdict> {
  const { verdicts } = VerdictsSchema.parse(JSON.parse(output));
  const byRun = Object.fromEntries(verdicts.map(({ label, ...verdict }) => [runFor(key, label), verdict]));
  const missing = Object.values(key.labels).filter((run) => !(run in byRun));
  if (missing.length > 0) throw new Error(`The judge did not score ${missing.join(", ")}.`);
  return byRun;
}

function runFor(key: JudgeKey, label: string): string {
  const run = key.labels[label];
  if (!run) throw new Error(`The judge scored an unknown label ${label}.`);
  return run;
}

function diffSection({ label, patch }: LabelledDiff): string {
  const files = parsePatch(patch);
  const list = files.map((file) => `- ${file.path} (${file.status}, +${file.added} -${file.removed})`).join("\n") || "- (no changes)";
  return `## Diff ${label}\n\nFiles:\n${list}\n\n\`\`\`diff\n${truncated(patch, diffBudget, "diff")}\n\`\`\``;
}

function truncated(text: string, budget: number, noun: string): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, budget)}\n[${noun} truncated: showing the first ${budget} of ${text.length} characters]`;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
