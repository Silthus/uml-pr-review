#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { cachedGraphql } from "./github.ts";
import { collect, locate, prepareConfirmation, prepareGaps, prepareFirstPass, prepareRecallCheck, prepareVerification, status, type Workspace, writeCorpus } from "./pipeline.ts";

const usage = `Usage: bun benchmark/corrections/run.ts <stage> [options]

Stages, in order (each one is resumable and re-runnable):
  collect     list merged PRs and fetch their review threads and commits (cached GraphQL)
  comments    filter to human comments on code and write the first-pass packets
  confirm     write the confirmation packets for every first-pass candidate
  gaps        write packets for items a labeller skipped (--stage first-pass or confirm)
  recall      write the recall-check packets (a seeded sample of development negatives)
  locate      fetch PR heads into refs/uml-pr-review/corpus/<n> and locate each fix (needs --posthog)
  verify      write the fix-verification packets with diffs (needs --posthog)
  corpus      write docs/corrections/corpus.jsonl, heldout.sha256, and README.md
  status      show which label batches are still missing

Options: --repo PostHog/posthog --since 2026-03-27 --until 2026-09-26 --work benchmark/.cache/corrections --posthog ~/dev/posthog`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: "string", default: "PostHog/posthog" },
    since: { type: "string", default: "2026-03-27" },
    until: { type: "string", default: "2026-09-26" },
    work: { type: "string", default: join(import.meta.dir, "..", ".cache", "corrections") },
    posthog: { type: "string" },
    stage: { type: "string", default: "first-pass" },
  },
});

const root = join(import.meta.dir, "..", "..");
const workspace: Workspace = { work: resolve(values.work!), labels: join(root, "docs", "corrections", "labels"), docs: join(root, "docs", "corrections") };
const window = { repo: values.repo!, since: values.since!, until: values.until! };
await mkdir(workspace.work, { recursive: true });

function posthog(): string {
  if (!values.posthog) {
    console.error(usage);
    process.exit(2);
  }
  return resolve(values.posthog);
}

const stages: Record<string, () => Promise<string>> = {
  collect: () => collect(workspace, cachedGraphql(workspace.work), window),
  comments: () => prepareFirstPass(workspace),
  confirm: () => prepareConfirmation(workspace),
  gaps: () => prepareGaps(workspace, values.stage === "confirm" ? "confirm" : "first-pass"),
  recall: () => prepareRecallCheck(workspace),
  locate: () => locate(workspace, posthog()),
  verify: () => prepareVerification(workspace, posthog()),
  corpus: () => writeCorpus(workspace, window),
  status: () => status(workspace),
};

const stage = stages[positionals[0] ?? ""];
if (!stage) {
  console.error(usage);
  process.exit(2);
}
console.log(await stage());
