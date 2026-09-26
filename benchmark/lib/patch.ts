export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export type PatchedFile = { path: string; previousPath: string; status: FileStatus; added: number; removed: number; addedLines: string[] };

export function parsePatch(text: string): PatchedFile[] {
  const files: PatchedFile[] = [];
  let current: PatchedFile | undefined;
  let inHunk = false;
  for (const line of text.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2]!, previousPath: header[1]!, status: "modified", added: 0, removed: 0, addedLines: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && line.startsWith("+")) recordAdded(current, line.slice(1));
    else if (inHunk && line.startsWith("-")) current.removed++;
    else if (!inHunk) readExtendedHeader(current, line);
  }
  return files;
}

export function linesChanged(files: PatchedFile[]): number {
  return files.reduce((total, file) => total + file.added + file.removed, 0);
}

function recordAdded(file: PatchedFile, content: string) {
  file.added++;
  file.addedLines.push(content);
}

function readExtendedHeader(file: PatchedFile, line: string) {
  if (line.startsWith("new file mode")) file.status = "added";
  else if (line.startsWith("deleted file mode")) file.status = "deleted";
  else if (line.startsWith("rename from ")) {
    file.status = "renamed";
    file.previousPath = line.slice("rename from ".length);
  } else if (line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
  else if (line.startsWith("+++ b/")) file.path = line.slice("+++ b/".length);
  else if (line.startsWith("--- a/")) file.previousPath = line.slice("--- a/".length);
}
