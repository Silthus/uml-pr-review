import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { git } from "../../../src/architecture/index/git.ts";
import { stableOrder } from "../corpus.ts";
import type { DetectorName, Violation } from "../violations.ts";
import type { CleanPullRequest } from "./jobs.ts";
import { introducedIn } from "./metrics.ts";
import type { StoredGrade } from "./store.ts";

export const judgedFlagsPerPullRequest = 5;
const flagsPerPacket = 25;
const contextLines = 12;

export const falseAlarmLabelSchema = z.object({ id: z.string(), verdict: z.enum(["problem", "not-a-problem", "unsure"]), note: z.string().max(200) });
export type FalseAlarmLabel = z.infer<typeof falseAlarmLabelSchema>;

export type Flag = { id: string; pr: number; head: string; violation: Violation };

export function flagsToJudge(clean: CleanPullRequest[], grades: Map<number, StoredGrade>, detectors: readonly DetectorName[]): Flag[] {
  return clean.flatMap(({ pr, range }) => {
    const grade = grades.get(pr);
    if (!grade) return [];
    const flags = introducedIn(grade, detectors).map((violation, index) => ({ id: `${pr}:${index}`, pr, head: range.head, violation }));
    return stableOrder(flags, `100:false-alarm:${pr}`).slice(0, judgedFlagsPerPullRequest);
  });
}

export async function writeFalseAlarmPackets(repository: string, directory: string, flags: Flag[]): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const names: string[] = [];
  for (let start = 0; start < flags.length; start += flagsPerPacket) {
    const name = `false-alarm-${String(start / flagsPerPacket + 1).padStart(3, "0")}`;
    const entries = await Promise.all(flags.slice(start, start + flagsPerPacket).map((flag) => entryOf(repository, flag)));
    await writeFile(join(directory, `${name}.md`), entries.join("\n\n"));
    names.push(name);
  }
  return names;
}

async function entryOf(repository: string, { id, pr, head, violation }: Flag): Promise<string> {
  const text = await git(repository, ["show", `${head}:${violation.file}`]).catch(() => "");
  const lines = text.split("\n");
  const first = Math.max(0, violation.line - 1 - contextLines);
  const excerpt = lines.slice(first, violation.line + contextLines).map((line, index) => `${String(first + index + 1).padStart(5)} ${line}`);
  return [
    `<entry id="${id}">`,
    `Merged PR https://github.com/PostHog/posthog/pull/${pr}, merge commit ${head}.`,
    `Flagged: ${violation.file}:${violation.line}. ${violation.message}`,
    "",
    "```text",
    excerpt.join("\n"),
    "```",
    "</entry>",
  ].join("\n");
}
