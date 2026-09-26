import type { DiffLine, FileStatus } from "./graph.ts";
import { git } from "./git.ts";

export type FileDiff = {
  path: string;
  previousPath?: string;
  status: Exclude<FileStatus, "unchanged">;
  rows: DiffLine[];
};

export async function diffCommits(repoDir: string, base: string, head: string): Promise<FileDiff[]> {
  const patch = await git(repoDir, [
    "-c",
    "core.quotePath=false",
    "diff",
    "-M",
    "--no-color",
    "--no-ext-diff",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    base,
    head,
  ]);
  return parseUnifiedDiff(patch);
}

export function parseUnifiedDiff(patch: string): FileDiff[] {
  return patch
    .split(/^(?=diff --git )/m)
    .filter((block) => block.startsWith("diff --git "))
    .map(parseFileBlock);
}

function parseFileBlock(block: string): FileDiff {
  const lines = block.split("\n");
  const header = /^diff --git a\/(.*) b\/(.*)$/.exec(lines[0]!)!;
  let oldPath = header[1]!;
  let newPath = header[2]!;
  let status: FileDiff["status"] = "modified";
  const rows: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines.slice(1)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (!inHunk) {
      if (line.startsWith("new file mode")) status = "added";
      else if (line.startsWith("deleted file mode")) status = "deleted";
      else if (line.startsWith("rename from ")) oldPath = line.slice("rename from ".length);
      else if (line.startsWith("rename to ")) {
        newPath = line.slice("rename to ".length);
        status = "renamed";
      }
      continue;
    }
    if (line.startsWith("+")) rows.push({ kind: "add", old: null, new: newLine++, text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ kind: "del", old: oldLine++, new: null, text: line.slice(1) });
    else if (line.startsWith(" ")) rows.push({ kind: "ctx", old: oldLine++, new: newLine++, text: line.slice(1) });
  }

  const path = status === "deleted" ? oldPath : newPath;
  return status === "renamed" ? { path, previousPath: oldPath, status, rows } : { path, status, rows };
}
