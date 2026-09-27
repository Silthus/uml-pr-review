import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { detectorNames } from "./violations.ts";

export const defaultConfigFile = join(import.meta.dir, "config.json");

export const GraderConfigSchema = z.object({
  detectors: z.array(z.enum(detectorNames)),
  weights: z.partialRecord(z.enum(detectorNames), z.number()),
  cycles: z.object({ maxCycleLength: z.number().int().min(2) }),
  complexity: z.object({ ccnThresholds: z.array(z.number().int().positive()), nlocThreshold: z.number().int().positive() }),
  clones: z.object({ windowTokens: z.number().int().positive(), winnow: z.number().int().positive(), maxFiles: z.number().int().positive(), minFingerprints: z.number().int().positive(), gapLines: z.number().int().nonnegative() }),
  reuse: z.object({ minNameLength: z.number().int().positive(), maxDefinitions: z.number().int().positive() }),
  vocabulary: z.object({ termFiles: z.string() }),
});

export type GraderConfig = z.infer<typeof GraderConfigSchema>;

export async function readConfig(file = defaultConfigFile): Promise<GraderConfig> {
  return GraderConfigSchema.parse(await Bun.file(file).json());
}

export async function configDigest(file = defaultConfigFile): Promise<string> {
  return createHash("sha256").update(await Bun.file(file).text()).digest("hex");
}

export function weightOf(config: GraderConfig, detector: (typeof detectorNames)[number]): number {
  return config.weights[detector] ?? 1;
}
