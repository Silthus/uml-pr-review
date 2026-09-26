import { git } from "../../src/architecture/index/index.ts";

export type ChurnedCommit = { sha: string; author: string; agent: boolean; files: { path: string; lines: number }[] };
export type Churn = { since: string; until: string; commits: ChurnedCommit[] };

const dayMs = 86_400_000;
const commitMarker = "\u001e";
const fieldSeparator = "\u001f";
const agentTrailer = /^co-authored-by:.*\b(claude|codex|cursor|copilot|devin|anthropic|openai)\b/im;

export async function readChurn(repository: string, commit: string, scope: string, days: number): Promise<Churn> {
  const until = new Date(Number((await git(repository, ["show", "-s", "--format=%ct", commit])).trim()) * 1000);
  const since = new Date(until.getTime() - days * dayMs);
  const log = await git(repository, [
    "log",
    "--no-merges",
    "--no-renames",
    "--numstat",
    `--since=${since.toISOString()}`,
    `--format=${commitMarker}%H${fieldSeparator}%ae${fieldSeparator}%B${fieldSeparator}`,
    commit,
    "--",
    scope,
  ]);
  return { since: since.toISOString(), until: until.toISOString(), commits: log.split(commitMarker).filter((record) => record.trim() !== "").map(parseCommit) };
}

function parseCommit(record: string): ChurnedCommit {
  const [sha = "", author = "", message = "", numstat = ""] = record.split(fieldSeparator);
  return { sha, author: author.toLowerCase(), agent: agentTrailer.test(message), files: numstat.split("\n").flatMap(parseNumstat) };
}

function parseNumstat(line: string): { path: string; lines: number }[] {
  const [added, deleted, path] = line.split("\t");
  if (path === undefined) return [];
  return [{ path, lines: (Number(added) || 0) + (Number(deleted) || 0) }];
}
