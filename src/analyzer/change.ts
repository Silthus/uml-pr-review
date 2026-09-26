import type { DiffLine, GraphSymbol } from "../graph.ts";
import type { ExtractedSymbol } from "./source-file.ts";

export type LineChanges = { fileAdded: boolean; added: Set<number>; deleteAnchors: Set<number> };

export function lineChangesOf(rows: DiffLine[], fileAdded: boolean): LineChanges {
  const added = new Set<number>();
  const deleteAnchors = new Set<number>();
  let nextHeadLine = 1;
  let pendingDeletion = false;
  for (const row of rows) {
    if (row.kind === "del") {
      pendingDeletion = true;
      continue;
    }
    if (pendingDeletion) deleteAnchors.add(row.new!);
    pendingDeletion = false;
    if (row.kind === "add") added.add(row.new!);
    nextHeadLine = row.new! + 1;
  }
  if (pendingDeletion) deleteAnchors.add(nextHeadLine);
  return { fileAdded, added, deleteAnchors };
}

export function symbolChange(
  symbol: ExtractedSymbol,
  members: ExtractedSymbol[],
  changes: LineChanges,
): Pick<GraphSymbol, "change" | "signatureChanged"> {
  const { start, end } = symbol.range;
  const lines = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  if (changes.fileAdded || lines.every((line) => changes.added.has(line))) return { change: "added", signatureChanged: false };
  const insideMember = (line: number) => members.some((member) => line >= member.range.start && line <= member.range.end);
  const ownLines = lines.filter((line) => !insideMember(line));
  const touched =
    ownLines.some((line) => changes.added.has(line)) ||
    ownLines.some((line) => line > start && changes.deleteAnchors.has(line));
  if (!touched) return { change: "unchanged", signatureChanged: false };
  const signatureChanged = ownLines.some(
    (line) => line <= symbol.signatureEnd && (changes.added.has(line) || (line > start && changes.deleteAnchors.has(line))),
  );
  return { change: "modified", signatureChanged };
}
