#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { emit, usageError } from "./cli.ts";
import { appendLedger, outcomes, readLedger, type LedgerEntry, type Outcome } from "./ledger.ts";
import { ledgerFile, readIteration, runsDirectoryOf, type Iteration } from "./state.ts";

const usage = `Usage: bun coherence/loop/record.ts --iteration <dir> --outcome ${outcomes.join("|")} [--note <text>]`;

const { values } = parseArgs({ options: { iteration: { type: "string" }, outcome: { type: "string" }, note: { type: "string" } } });

if (!values.iteration || !outcomes.includes(values.outcome as Outcome)) usageError(usage);

await emit(async () => {
  const iteration = await readIteration(resolve(values.iteration!));
  const outcome = values.outcome as Outcome;
  assertRecordable(iteration, outcome);
  const ledger = ledgerFile(runsDirectoryOf(iteration.sense));
  if ((await readLedger(ledger)).some(({ sense, module }) => sense === iteration.senseId && module === iteration.target.module)) {
    throw new Error(`${iteration.target.module} is already recorded for this sense run`);
  }
  const entry = entryFor(iteration, outcome, values.note ?? null);
  await appendLedger(ledger, entry);
  return { ledger, entry };
});

function assertRecordable({ proposal, question }: Iteration, outcome: Outcome): void {
  if (outcome === "proposed" && proposal === null) throw new Error("nothing is proposed yet; run bun coherence/loop/propose.ts first");
  if (outcome === "question" && !question?.raised) throw new Error("no question is raised yet; run bun coherence/inbox.ts raise first");
}

function entryFor(iteration: Iteration, outcome: Outcome, note: string | null): LedgerEntry {
  const index = iteration.verification?.index;
  return {
    at: new Date().toISOString(),
    sense: iteration.senseId,
    scope: iteration.scope,
    module: iteration.target.module,
    step: iteration.target.step,
    verification: iteration.target.verification,
    outcome,
    indexDelta: index === undefined ? null : { scope: index.scope, composite: index.composite, dimensions: index.dimensions },
    questions: iteration.question?.raised ? [iteration.question.raised.url] : [],
    branch: iteration.workspace?.branch ?? null,
    pullRequest: iteration.proposal?.pullRequest ?? iteration.proposal?.body ?? null,
    note,
  };
}
