import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../../src/git.ts";
import type { CorpusComment } from "./comments.ts";
import type { Fix } from "./fixes.ts";

const bodyLimit = 1500;
const diffLineLimit = 300;

export type Located = { comment: CorpusComment; fix: Fix & { fix: string } };

export async function writeVerificationPackets(repository: string, directory: string, sample: Located[], size: number): Promise<string[]> {
  const names: string[] = [];
  for (let start = 0; start < sample.length; start += size) {
    const name = `verify-${String(start / size + 1).padStart(3, "0")}`;
    const entries = await Promise.all(sample.slice(start, start + size).map((located) => entryOf(repository, located)));
    await writeFile(join(directory, `${name}.md`), entries.join("\n\n"));
    names.push(name);
  }
  return names;
}

async function entryOf(repository: string, { comment, fix }: Located): Promise<string> {
  const [stat, diff] = await Promise.all([git(repository, ["show", "--stat", "--format=%s", fix.fix]), git(repository, ["show", "--format=", fix.fix, "--", comment.path])]);
  const diffLines = diff.split("\n");
  return [
    `### ${comment.id}`,
    `PR #${comment.pr}, file ${comment.path}${comment.line === null ? "" : `, line ${comment.line}`}, commented ${comment.at}`,
    `Comment: ${comment.url}`,
    "",
    comment.body.length > bodyLimit ? `${comment.body.slice(0, bodyLimit)} [...]` : comment.body,
    "",
    `Located fix: ${fix.fix} (parent ${fix.before})`,
    "",
    "```text",
    stat.trim(),
    "```",
    "",
    "```diff",
    diffLines.slice(0, diffLineLimit).join("\n") + (diffLines.length > diffLineLimit ? `\n[... ${diffLines.length - diffLineLimit} more lines]` : ""),
    "```",
  ].join("\n");
}
