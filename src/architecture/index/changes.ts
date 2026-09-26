import type { ChangedFile } from "../contracts/index.ts";
import { git, revision } from "./git.ts";
import { languageOfSource } from "./module-tree.ts";

type StatusEntry = Pick<ChangedFile, "path" | "status">;

const sourcePathspecs = ["*.py", "*.pyi", "*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.rs"];
const statuses: Record<string, ChangedFile["status"]> = { A: "added", D: "deleted", M: "modified", T: "modified" };
const newFilePrefix = "+++ ";
const hunkPrefix = "@@ ";

export async function changedFiles(cwd: string, fromTree: string, toTree: string): Promise<ChangedFile[]> {
  const trees = await Promise.all([revision(cwd, `${fromTree}^{tree}`), revision(cwd, `${toTree}^{tree}`)]);
  const range = ["--no-renames", "--no-ext-diff", "--no-textconv", ...trees, "--", ...sourcePathspecs];
  const [nameStatus, patch] = await Promise.all([
    git(cwd, ["diff", "--name-status", "-z", ...range]),
    git(cwd, ["-c", "core.quotePath=false", "diff", "-U0", "--no-color", ...range]),
  ]);
  const firstLines = firstChangedLineByPath(patch);
  return statusEntries(nameStatus)
    .filter(({ path }) => languageOfSource(path) !== null)
    .map(({ path, status }) => ({ path, status, firstChangedLine: status === "deleted" ? 1 : (firstLines.get(path) ?? 1) }));
}

function statusEntries(output: string): StatusEntry[] {
  const fields = output.split("\0").filter(Boolean);
  const entries: StatusEntry[] = [];
  for (let field = 0; field + 1 < fields.length; field += 2) {
    entries.push({ status: statuses[fields[field]!] ?? "modified", path: fields[field + 1]! });
  }
  return entries;
}

function firstChangedLineByPath(patch: string): Map<string, number> {
  const firstLines = new Map<string, number>();
  let current: string | undefined;
  let inHeader = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = undefined;
      inHeader = true;
    } else if (inHeader && line.startsWith(newFilePrefix)) {
      current = newFilePath(line.slice(newFilePrefix.length));
    } else if (inHeader && line.startsWith(hunkPrefix)) {
      inHeader = false;
      if (current !== undefined && !firstLines.has(current)) firstLines.set(current, hunkStart(line));
    }
  }
  return firstLines;
}

function newFilePath(header: string): string | undefined {
  const path = header.startsWith('"') ? unquote(header) : header.replace(/\t$/, "");
  return path.startsWith("b/") ? path.slice(2) : undefined;
}

function hunkStart(hunkHeader: string): number {
  return Math.max(Number(/\+(\d+)/.exec(hunkHeader)?.[1] ?? 1), 1);
}

function unquote(quoted: string): string {
  const bytes: number[] = [];
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  const encoder = new TextEncoder();
  for (let position = 1; position < quoted.length && quoted[position] !== '"'; position++) {
    const character = quoted[position]!;
    if (character !== "\\") {
      bytes.push(...encoder.encode(character));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(quoted.slice(position + 1))?.[0];
    bytes.push(octal ? Number.parseInt(octal, 8) : (escapes[quoted[position + 1]!] ?? quoted.charCodeAt(position + 1)));
    position += octal ? 3 : 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
