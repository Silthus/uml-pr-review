#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { corpusCommentSchema, splits, type Split } from "../corrections/comments.ts";
import { readLabels, verificationLabelSchema, type VerificationLabel } from "../corrections/labels.ts";
import { writeVerificationPackets } from "../corrections/verify.ts";
import { isolatedFixes, readCorpus, stableOrder, type IsolatedFix } from "./corpus.ts";

const verificationLabels = join(import.meta.dir, "verification");
const batchSize = 20;

export async function readVerifications(split: Split): Promise<Map<string, VerificationLabel>> {
  return readLabels(verificationLabels, split, verificationLabelSchema);
}

export function addressed(fix: IsolatedFix, verifications: Map<string, VerificationLabel>): boolean | undefined {
  const answer = verifications.get(fix.id)?.addressed ?? fix.verified;
  if (answer === null || answer === undefined) return undefined;
  return answer === "yes" || answer === "partly";
}

async function writePackets(posthog: string, work: string, split: Split): Promise<string> {
  const comments = new Map(z.array(corpusCommentSchema).parse(await Bun.file(join(work, "comments.json")).json()).map((comment) => [comment.id, comment]));
  const verifications = await readVerifications(split);
  const pending = stableOrder(isolatedFixes(await readCorpus(), split), `100:${split}`).filter((fix) => fix.verified === null && !verifications.has(fix.id));
  const directory = join(work, "..", "grader", "packets", split);
  await mkdir(directory, { recursive: true });
  const located = pending.map((fix) => ({ comment: comments.get(fix.id)!, fix: { id: fix.id, fix: fix.fix, before: fix.before, commentCommit: fix.commentCommit, isolable: true, commitsMissing: 0 } }));
  const names = await writeVerificationPackets(posthog, directory, located, batchSize);
  return `${pending.length} unverified ${split} fixes in ${names.length} packets under ${directory}`;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      posthog: { type: "string" },
      split: { type: "string" },
      work: { type: "string", default: join(import.meta.dir, "..", ".cache", "corrections") },
    },
  });
  const split = z.enum(splits).safeParse(values.split);
  if (!values.posthog || !split.success) {
    console.error("Usage: bun benchmark/grader/verification.ts --posthog ~/dev/posthog --split development|heldout [--work benchmark/.cache/corrections]");
    process.exit(2);
  }
  console.log(await writePackets(resolve(values.posthog), resolve(values.work!), split.data));
}
