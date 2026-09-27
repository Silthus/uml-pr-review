import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const judges = ["opus", "astra"] as const;
export type Judge = (typeof judges)[number];

const VerdictSchema = z.object({ pr: z.coerce.number().int(), score: z.coerce.number().int().min(-2).max(2), reason: z.string() });
export type Verdict = z.infer<typeof VerdictSchema>;
export type Verdicts = Record<Judge, Map<number, Verdict>>;

const judgementsDirectory = join(import.meta.dir, "judgements");

export async function readVerdicts(): Promise<Verdicts> {
  const [opus, astra] = await Promise.all(judges.map(verdictsOf));
  return { opus: opus!, astra: astra! };
}

async function verdictsOf(judge: Judge): Promise<Map<number, Verdict>> {
  const directory = join(judgementsDirectory, judge);
  const files = (await readdir(directory).catch(() => [])).filter((file) => /^batch-\d+\.json$/.test(file)).sort();
  const verdicts = await Promise.all(files.map(async (file) => parseVerdicts(await readFile(join(directory, file), "utf8"))));
  return new Map(verdicts.flat().map((verdict) => [verdict.pr, verdict]));
}

export function parseVerdicts(text: string): Verdict[] {
  const array = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  return z.array(VerdictSchema).parse(JSON.parse(array));
}
