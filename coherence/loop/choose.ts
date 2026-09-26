#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { emit, usageError } from "./cli.ts";
import { readLedger } from "./ledger.ts";
import { chooseNext } from "./selection.ts";
import { iterationDirectory, iterationSlug, ledgerFile, readSense, runsDirectoryOf, writeIteration } from "./state.ts";

const usage = "Usage: bun coherence/loop/choose.ts --sense <file>";

const { values } = parseArgs({ options: { sense: { type: "string" } } });

if (!values.sense) usageError(usage);

await emit(async () => {
  const sensePath = resolve(values.sense!);
  const sense = await readSense(sensePath);
  const choice = chooseNext(sense, await readLedger(ledgerFile(runsDirectoryOf(sensePath))));
  if (choice.action === "done") return choice;
  const slug = iterationSlug(sense.scope, choice.target.module, choice.target.step);
  const iteration = iterationDirectory(sensePath, slug);
  await writeIteration(iteration, {
    sense: sensePath,
    senseId: sense.id,
    repository: sense.repository,
    scope: sense.scope,
    scopeName: sense.scopeName,
    rules: sense.rules,
    base: sense.base,
    slug,
    action: choice.action,
    target: choice.target,
    answer: choice.action === "act" ? choice.answer : null,
    question: choice.action === "ask" ? choice.question : null,
    workspace: null,
    verification: null,
    proposal: null,
  });
  return { iteration, ...choice };
});
