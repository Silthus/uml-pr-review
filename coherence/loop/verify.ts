#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { emit, usageError, wholeNumber } from "./cli.ts";
import { readIteration, writeIteration } from "./state.ts";
import { defaultMaxLines, verify } from "./verification.ts";

const usage = "Usage: bun coherence/loop/verify.ts --iteration <dir> [--max-lines <n>]";

const { values } = parseArgs({ options: { iteration: { type: "string" }, "max-lines": { type: "string", default: String(defaultMaxLines) } } });

if (!values.iteration) usageError(usage);

await emit(async () => {
  const directory = resolve(values.iteration!);
  const iteration = await readIteration(directory);
  const verification = await verify(iteration, wholeNumber(values["max-lines"], "max-lines"));
  await writeIteration(directory, { ...iteration, verification, proposal: null });
  return { ...verification, tests: verification.tests.map(({ output, ...run }) => ({ ...run, output: output.slice(-500) })) };
});
