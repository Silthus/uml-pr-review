#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Correction } from "./corrections.ts";

type Scored = Correction & { index: NonNullable<Correction["index"]>; local: NonNullable<Correction["local"]> };

const repository = "https://github.com/PostHog/posthog";
const outcomes = ["improved", "blind", "worsened"] as const;

function movedMeasures(correction: Scored): string {
  return Object.entries(correction.index.measures)
    .filter(([, { scoreDelta }]) => scoreDelta !== 0)
    .sort(([, a], [, b]) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))
    .slice(0, 3)
    .map(([name, { scoreDelta }]) => `${name} ${scoreDelta > 0 ? "+" : ""}${scoreDelta}`)
    .join(", ");
}

function localChanges({ local }: Scored): string {
  return (Object.keys(local.before) as (keyof Scored["local"]["before"])[])
    .filter((key) => key !== "lines" && key !== "functions" && local.before[key] !== local.after[key])
    .map((key) => `${key} ${local.before[key]}→${local.after[key]}`)
    .join(", ");
}

function commitLink(sha: string): string {
  return `[\`${sha.slice(0, 10)}\`](${repository}/commit/${sha})`;
}

function tally(corrections: Scored[], outcomeOf: (correction: Scored) => string): string[] {
  return outcomes.map((outcome) => String(corrections.filter((correction) => outcomeOf(correction) === outcome).length));
}

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
  return [line(header), `| ${header.map(() => "---").join(" | ")} |`, ...rows.map(line)].join("\n");
}

function markdown(corrections: Correction[]): string {
  const scored = corrections.filter((correction): correction is Scored => correction.index !== null && correction.local !== null);
  const isolable = scored.filter(({ isolable }) => isolable);
  const lenient = (correction: Scored) => (correction.index.delta.composite > 0 ? "improved" : correction.index.delta.composite < 0 ? "worsened" : "blind");
  const rates = (label: string, members: Scored[]) => [
    [`${label}: scope-level composite, |Δ| ≥ 0.2`, String(members.length), ...tally(members, ({ index }) => index.moved)],
    [`${label}: scope-level composite, any Δ`, String(members.length), ...tally(members, lenient)],
    [`${label}: diff-local score`, String(members.length), ...tally(members, ({ local }) => local.moved)],
  ];
  const cases = scored.map((correction) => [
    `[#${correction.pr}](${correction.url})`,
    correction.kind,
    `“${correction.quote}”`,
    correction.isolable ? "yes" : "no",
    `${commitLink(correction.before!)} → ${commitLink(correction.fix!)}`,
    `${correction.index.delta.composite > 0 ? "+" : ""}${correction.index.delta.composite} (${correction.index.moved})`,
    movedMeasures(correction) || "—",
    `${correction.local.score > 0 ? "+" : ""}${correction.local.score} (${correction.local.moved})`,
    localChanges(correction) || "—",
  ]);
  return [
    `${corrections.length} architecture corrections; ${scored.length} with a fix commit that still exists; ${isolable.length} isolable (a PR commit before the comment survives, so the fix is a separate commit rather than a squashed or rebased whole).`,
    table(["signal", "corrections", "moved as asked", "blind", "moved the other way"], [...rates("isolable", isolable), ...rates("all", scored)]),
    table(["PR", "kind", "request", "isolable", "fix parent → fix", "index Δ", "index measures", "diff-local", "diff-local findings"], cases),
  ].join("\n\n");
}

function csvOf(corrections: Correction[]): string {
  const header = ["pr", "comment_url", "reviewer", "kind", "quote", "path", "commented_at", "isolable", "comment_commit", "fix_parent", "fix", "base", "delta_composite", "delta_architecture", "delta_complexity", "delta_smells", "delta_tests", "index_outcome", "diff_local_score", "diff_local_outcome", "diff_local_files"];
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = corrections.map((correction) =>
    [
      correction.pr, correction.url, correction.author, correction.kind, correction.quote, correction.path, correction.at, correction.isolable, correction.commentCommit.slice(0, 12), correction.before?.slice(0, 12), correction.fix?.slice(0, 12), correction.base.slice(0, 12),
      correction.index?.delta.composite, correction.index?.delta.architecture, correction.index?.delta.complexity, correction.index?.delta.smells, correction.index?.delta.tests, correction.index?.moved,
      correction.local?.score, correction.local?.moved, correction.local?.files,
    ].map(cell).join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      data: { type: "string", default: join(import.meta.dir, "data", "corrections.json") },
      csv: { type: "string", default: join(import.meta.dir, "..", "..", "docs", "coherence", "validation", "corrections.csv") },
      tables: { type: "string", default: join(import.meta.dir, "..", "..", "docs", "coherence", "validation", "corrections-tables.md") },
    },
  });
  const corrections = JSON.parse(await readFile(resolve(values.data!), "utf8")) as Correction[];
  const tables = markdown(corrections);
  await writeFile(resolve(values.csv!), csvOf(corrections));
  await writeFile(resolve(values.tables!), `# Human architecture corrections: generated tables\n\n${tables}\n`);
  console.log(tables);
}
