#!/usr/bin/env bun
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { emit, usageError } from "./cli.ts";
import { appendLedger, outcomes, OutcomeSchema, readLedger, type LedgerEntry, type Outcome } from "./ledger.ts";
import { ledgerFile, readIteration, runsDirectoryOf, type Iteration } from "./state.ts";

const usage = `Usage: bun coherence/loop/record.ts --iteration <dir> --outcome ${outcomes.join("|")} [--note <text>]`;

const { values } = parseArgs({ options: { iteration: { type: "string" }, outcome: { type: "string" }, note: { type: "string" } } });

const outcome = OutcomeSchema.safeParse(values.outcome);

if (!values.iteration || !outcome.success) usageError(usage);

await emit(async () => {
  const iteration = await readIteration(resolve(values.iteration!));
  assertRecordable(iteration, outcome.data);
  const runs = runsDirectoryOf(iteration.sense);
  const ledger = ledgerFile(runs);
  if ((await readLedger(ledger)).some(({ sense, module }) => sense === iteration.senseId && module === iteration.target.module)) {
    throw new Error(`${iteration.target.module} is already recorded for this sense run`);
  }
  const entry = entryFor(iteration, outcome.data, values.note ?? null, runs);
  await appendLedger(ledger, entry);
  return { ledger, entry };
});

function assertRecordable({ proposal, question }: Iteration, outcome: Outcome): void {
  if (outcome === "proposed" && proposal === null) throw new Error("nothing is proposed yet; run bun coherence/loop/propose.ts first");
  if (outcome === "question" && !question?.raised) throw new Error("no question is raised yet; run bun coherence/inbox.ts raise first");
}

function entryFor(iteration: Iteration, outcome: Outcome, note: string | null, runsDirectory: string): LedgerEntry {
  const index = iteration.verification?.index;
  return {
    at: new Date().toISOString(),
    sense: iteration.senseId,
    scope: iteration.scope,
    module: iteration.target.module,
    step: iteration.target.step,
    verification: iteration.target.verification,
    outcome,
    mode: outcome === "proposed" ? (iteration.proposal?.mode ?? null) : null,
    indexDelta: index === undefined ? null : { scope: index.scope, composite: index.composite, dimensions: index.dimensions },
    questions: iteration.question?.raised ? [iteration.question.raised.url] : [],
    branch: iteration.workspace?.branch ?? null,
    pullRequest: iteration.proposal === null ? null : (iteration.proposal.pullRequest ?? relative(runsDirectory, iteration.proposal.body)),
    note,
  };
}
