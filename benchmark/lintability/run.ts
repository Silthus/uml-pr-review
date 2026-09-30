#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type LabellingStage, type LintabilityWorkspace, preparePackets, prepareRulePackets, status, writeResults } from "./pipeline.ts";
import { liveSources } from "./sources.ts";

const usage = `Usage: bun benchmark/lintability/run.ts <stage> [options]

Stages (each one is resumable: it only packs corrections that still lack a label):
  calibration  write the packet for the 50-row calibration sample
  label        write packets for every development correction without a label
  agreement    write packets for the 60-row sample the second labeller labels
  rules        write the packet that groups caught corrections by general rule
  status       show how many corrections each stage has labelled
  write        write docs/lintability/labels.jsonl, agreement.jsonl, and report.md

Options: --work benchmark/.cache/lintability --posthog ~/posthog`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    work: { type: "string", default: join(import.meta.dir, "..", ".cache", "lintability") },
    posthog: { type: "string", default: join(process.env.HOME ?? "", "posthog") },
  },
});

const root = join(import.meta.dir, "..", "..");
const workspace: LintabilityWorkspace = { corpus: join(root, "docs", "corrections", "corpus.jsonl"), work: resolve(values.work!), docs: join(root, "docs", "lintability") };
const sources = liveSources(workspace.work, resolve(values.posthog!));
const labelling = (stage: LabellingStage) => () => preparePackets(workspace, stage, sources);

const stages: Record<string, () => Promise<string>> = {
  calibration: labelling("calibration"),
  label: labelling("label"),
  agreement: labelling("agreement"),
  rules: () => prepareRulePackets(workspace),
  status: () => status(workspace),
  write: () => writeResults(workspace, sources),
};

const stage = stages[positionals[0] ?? ""];
if (!stage) {
  console.error(usage);
  process.exit(2);
}
console.log(await stage());
