import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CorpusRow, corpusRowSchema } from "../corrections/corpus.ts";
import { failedGuards, type LintabilityLabel, lintabilityLabelSchema, readStage, ruleGroupSchema, stageDirectory } from "./labels.ts";
import { type LabelledRow, languageOf, report } from "./report.ts";
import type { Evidence, Sources } from "./sources.ts";

export type LintabilityWorkspace = { corpus: string; work: string; docs: string };
export type LabellingStage = "calibration" | "label" | "agreement";
type Stage = LabellingStage | "rules";

const batchSizes: Record<Stage, number> = { calibration: 50, label: 30, agreement: 30, rules: 250 };
export const sampleSizes = { calibration: 50, agreement: 60 };
const bodyLimit = 1500;
const diffLineLimit = 300;

export async function preparePackets(workspace: LintabilityWorkspace, stage: LabellingStage, sources: Sources): Promise<string> {
  const pending = await unlabelled(workspace, stage);
  const entries = await Promise.all(pending.map(async (row) => entryOf(row, await sources(row))));
  const names = await writePackets(workspace, stage, entries);
  return `${pending.length} unlabelled ${stage} corrections${names.length > 0 ? ` in ${names.join(" ")}` : ""}`;
}

export async function prepareRulePackets(workspace: LintabilityWorkspace): Promise<string> {
  const labels = await completeLabels(workspace);
  const grouped = await readStage(stageDirectory(workspace.work, "rules"), ruleGroupSchema);
  const pending = (await developmentRows(workspace)).filter(({ id }) => labels.get(id)!.catchable !== "no" && !grouped.has(id));
  const names = await writePackets(workspace, "rules", pending.map((row) => ruleEntryOf(row, labels.get(row.id)!)));
  return `${pending.length} caught corrections without a rule group${names.length > 0 ? ` in ${names.join(" ")}` : ""}`;
}

export async function status(workspace: LintabilityWorkspace): Promise<string> {
  const stages: LabellingStage[] = ["calibration", "label", "agreement"];
  const lines = await Promise.all(
    stages.map(async (stage) => {
      const items = await stageRows(workspace, stage);
      const labels = await readStage(stageDirectory(workspace.work, stage), lintabilityLabelSchema);
      const missing = items.filter(({ id }) => !labels.has(id)).map(({ id }) => id);
      return `${stage}: ${items.length - missing.length}/${items.length} labelled${missing.length > 0 ? `, missing ${abbreviated(missing)}` : ""}`;
    }),
  );
  return lines.join("\n");
}

export async function writeResults(workspace: LintabilityWorkspace, sources: Sources): Promise<string> {
  const labels = await completeLabels(workspace);
  const second = await readStage(stageDirectory(workspace.work, "agreement"), lintabilityLabelSchema);
  const rules = await readStage(stageDirectory(workspace.work, "rules"), ruleGroupSchema);
  const rows = await Promise.all(
    (await developmentRows(workspace)).map(async (row): Promise<LabelledRow> => {
      const label = labels.get(row.id)!;
      return {
        ...label,
        pr: row.pr,
        prUrl: row.prUrl,
        commentUrl: row.commentUrl,
        path: row.path,
        language: languageOf(row.path),
        product: row.product,
        subtype: row.subtype,
        quote: row.quote,
        before: row.before!,
        fix: row.fix!,
        fixStat: (await sources(row)).stat,
        failedGuards: failedGuards(label),
        rule: label.catchable === "no" ? null : (rules.get(row.id)?.rule ?? null),
      };
    }),
  );
  const agreement = [...second.values()].map((label) => ({ primary: labels.get(label.id)!, second: label }));
  await mkdir(workspace.docs, { recursive: true });
  await writeFile(join(workspace.docs, "labels.jsonl"), rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
  await writeFile(join(workspace.docs, "agreement.jsonl"), [...second.values()].map((label) => `${JSON.stringify(label)}\n`).join(""));
  await writeFile(join(workspace.docs, "report.md"), report(rows, agreement));
  return `${rows.length} labelled corrections, ${agreement.length} labelled twice`;
}

async function completeLabels(workspace: LintabilityWorkspace): Promise<Map<string, LintabilityLabel>> {
  const labels = await readStage(stageDirectory(workspace.work, "label"), lintabilityLabelSchema);
  const missing = (await developmentRows(workspace)).filter(({ id }) => !labels.has(id));
  if (missing.length > 0) throw new Error(`${missing.length} corrections have no label yet: ${abbreviated(missing.map(({ id }) => id))}`);
  return labels;
}

async function unlabelled(workspace: LintabilityWorkspace, stage: LabellingStage): Promise<CorpusRow[]> {
  const labels = await readStage(stageDirectory(workspace.work, stage), lintabilityLabelSchema);
  return (await stageRows(workspace, stage)).filter(({ id }) => !labels.has(id));
}

async function stageRows(workspace: LintabilityWorkspace, stage: LabellingStage): Promise<CorpusRow[]> {
  const rows = await developmentRows(workspace);
  return stage === "label" ? rows : seededSample(rows, sampleSizes[stage], `110:${stage}`);
}

async function developmentRows(workspace: LintabilityWorkspace): Promise<CorpusRow[]> {
  const lines = (await readFile(workspace.corpus, "utf8")).split("\n").filter(Boolean);
  return lines.map((line) => corpusRowSchema.parse(JSON.parse(line))).filter(({ split, isolable, fix, before }) => split === "development" && isolable && fix !== null && before !== null);
}

function seededSample(rows: CorpusRow[], size: number, seed: string): CorpusRow[] {
  const rank = ({ id }: CorpusRow) => createHash("sha256").update(`${seed}:${id}`).digest("hex");
  return rows.toSorted((a, b) => rank(a).localeCompare(rank(b))).slice(0, size);
}

async function writePackets(workspace: LintabilityWorkspace, stage: Stage, entries: string[]): Promise<string[]> {
  const directory = join(workspace.work, "packets");
  await mkdir(directory, { recursive: true });
  const round = await freshRound(directory, stage);
  const size = batchSizes[stage];
  const names: string[] = [];
  for (let start = 0; start < entries.length; start += size) {
    const name = `${stage}-r${round}-${String(start / size + 1).padStart(3, "0")}`;
    await writeFile(join(directory, `${name}.md`), entries.slice(start, start + size).join("\n\n"));
    names.push(name);
  }
  return names;
}

async function freshRound(directory: string, stage: Stage): Promise<number> {
  let round = 1;
  while (await Bun.file(join(directory, `${stage}-r${round}-001.md`)).exists()) round++;
  return round;
}

function entryOf(row: CorpusRow, { body, diff, stat }: Evidence): string {
  const diffLines = diff.split("\n");
  return [
    `<entry id="${row.id}">`,
    `PR #${row.pr} (${row.prUrl}), file ${row.path}${row.line === null ? "" : `, line ${row.line}`}, corpus sub-type ${row.subtype}`,
    `before: ${row.before}  fix: ${row.fix} (the fix commit touches ${stat.files} files, +${stat.added}/-${stat.removed})`,
    "",
    body.length > bodyLimit ? `${body.slice(0, bodyLimit)} [...]` : body,
    "",
    "```diff",
    diffLines.slice(0, diffLineLimit).join("\n") + (diffLines.length > diffLineLimit ? `\n[... ${diffLines.length - diffLineLimit} more lines]` : ""),
    "```",
    "</entry>",
  ].join("\n");
}

function ruleEntryOf(row: CorpusRow, label: LintabilityLabel): string {
  return `- ${row.id} | ${languageOf(row.path)} | ${row.path} | ${label.ruleKind} | ${label.tool} | ${label.ruleSketch}`;
}

function abbreviated(ids: string[]): string {
  return ids.length > 10 ? `${ids.slice(0, 10).join(" ")} and ${ids.length - 10} more` : ids.join(" ");
}
