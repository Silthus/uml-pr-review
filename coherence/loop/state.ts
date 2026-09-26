import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { TargetReport } from "../signals/rank.ts";
import type { Verification } from "./verification.ts";

export const defaultRunsDirectory = join(import.meta.dir, "..", "runs");

export const QuestionSchema = z.object({
  number: z.number().int(),
  url: z.string(),
  title: z.string(),
  scope: z.string(),
  module: z.string(),
  step: z.string(),
  state: z.enum(["open", "resolved"]),
  answer: z.string().nullable(),
});

const BaseSchema = z.object({ ref: z.string(), commit: z.string() });

export const SenseSchema = z.object({
  id: z.iso.datetime(),
  repository: z.string(),
  scope: z.string(),
  scopeName: z.string(),
  base: BaseSchema,
  budget: z.number().int().positive(),
  maxQuestions: z.number().int().nonnegative(),
  rules: z.string(),
  signals: z.string().nullable(),
  questions: z.array(QuestionSchema),
  report: z.custom<TargetReport>((value) => typeof value === "object" && value !== null && "targets" in value),
});

const BusyFileSchema = z.object({ path: z.string(), pullRequests: z.array(z.number().int()) });

export const ChosenTargetSchema = z.object({
  rank: z.number().int(),
  module: z.string(),
  score: z.number(),
  step: z.enum(["facade", "characterisation-tests", "ratchet-rule", "internal-cleanup"]),
  verification: z.enum(["mechanical", "behaviour-adjacent", "boundary"]),
  reason: z.string(),
  evidence: z.array(z.string()),
  busyFiles: z.array(BusyFileSchema),
});

export const QuestionDraftSchema = z.object({
  title: z.string(),
  question: z.string(),
  context: z.string(),
  options: z.array(z.string()).min(2),
  raised: z.object({ number: z.number().int(), url: z.string() }).nullable(),
});

export const IterationSchema = z.object({
  sense: z.string(),
  senseId: z.string(),
  repository: z.string(),
  scope: z.string(),
  scopeName: z.string(),
  rules: z.string(),
  base: BaseSchema,
  slug: z.string(),
  busyFiles: z.array(BusyFileSchema),
  action: z.enum(["act", "ask"]),
  target: ChosenTargetSchema,
  answer: QuestionSchema.nullable(),
  question: QuestionDraftSchema.nullable(),
  workspace: z.object({ path: z.string(), branch: z.string() }).nullable(),
  verification: z.custom<Verification>((value) => typeof value === "object" && value !== null && "verdict" in value).nullable(),
  proposal: z.object({ mode: z.enum(["dry-run", "draft"]), body: z.string(), pullRequest: z.string().nullable() }).nullable(),
});

export type Question = z.infer<typeof QuestionSchema>;
export type Sense = z.infer<typeof SenseSchema>;
export type ChosenTarget = z.infer<typeof ChosenTargetSchema>;
export type QuestionDraft = z.infer<typeof QuestionDraftSchema>;
export type Iteration = z.infer<typeof IterationSchema>;

export function scopeName(scope: string): string {
  return /^(?:\.\/)?products\/([^/]+)/.exec(scope)?.[1] ?? basename(resolve(scope));
}

export function iterationSlug(scope: string, module: string, step: string): string {
  const relative = module === scope ? "root" : module.startsWith(`${scope}/`) ? module.slice(scope.length + 1) : module;
  return `${relative}-${step}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function senseFile(runsDirectory: string, day: string, name: string): string {
  return join(runsDirectory, day, `${name}.sense.json`);
}

export function iterationDirectory(sensePath: string, slug: string): string {
  return join(dirname(sensePath), slug);
}

export function runsDirectoryOf(sensePath: string): string {
  return dirname(dirname(sensePath));
}

export function ledgerFile(runsDirectory: string): string {
  return join(runsDirectory, "ledger.jsonl");
}

export async function readSense(path: string): Promise<Sense> {
  return parseFile(path, SenseSchema);
}

export async function readIteration(directory: string): Promise<Iteration> {
  return parseFile(join(directory, "iteration.json"), IterationSchema);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeIteration(directory: string, iteration: Iteration): Promise<void> {
  await writeJson(join(directory, "iteration.json"), iteration);
}

async function parseFile<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`${path} does not exist`);
  const parsed = schema.safeParse(await file.json());
  if (!parsed.success) throw new Error(`${path} is malformed: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
