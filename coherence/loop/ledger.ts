import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const ScoreChangeSchema = z.object({ before: z.number().nullable(), after: z.number().nullable() });

export const IndexDeltaSchema = z.object({
  scope: z.string(),
  composite: ScoreChangeSchema,
  dimensions: z.record(z.string(), ScoreChangeSchema),
});

export const outcomes = ["proposed", "question", "abandoned"] as const;
export const OutcomeSchema = z.enum(outcomes);

export const LedgerEntrySchema = z.object({
  at: z.iso.datetime(),
  sense: z.string(),
  scope: z.string(),
  module: z.string(),
  step: z.string(),
  verification: z.string(),
  outcome: OutcomeSchema,
  indexDelta: IndexDeltaSchema.nullable(),
  questions: z.array(z.string()),
  branch: z.string().nullable(),
  pullRequest: z.string().nullable(),
  note: z.string().nullable(),
});

export type IndexDelta = z.infer<typeof IndexDeltaSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export async function readLedger(path: string): Promise<LedgerEntry[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const lines = (await file.text()).split("\n").filter((line) => line.trim() !== "");
  return lines.map((line, index) => {
    const parsed = LedgerEntrySchema.safeParse(JSON.parse(line));
    if (!parsed.success) throw new Error(`${path}:${index + 1} is not a ledger entry: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  });
}

export async function appendLedger(path: string, entry: LedgerEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(LedgerEntrySchema.parse(entry))}\n`);
}
