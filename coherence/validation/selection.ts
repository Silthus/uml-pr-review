import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AttributionRunSchema, type Attribution, type AttributionRun } from "./attribute.ts";
import { shuffled, seededRandom, stratifiedSample } from "./statistics.ts";

export type IndexClass = "improved" | "worsened" | "flat";

export const prThreshold = 0.2;
export const sampleSeed = 94;
export const flatSampleSize = 40;
export const batchSize = 10;
export const attributionFile = join(import.meta.dir, "data", "attribution.json");

export function classOf(delta: number): IndexClass {
  if (delta >= prThreshold) return "improved";
  if (delta <= -prThreshold) return "worsened";
  return "flat";
}

export function sampleStratumOf({ delta }: Attribution): IndexClass {
  return classOf(delta.composite);
}

export function judged(commits: Attribution[]): Attribution[] {
  const moved = commits.filter((commit) => sampleStratumOf(commit) !== "flat");
  const flat = stratifiedSample(commits.filter((commit) => sampleStratumOf(commit) === "flat"), ({ type }) => type, flatSampleSize, sampleSeed);
  return [...moved, ...flat].filter(({ pr }) => pr !== null);
}

export function batches(commits: Attribution[]): Attribution[][] {
  const order = shuffled(commits, seededRandom(sampleSeed));
  return Array.from({ length: Math.ceil(order.length / batchSize) }, (_, index) => order.slice(index * batchSize, (index + 1) * batchSize));
}

export async function readAttribution(file = attributionFile): Promise<AttributionRun> {
  return AttributionRunSchema.parse(JSON.parse(await readFile(file, "utf8")));
}
