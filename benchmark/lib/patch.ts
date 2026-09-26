export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export type Hunk = { start: number; length: number };

export type PatchedFile = {
  path: string;
  previousPath: string;
  status: FileStatus;
  added: number;
  removed: number;
  addedLines: string[];
  hunks: Hunk[];
  section: string;
};

export function parsePatch(text: string): PatchedFile[] {
  const files: PatchedFile[] = [];
  const sections: string[][] = [];
  let current: PatchedFile | undefined;
  let inHunk = false;
  for (const line of text.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2]!, previousPath: header[1]!, status: "modified", added: 0, removed: 0, addedLines: [], hunks: [], section: "" };
      files.push(current);
      sections.push([]);
      inHunk = false;
    }
    if (!current) continue;
    sections.at(-1)!.push(line);
    if (header) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      inHunk = true;
      current.hunks.push({ start: Number(hunk[1]), length: Number(hunk[2] ?? 1) });
    } else if (inHunk && line.startsWith("+")) recordAdded(current, line.slice(1));
    else if (inHunk && line.startsWith("-")) current.removed++;
    else if (!inHunk) readExtendedHeader(current, line);
  }
  files.forEach((file, index) => (file.section = sections[index]!.join("\n")));
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
