#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { git } from "../../src/git.ts";
import type { Attribution } from "./attribute.ts";
import { batches, judged, readAttribution } from "./selection.ts";

const fileLimit = 8_000;
const packetLimit = 30_000;
const omitted = /(^|\/)(pnpm-lock\.yaml|uv\.lock|package-lock\.json|yarn\.lock)$|__snapshots__\/|\.snap$|(^|\/)generated\/|\.generated\.|\.(png|jpe?g|gif|svg|ico|woff2?)$/;

type FileDiff = { path: string; text: string };

export async function writePackets(repository: string, directory: string): Promise<{ batch: string; prs: { pr: number; title: string }[] }[]> {
  const { commits, scope } = await readAttribution();
  await mkdir(directory, { recursive: true });
  const plan = batches(judged(commits));
  for (const [index, batch] of plan.entries()) {
    const packets = await Promise.all(batch.map((commit) => packetOf(repository, commit, scope)));
    await writeFile(join(directory, `batch-${batchName(index)}.md`), packets.join("\n\n"));
  }
  return plan.map((batch, index) => ({ batch: batchName(index), prs: batch.map(({ pr, title }) => ({ pr: pr!, title })) }));
}

async function packetOf(repository: string, commit: Attribution, scope: string): Promise<string> {
  const files = await fileDiffs(repository, commit);
  const ordered = [...files.filter(({ path }) => path.startsWith(`${scope}/`)), ...files.filter(({ path }) => !path.startsWith(`${scope}/`))];
  const shown: string[] = [];
  const notes: string[] = [];
  let used = 0;
  for (const { path, text } of ordered) {
    if (omitted.test(path)) notes.push(`${path}: omitted (lockfile, snapshot, generated, or binary)`);
    else if (used >= packetLimit) notes.push(`${path}: omitted (${lineCountOf(text)} diff lines, packet limit reached)`);
    else {
      const limit = Math.min(fileLimit, packetLimit - used);
      shown.push(text.length > limit ? `${text.slice(0, limit)}\n[... truncated: ${lineCountOf(text.slice(limit))} more diff lines in this file]` : text);
      if (text.length > limit) notes.push(`${path}: truncated`);
      used += Math.min(text.length, limit);
    }
  }
  const truncation = notes.length === 0 ? "Truncation: none, the whole diff is shown." : `Truncation:\n${notes.map((note) => `- ${note}`).join("\n")}`;
  return [`## PR #${commit.pr}: ${commit.title}`, truncation, "```diff", shown.join("\n"), "```"].join("\n\n");
}

async function fileDiffs(repository: string, { parent, commit }: Attribution): Promise<FileDiff[]> {
  const diff = await git(repository, ["diff", "--no-renames", "--no-color", "-U3", parent, commit]);
  return diff
    .split(/^(?=diff --git )/m)
    .filter(Boolean)
    .map((text) => ({ path: /^diff --git a\/(\S+)/.exec(text)?.[1] ?? "unknown", text: text.trimEnd() }));
}

function lineCountOf(text: string): number {
  return text.split("\n").length;
}

function batchName(index: number): string {
  return String(index + 1).padStart(2, "0");
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { repo: { type: "string" }, out: { type: "string", default: "/tmp/coherence-validation-packets" } } });
  if (!values.repo) {
    console.error("Usage: bun coherence/validation/packets.ts --repo <path> [--out /tmp/coherence-validation-packets]");
    process.exit(2);
  }
  const plan = await writePackets(resolve(values.repo), resolve(values.out!));
  await writeFile(join(import.meta.dir, "judgements", "batches.json"), JSON.stringify(plan, null, 1));
  console.log(`Wrote ${plan.length} batches with ${plan.reduce((total, { prs }) => total + prs.length, 0)} PRs to ${resolve(values.out!)}`);
}
