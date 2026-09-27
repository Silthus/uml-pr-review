import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readJsonFiles } from "../../coherence/validation/corrections.ts";

export const subtypes = ["reuse", "layer", "facade-boundary", "dependency", "duplication", "split-merge", "naming", "other"] as const;
export type Subtype = (typeof subtypes)[number];

export const firstPassLabelSchema = z.object({ id: z.string(), candidate: z.boolean() });
export const confirmationLabelSchema = z.union([
  z.object({ id: z.string(), architecture: z.literal(true), subtype: z.enum(subtypes), quote: z.string().min(1).max(200) }),
  z.object({ id: z.string(), architecture: z.literal(false), subtype: z.literal("none"), quote: z.literal("") }),
]);
export const answers = ["yes", "partly", "no", "unverifiable"] as const;
export const verificationLabelSchema = z.object({ id: z.string(), addressed: z.enum(answers), note: z.string().max(200) });

export type FirstPassLabel = z.infer<typeof firstPassLabelSchema>;
export type ConfirmationLabel = z.infer<typeof confirmationLabelSchema>;
export type VerificationLabel = z.infer<typeof verificationLabelSchema>;
export type Answer = (typeof answers)[number];

export const labelStages = { firstPass: "first-pass", confirm: "confirm", recall: "recall", verification: "verification" } as const;

type Resolve<T> = (kept: T, repeated: T) => T;

export const keepAnyCandidate: Resolve<FirstPassLabel> = (kept, repeated) => (kept.candidate ? kept : repeated);

export async function readLabels<T extends { id: string }>(labelsRoot: string, stage: string, schema: z.ZodType<T>, resolve: Resolve<T> = refuseConflicts): Promise<Map<string, T>> {
  const directory = join(labelsRoot, stage);
  await mkdir(directory, { recursive: true });
  const labels = new Map<string, T>();
  for (const label of await readJsonFiles(directory, schema)) {
    const kept = labels.get(label.id);
    labels.set(label.id, kept === undefined ? label : resolve(kept, label));
  }
  return labels;
}

function refuseConflicts<T extends { id: string }>(kept: T, repeated: T): T {
  if (JSON.stringify(kept) !== JSON.stringify(repeated)) throw new Error(`conflicting labels for ${kept.id}: ${JSON.stringify(kept)} and ${JSON.stringify(repeated)}`);
  return kept;
}

export function unlabelled(ids: readonly string[], labels: Map<string, unknown>): string[] {
  return ids.filter((id) => !labels.has(id));
}

export function strays(labels: Map<string, unknown>, ids: ReadonlySet<string>): string[] {
  return [...labels.keys()].filter((id) => !ids.has(id));
}

export type Estimate = { value: number; low: number; high: number };

export function recallEstimate({ confirmed, negatives, sampled, missed }: { confirmed: number; negatives: number; sampled: number; missed: number }): Estimate {
  const recallAt = (missRate: number) => confirmed / (confirmed + missRate * negatives);
  const interval = wilson(missed, sampled);
  return { value: recallAt(missed / sampled), low: recallAt(interval.high), high: recallAt(interval.low) };
}

export type Precision = { sampled: number; answers: Record<Answer, number>; strict: Estimate; lenient: Estimate };

export function precision(given: readonly Answer[]): Precision {
  const count = (answer: Answer) => given.filter((each) => each === answer).length;
  const share = (successes: number): Estimate => ({ value: successes / given.length, ...wilson(successes, given.length) });
  return {
    sampled: given.length,
    answers: { yes: count("yes"), partly: count("partly"), no: count("no"), unverifiable: count("unverifiable") },
    strict: share(count("yes")),
    lenient: share(count("yes") + count("partly")),
  };
}

export function wilson(successes: number, trials: number, z = 1.96): { low: number; high: number } {
  const share = successes / trials;
  const centre = share + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((share * (1 - share)) / trials + (z * z) / (4 * trials * trials));
  const denominator = 1 + (z * z) / trials;
  return { low: (centre - margin) / denominator, high: (centre + margin) / denominator };
}
