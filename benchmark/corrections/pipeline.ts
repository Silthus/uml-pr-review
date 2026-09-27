import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { seededRandom, shuffled } from "../../coherence/validation/statistics.ts";
import { type CollectedPullRequest, collectedPullRequestSchema, collectPullRequests, type Window } from "./collect.ts";
import { codeComments, type CorpusComment, corpusCommentSchema, heldOutFrom, type Split, splitOf, splits, tally, writePackets } from "./comments.ts";
import { corpusRows, heldOutDigest, jsonLines } from "./corpus.ts";
import { type Fix, fixSchema, locateFixes } from "./fixes.ts";
import { budgetFile, type Graphql } from "./github.ts";
import { confirmationLabelSchema, firstPassLabelSchema, labelStages, readLabels, recallEstimate, unlabelled, verificationLabelSchema, wilson } from "./labels.ts";
import { readme } from "./report.ts";
import { type Located, writeVerificationPackets } from "./verify.ts";

export type Workspace = { work: string; labels: string; docs: string };

const sizes = { firstPass: 60, confirm: 50, recall: 50, verify: 10 };
const samples = { recall: 200, verify: 50, seed: 98 };

const files = {
  pullRequests: "pull-requests.json",
  comments: "comments.json",
  fixes: "fixes.json",
};

export async function collect(workspace: Workspace, graphql: Graphql, window: Window): Promise<string> {
  const pullRequests = await collectPullRequests(graphql, window);
  await writeFile(join(workspace.work, files.pullRequests), JSON.stringify(pullRequests));
  return `${pullRequests.length} merged PRs collected`;
}

export async function prepareFirstPass(workspace: Workspace): Promise<string> {
  const pullRequests = await readPullRequests(workspace);
  const comments = codeComments(pullRequests);
  await writeFile(join(workspace.work, files.comments), JSON.stringify(comments));
  const packets = await writePackets(packetDirectory(workspace), "first-pass", comments, sizes.firstPass);
  const counts = tally(pullRequests, comments);
  return `${counts.pullRequests} PRs (${counts.reviewedPullRequests} with review threads), ${counts.inlineComments} inline comments, ${counts.codeComments} human comments on code (${bySplit(comments).development} development, ${bySplit(comments).heldout} held-out), in ${packets.length} first-pass packets`;
}

export async function prepareConfirmation(workspace: Workspace): Promise<string> {
  const candidates = await firstPassCandidates(workspace, true);
  const packets = await writePackets(packetDirectory(workspace), "confirm", candidates, sizes.confirm);
  return `${candidates.length} first-pass candidates in ${packets.length} confirmation packets`;
}

export async function prepareGaps(workspace: Workspace, stage: typeof labelStages.firstPass | typeof labelStages.confirm): Promise<string> {
  const firstPass = stage === labelStages.firstPass;
  const items = firstPass ? await readComments(workspace) : await firstPassCandidates(workspace, true);
  const labelled = firstPass ? await readLabels(workspace.labels, stage, firstPassLabelSchema) : await readLabels(workspace.labels, stage, confirmationLabelSchema);
  const missing = items.filter(({ id }) => !labelled.has(id));
  const prefix = await freshPrefix(packetDirectory(workspace), `${stage}-gap`);
  const packets = await writePackets(packetDirectory(workspace), prefix, missing, firstPass ? sizes.firstPass : sizes.confirm);
  return `${missing.length} unlabelled ${stage} items${packets.length > 0 ? ` in ${packets.join(" ")}` : ""}`;
}

async function freshPrefix(directory: string, base: string): Promise<string> {
  for (let round = 1; ; round++) {
    if (!(await Bun.file(join(directory, `${base}${round}-001.md`)).exists())) return `${base}${round}`;
  }
}

export async function prepareRecallCheck(workspace: Workspace): Promise<string> {
  const sample = await recallSample(workspace);
  const packets = await writePackets(packetDirectory(workspace), "recall", sample, sizes.recall);
  return `${sample.length} development negatives sampled in ${packets.length} recall packets`;
}

export async function locate(workspace: Workspace, posthog: string): Promise<string> {
  const corrections = await confirmedCorrections(workspace);
  const pullRequests = new Map((await readPullRequests(workspace)).map((pullRequest) => [pullRequest.number, pullRequest]));
  const fixes = await locateFixes(posthog, corrections, pullRequests, join(workspace.work, files.fixes));
  return `${corrections.length} corrections: ${fixes.filter(({ fix }) => fix !== null).length} with a fix, ${fixes.filter(({ fix, isolable }) => fix !== null && isolable).length} isolable`;
}

export async function prepareVerification(workspace: Workspace, posthog: string): Promise<string> {
  const sample = await verificationSample(workspace);
  const packets = await writeVerificationPackets(posthog, packetDirectory(workspace), sample, sizes.verify);
  return `${sample.length} located fixes sampled in ${packets.length} verification packets`;
}

export async function status(workspace: Workspace): Promise<string> {
  const comments = await readComments(workspace);
  const lines = [await missingBatches(workspace, "first-pass", labelStages.firstPass, comments, sizes.firstPass, firstPassLabelSchema)];
  const candidates = await firstPassCandidates(workspace, false);
  lines.push(await missingBatches(workspace, "confirm", labelStages.confirm, candidates, sizes.confirm, confirmationLabelSchema));
  lines.push(await missingBatches(workspace, "recall", labelStages.recall, await recallSample(workspace), sizes.recall, confirmationLabelSchema));
  return lines.join("\n");
}

export async function writeCorpus(workspace: Workspace, window: Window): Promise<string> {
  const pullRequests = await readPullRequests(workspace);
  const comments = await readComments(workspace);
  const firstPass = await readLabels(workspace.labels, labelStages.firstPass, firstPassLabelSchema);
  const confirmations = await readLabels(workspace.labels, labelStages.confirm, confirmationLabelSchema);
  const verifications = await readLabels(workspace.labels, labelStages.verification, verificationLabelSchema);
  const fixes = new Map((await readFixes(workspace)).map((fix) => [fix.id, fix]));
  const rows = corpusRows(comments, confirmations, fixes, verifications);
  const digest = heldOutDigest(rows);
  const candidates = comments.filter(({ id }) => firstPass.get(id)?.candidate);
  await mkdir(workspace.docs, { recursive: true });
  await writeFile(join(workspace.docs, "corpus.jsonl"), jsonLines(rows));
  await writeFile(join(workspace.docs, "heldout.sha256"), `${digest}  corpus.jsonl rows with "split":"heldout"\n`);
  await writeFile(
    join(workspace.docs, "README.md"),
    readme({
      since: window.since,
      until: window.until,
      heldOutFrom,
      pullRequests: bySplit(pullRequests.map(({ mergedAt }) => ({ split: splitOf(mergedAt) }))),
      reviewedPullRequests: pullRequests.filter(({ reviewThreads }) => reviewThreads.nodes.length > 0).length,
      inlineComments: tally(pullRequests, comments).inlineComments,
      codeComments: bySplit(comments),
      candidates: bySplit(candidates),
      recall: await recall(workspace, comments, firstPass, confirmations),
      precision: precision([...verifications.values()].map(({ addressed }) => addressed)),
      api: await apiCost(workspace),
      truncated: truncation(pullRequests),
      batches: await labelBatches(workspace),
      rows,
      heldOutDigest: digest,
    }),
  );
  return `${rows.length} corrections (${rows.filter(({ split }) => split === "heldout").length} held-out), held-out sha256 ${digest}`;
}

async function recall(workspace: Workspace, comments: CorpusComment[], firstPass: Map<string, { candidate: boolean }>, confirmations: Map<string, { architecture: boolean }>) {
  const development = comments.filter(({ split }) => split === "development");
  const sample = await recallSample(workspace);
  const recallLabels = await readLabels(workspace.labels, labelStages.recall, confirmationLabelSchema);
  const missed = sample.filter(({ id }) => recallLabels.get(id)?.architecture).length;
  const confirmed = development.filter(({ id }) => firstPass.get(id)?.candidate && confirmations.get(id)?.architecture).length;
  const negatives = development.filter(({ id }) => firstPass.get(id)?.candidate === false).length;
  return { ...recallEstimate({ confirmed, negatives, sampled: sample.length, missed }), sampled: sample.length, missed };
}

export function precision(answers: ("yes" | "partly" | "no" | "unverifiable")[]) {
  const count = (answer: string) => answers.filter((given) => given === answer).length;
  const addressed = count("yes") + count("partly");
  const interval = wilson(addressed, answers.length);
  return { value: addressed / answers.length, ...interval, sampled: answers.length, answers: { yes: count("yes"), partly: count("partly"), no: count("no"), unverifiable: count("unverifiable") } };
}

function truncation(pullRequests: CollectedPullRequest[]) {
  return {
    threads: pullRequests.filter(({ counts }) => counts.reviewThreads > 100).length,
    comments: pullRequests.flatMap(({ reviewThreads }) => reviewThreads.nodes).filter(({ comments }) => comments.nodes.length >= 10).length,
    commits: pullRequests.filter(({ counts }) => counts.commits > 100).length,
  };
}

async function labelBatches(workspace: Workspace): Promise<Record<string, number>> {
  const stages = Object.values(labelStages);
  const counts = await Promise.all(stages.map(async (stage) => (await readdir(join(workspace.labels, stage)).catch(() => [])).filter((file) => file.endsWith(".json")).length));
  return Object.fromEntries(stages.map((stage, index) => [stage, counts[index]!]));
}

async function apiCost(workspace: Workspace): Promise<{ queries: number; points: number }> {
  const lines = (await readFile(join(workspace.work, budgetFile), "utf8").catch(() => "")).split("\n").filter(Boolean);
  return { queries: lines.length, points: lines.reduce((sum, line) => sum + z.object({ cost: z.number() }).parse(JSON.parse(line)).cost, 0) };
}

async function firstPassCandidates(workspace: Workspace, requireComplete: boolean): Promise<CorpusComment[]> {
  const comments = await readComments(workspace);
  const labels = await readLabels(workspace.labels, labelStages.firstPass, firstPassLabelSchema);
  const missing = unlabelled(comments.map(({ id }) => id), labels);
  if (requireComplete && missing.length > 0) throw new Error(`${missing.length} comments have no first-pass label yet; run status`);
  return comments.filter(({ id }) => labels.get(id)?.candidate);
}

async function confirmedCorrections(workspace: Workspace): Promise<CorpusComment[]> {
  const candidates = await firstPassCandidates(workspace, true);
  const confirmations = await readLabels(workspace.labels, labelStages.confirm, confirmationLabelSchema);
  const missing = unlabelled(candidates.map(({ id }) => id), confirmations);
  if (missing.length > 0) throw new Error(`${missing.length} candidates have no confirmation label yet; run status`);
  return candidates.filter(({ id }) => confirmations.get(id)?.architecture);
}

async function recallSample(workspace: Workspace): Promise<CorpusComment[]> {
  const comments = await readComments(workspace);
  const labels = await readLabels(workspace.labels, labelStages.firstPass, firstPassLabelSchema);
  const negatives = comments.filter(({ id, split }) => split === "development" && labels.get(id)?.candidate === false);
  return seededSample(negatives, samples.recall);
}

async function verificationSample(workspace: Workspace): Promise<Located[]> {
  const byId = new Map((await confirmedCorrections(workspace)).map((comment) => [comment.id, comment]));
  const located = (await readFixes(workspace)).flatMap((fix) => {
    const comment = byId.get(fix.id);
    return comment && fix.fix !== null && fix.isolable ? [{ comment, fix: { ...fix, fix: fix.fix } }] : [];
  });
  return seededSample(located, samples.verify, ({ comment }) => comment.id);
}

function seededSample<T>(items: T[], size: number, keyOf: (item: T) => string = (item) => (item as { id: string }).id): T[] {
  return shuffled([...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b))), seededRandom(samples.seed)).slice(0, size);
}

async function missingBatches(workspace: Workspace, prefix: string, stage: string, items: CorpusComment[], size: number, schema: z.ZodType<{ id: string }>): Promise<string> {
  const labels = await readLabels(workspace.labels, stage, schema);
  const missing: string[] = [];
  for (let start = 0; start < items.length; start += size) {
    if (unlabelled(items.slice(start, start + size).map(({ id }) => id), labels).length > 0) missing.push(`${prefix}-${String(start / size + 1).padStart(3, "0")}`);
  }
  return `${prefix}: ${Math.ceil(items.length / size) - missing.length}/${Math.ceil(items.length / size)} batches labelled${missing.length > 0 ? `; missing ${missing.join(" ")}` : ""}`;
}

function packetDirectory(workspace: Workspace): string {
  return join(workspace.work, "packets");
}

async function readPullRequests(workspace: Workspace): Promise<CollectedPullRequest[]> {
  return z.array(collectedPullRequestSchema).parse(JSON.parse(await readFile(join(workspace.work, files.pullRequests), "utf8")));
}

async function readComments(workspace: Workspace): Promise<CorpusComment[]> {
  return z.array(corpusCommentSchema).parse(JSON.parse(await readFile(join(workspace.work, files.comments), "utf8")));
}

async function readFixes(workspace: Workspace): Promise<Fix[]> {
  return z.array(fixSchema).parse(JSON.parse((await readFile(join(workspace.work, files.fixes), "utf8").catch(() => null)) ?? "[]"));
}

function bySplit(items: { split: Split }[]): Record<Split, number> {
  return Object.fromEntries(splits.map((split) => [split, items.filter((item) => item.split === split).length])) as Record<Split, number>;
}
