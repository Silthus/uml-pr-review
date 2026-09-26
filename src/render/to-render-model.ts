import type { DiffLine, Graph, GraphFile, GraphSymbol } from "../graph.ts";
import type { DiffRow, RenderFile, RenderModel, RenderSymbol } from "./model.ts";

type AnchoredRow = DiffLine & { anchor: number };

export function toRenderModel(graph: Graph): RenderModel {
  const anchoredRowsByFile = new Map(graph.files.map((file) => [file.path, anchoredRows(file.diff)]));
  return {
    pr: { url: graph.pr.url, number: graph.pr.number, headSha: graph.pr.headSha, title: graph.pr.title },
    modules: graph.packages.map((pkg) => ({ id: pkg.root, name: pkg.name, root: pkg.root })),
    files: graph.files.map((file) => renderFile(file, anchoredRowsByFile.get(file.path)!)),
    symbols: graph.symbols.map((symbol) => renderSymbol(symbol, anchoredRowsByFile.get(symbol.file) ?? [])),
    edges: graph.calls.map((call) => ({ from: call.from, to: call.to, kind: "call" as const })),
    warnings: graph.warnings,
  };
}

function anchoredRows(rows: DiffLine[]): AnchoredRow[] {
  const anchored: AnchoredRow[] = [];
  let pendingDeletions: AnchoredRow[] = [];
  for (const row of rows) {
    if (row.kind === "del") {
      pendingDeletions.push({ ...row, anchor: 0 });
      continue;
    }
    for (const deletion of pendingDeletions) anchored.push({ ...deletion, anchor: row.new! });
    pendingDeletions = [];
    anchored.push({ ...row, anchor: row.new! });
  }
  const trailingAnchor = (anchored.at(-1)?.anchor ?? 0) + 1;
  for (const deletion of pendingDeletions) anchored.push({ ...deletion, anchor: trailingAnchor });
  return anchored;
}

function renderFile(file: GraphFile, rows: AnchoredRow[]): RenderFile {
  const deletions = rows.filter((row) => row.kind === "del");
  return {
    id: file.path,
    path: file.path,
    touched: file.status !== "unchanged",
    status: file.status === "unchanged" ? "untouched" : file.status,
    moduleId: file.package,
    role: file.role,
    library: false,
    changedLines: rows.filter((row) => row.kind === "add").map((row) => row.new!),
    deleteAnchors: [...new Set(deletions.map((row) => row.anchor))],
    removedLines: deletions.map((row) => ({ anchor: row.anchor, old: row.old!, text: row.text })),
  };
}

function renderSymbol(symbol: GraphSymbol, rows: AnchoredRow[]): RenderSymbol {
  const { start, end } = symbol.range;
  const touched = symbol.change !== "unchanged" || symbol.hop === 0;
  const inRange = (row: AnchoredRow) => (row.kind === "del" ? row.anchor > start && row.anchor <= end : row.anchor >= start && row.anchor <= end);
  const symbolRows = rows.filter(inRange);
  return {
    id: symbol.id,
    fileId: symbol.file,
    name: symbol.name,
    kind: symbol.kind,
    ...(symbol.parentId ? { parentId: symbol.parentId } : {}),
    line: { start, end },
    touched,
    signatureTouched: symbol.signatureChanged,
    hop: symbol.hop,
    lineCount: end - start + 1,
    changedLines: symbolRows.filter((row) => row.kind === "add").map((row) => row.new!),
    change: symbol.change,
    ...(touched && symbolRows.length > 0 ? { diff: symbolRows.map(toDiffRow) } : {}),
  };
}

const toDiffRow = (row: DiffLine): DiffRow => ({ k: row.kind, o: row.old, n: row.new, t: row.text });
