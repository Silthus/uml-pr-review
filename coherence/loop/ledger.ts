import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { git, run } from "../../src/git.ts";

const ScoreChangeSchema = z.object({ before: z.number().nullable(), after: z.number().nullable() });

export const IndexDeltaSchema = z.object({
  scope: z.string(),
  composite: ScoreChangeSchema,
  dimensions: z.record(z.string(), ScoreChangeSchema),
});

export const outcomes = ["proposed", "question", "abandoned"] as const;
export const OutcomeSchema = z.enum(outcomes);
export const ProposalModeSchema = z.enum(["dry-run", "draft"]);

export const LedgerEntrySchema = z.object({
  at: z.iso.datetime(),
  sense: z.string(),
  scope: z.string(),
  module: z.string(),
  step: z.string(),
  verification: z.string(),
  outcome: OutcomeSchema,
  mode: ProposalModeSchema.nullable(),
  indexDelta: IndexDeltaSchema.nullable(),
  questions: z.array(z.string()),
  branch: z.string().nullable(),
  pullRequest: z.string().nullable(),
  note: z.string().nullable(),
});

const PullRequestStateSchema = z.object({ state: z.enum(["OPEN", "CLOSED", "MERGED"]), mergeCommit: z.object({ oid: z.string() }).nullable() });

export type IndexDelta = z.infer<typeof IndexDeltaSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type ProposalMode = z.infer<typeof ProposalModeSchema>;
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type SensedRun = { id: string; scope: string; repository: string; base: { commit: string } };

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
  await appendFile(path, serialized(entry));
}

export async function recordPromotion(path: string, { sense, module }: { sense: string; module: string }, pullRequest: string): Promise<LedgerEntry | null> {
  const entries = await readLedger(path);
  const index = entries.findIndex((entry) => entry.sense === sense && entry.module === module && entry.outcome === "proposed");
  if (index === -1) return null;
  const promoted: LedgerEntry = { ...entries[index]!, mode: "draft", pullRequest };
  entries[index] = promoted;
  await Bun.write(path, entries.map(serialized).join(""));
  return promoted;
}

export async function modulesHeldByEarlierRuns(entries: LedgerEntry[], sense: SensedRun): Promise<Set<string>> {
  const earlier = entries.filter((entry) => entry.scope === sense.scope && entry.sense !== sense.id && entry.outcome === "proposed");
  const held = await Promise.all(earlier.map(async (entry) => ((await isPending(entry, sense)) ? [entry.module] : [])));
  return new Set(held.flat());
}

function isPending(entry: LedgerEntry, sense: SensedRun): Promise<boolean> {
  if (entry.mode === "draft" && entry.pullRequest !== null) return isPullRequestPending(entry.pullRequest, sense);
  return entry.branch === null ? Promise.resolve(false) : branchExists(sense.repository, entry.branch);
}

async function isPullRequestPending(url: string, { repository, base }: SensedRun): Promise<boolean> {
  const { state, mergeCommit } = PullRequestStateSchema.parse(JSON.parse(await run(repository, ["gh", "pr", "view", url, "--json", "state,mergeCommit"])));
  if (state === "OPEN") return true;
  if (state === "CLOSED" || mergeCommit === null) return false;
  return !(await isAncestor(repository, mergeCommit.oid, base.commit));
}

function branchExists(repository: string, branch: string): Promise<boolean> {
  return succeeds(git(repository, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]));
}

function isAncestor(repository: string, commit: string, descendant: string): Promise<boolean> {
  return succeeds(git(repository, ["merge-base", "--is-ancestor", commit, descendant]));
}

function succeeds(command: Promise<unknown>): Promise<boolean> {
  return command.then(
    () => true,
    () => false,
  );
}

function serialized(entry: LedgerEntry): string {
  return `${JSON.stringify(LedgerEntrySchema.parse(entry))}\n`;
}
