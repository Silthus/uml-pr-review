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
export const verificationLabelSchema = z.object({ id: z.string(), addressed: z.enum(["yes", "partly", "no", "unverifiable"]), note: z.string().max(200) });

export type FirstPassLabel = z.infer<typeof firstPassLabelSchema>;
export type ConfirmationLabel = z.infer<typeof confirmationLabelSchema>;
export type VerificationLabel = z.infer<typeof verificationLabelSchema>;

export const labelStages = { firstPass: "first-pass", confirm: "confirm", recall: "recall", verification: "verification" } as const;

export async function readLabels<T extends { id: string }>(labelsRoot: string, stage: string, schema: z.ZodType<T>): Promise<Map<string, T>> {
  const directory = join(labelsRoot, stage);
  await mkdir(directory, { recursive: true });
  return new Map((await readJsonFiles(directory, schema)).map((label) => [label.id, label]));
}

export function unlabelled<T extends { id: string }>(ids: readonly string[], labels: Map<string, unknown>): string[] {
  return ids.filter((id) => !labels.has(id));
}

export type Estimate = { value: number; low: number; high: number };

export function recallEstimate({ confirmed, negatives, sampled, missed }: { confirmed: number; negatives: number; sampled: number; missed: number }): Estimate {
  const recallAt = (missRate: number) => confirmed / (confirmed + missRate * negatives);
  const interval = wilson(missed, sampled);
  return { value: recallAt(missed / sampled), low: recallAt(interval.high), high: recallAt(interval.low) };
}

export function wilson(successes: number, trials: number, z = 1.96): { low: number; high: number } {
  const share = successes / trials;
  const centre = share + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((share * (1 - share)) / trials + (z * z) / (4 * trials * trials));
  const denominator = 1 + (z * z) / trials;
  return { low: (centre - margin) / denominator, high: (centre + margin) / denominator };
}
