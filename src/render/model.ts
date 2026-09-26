export type ChangeState = "added" | "modified" | "deleted" | "renamed" | "unchanged";

export type DiffRow = { k: "ctx" | "add" | "del"; o: number | null; n: number | null; t: string };

export type RemovedLine = { anchor: number; old: number; text: string };

export type RenderSymbolKind = "function" | "class" | "method" | "object" | "describe" | "test" | "hook";

export type RenderModule = { id: string; name: string; root: string };

export type RenderFile = {
  id: string;
  path: string;
  touched: boolean;
  status: "added" | "modified" | "deleted" | "renamed" | "untouched";
  moduleId: string | null;
  role: "test" | "production";
  library: boolean;
  changedLines: number[];
  deleteAnchors: number[];
  removedLines: RemovedLine[];
};

export type RenderSymbol = {
  id: string;
  fileId: string;
  name: string;
  kind: RenderSymbolKind;
  parentId?: string;
  line: { start: number; end: number };
  touched: boolean;
  signatureTouched: boolean;
  hop: number;
  lineCount: number;
  changedLines: number[];
  change: ChangeState;
  diff?: DiffRow[];
};

export type RenderEdge = { from: string; to: string; kind: "call" | "import" };

export type RenderModel = {
  pr: { url: string; number: number; headSha: string; title: string };
  modules: RenderModule[];
  files: RenderFile[];
  symbols: RenderSymbol[];
  edges: RenderEdge[];
  warnings: string[];
};
