import type { ChangedFile } from "../contracts/index.ts";
import { git } from "./git.ts";
import { languageOfSource } from "./module-tree.ts";

const sourcePathspecs = ["*.py", "*.pyi", "*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.rs"];
const statuses: Record<string, ChangedFile["status"]> = { A: "added", D: "deleted", M: "modified", T: "modified" };

export async function changedFiles(cwd: string, fromTree: string, toTree: string): Promise<ChangedFile[]> {
  const range = ["--no-renames", fromTree, toTree, "--", ...sourcePathspecs];
  const [nameStatus, patch] = await Promise.all([git(cwd, ["diff", "--name-status", "-z", ...range]), git(cwd, ["diff", "-U0", "--no-color", "--no-ext-diff", ...range])]);
  const firstLines = firstChangedLines(patch);
  return statusEntries(nameStatus)
    .map(({ path, status }, position) => ({ path, status, firstChangedLine: status === "deleted" ? 1 : Math.max(firstLines[position] ?? 1, 1) }))
    .filter(({ path }) => languageOfSource(path) !== null);
}

function statusEntries(output: string): { path: string; status: ChangedFile["status"] }[] {
  const fields = output.split("\0").filter(Boolean);
  const entries: { path: string; status: ChangedFile["status"] }[] = [];
  for (let field = 0; field + 1 < fields.length; field += 2) entries.push({ status: statuses[fields[field]!] ?? "modified", path: fields[field + 1]! });
  return entries;
}

function firstChangedLines(patch: string): (number | undefined)[] {
  const lines: (number | undefined)[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) lines.push(undefined);
    else if (line.startsWith("@@ ") && lines.at(-1) === undefined && lines.length > 0) lines[lines.length - 1] = Number(/\+(\d+)/.exec(line)?.[1] ?? 1);
  }
  return lines;
}
