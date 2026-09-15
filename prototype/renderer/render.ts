#!/usr/bin/env bun
/**
 * THROWAWAY UI PROTOTYPE - github issue #6. Not production code.
 *
 * Question: what should the Artifact look like so a reviewer reads Touched files,
 * their Symbols, and Callers and Callees at a glance?
 *
 * Answer shape: four radically different renderings of one Graph, in a single
 * self-contained HTML file, switchable with `?variant=` and a floating bottom bar.
 * Every variant gets the same interaction set and the same visual language.
 *
 *   A  Blueprint   files as containers, symbols as members, elkjs layered hierarchy
 *   B  Impact      three bands, callers -> touched -> callees, elkjs layered partitions
 *   C  Ledger      one vertical outline of every symbol, call arcs on a spine
 *   D  Dossier     no edges at all, one card per touched file, neighbors as chips
 *
 * elkjs runs here, at generation time. The artifact loads nothing at view time.
 *
 * Usage: bun run prototype/renderer/render.ts <graph.json> <out.html>
 */

// elkjs takes the web-worker branch when a global `self` exists, which Bun defines.
delete (globalThis as { self?: unknown }).self;
const ELK = (await import("elkjs/lib/elk.bundled.js")).default;

// ---------------------------------------------------------------------------
// Graph, exactly as the extractor will emit it
// ---------------------------------------------------------------------------

type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untouched";
type SymbolKind = "function" | "class" | "method" | "arrow" | "const";

type Graph = {
  version: 0;
  pr: { url: string; number: number; headSha: string; title: string };
  files: { id: string; path: string; touched: boolean; status: FileStatus }[];
  symbols: {
    id: string;
    fileId: string;
    name: string;
    kind: SymbolKind;
    parentId?: string;
    line: { start: number; end: number };
    touched: boolean;
    signatureTouched: boolean;
    hop: number;
  }[];
  edges: { from: string; to: string; kind: "call" | "import" }[];
};

const [graphPath, outPath] = process.argv.slice(2);
if (!graphPath || !outPath) {
  console.error("usage: bun run prototype/renderer/render.ts <graph.json> <out.html>");
  process.exit(2);
}

const graph = JSON.parse(await Bun.file(graphPath).text()) as Graph;

// ---------------------------------------------------------------------------
// Normalise. Everything downstream reads these sorted arrays, never the input,
// because elkjs gives a different (but stable) layout for a different input order.
// ---------------------------------------------------------------------------

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const files = [...graph.files].sort((a, b) => cmp(a.id, b.id));
const symbols = [...graph.symbols].sort((a, b) => cmp(a.id, b.id));
const edges = [...graph.edges].sort(
  (a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind),
);

const fileById = new Map(files.map((f) => [f.id, f]));
const symById = new Map(symbols.map((s) => [s.id, s]));

for (const s of symbols) {
  if (!fileById.has(s.fileId)) throw new Error(`symbol ${s.id} points at unknown file ${s.fileId}`);
  if (s.parentId && !symById.has(s.parentId)) throw new Error(`symbol ${s.id} has unknown parent ${s.parentId}`);
}
for (const e of edges) {
  if (!symById.has(e.from) || !symById.has(e.to)) throw new Error(`edge ${e.from} -> ${e.to} has an unknown end`);
}

const callersOf = new Map<string, string[]>(symbols.map((s) => [s.id, []]));
const calleesOf = new Map<string, string[]>(symbols.map((s) => [s.id, []]));
for (const e of edges) {
  callersOf.get(e.to)!.push(e.from);
  calleesOf.get(e.from)!.push(e.to);
}

/** Reading order: touched files first, then by path. Symbols by line, methods under their class. */
const fileOrder = [...files].sort(
  (a, b) => Number(b.touched) - Number(a.touched) || cmp(a.path, b.path),
);
const symbolsInFile = (fileId: string) =>
  symbols
    .filter((s) => s.fileId === fileId)
    .sort((a, b) => a.line.start - b.line.start || cmp(a.name, b.name));
const topLevelIn = (fileId: string) => symbolsInFile(fileId).filter((s) => !s.parentId);
const methodsOf = (symId: string) =>
  symbols.filter((s) => s.parentId === symId).sort((a, b) => a.line.start - b.line.start || cmp(a.name, b.name));

const touchedSyms = symbols.filter((s) => s.touched);
const neighbourSyms = symbols.filter((s) => !s.touched);
const isUntouched = (id: string) => !symById.get(id)!.touched;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;
const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Monospace advance is a constant fraction of the font size. 0.6 fits SF Mono, Menlo, Consolas. */
const monoW = (text: string, size: number) => text.length * size * 0.6;

const kindTag: Record<SymbolKind, string> = {
  function: "f",
  class: "c",
  method: "m",
  arrow: "a",
  const: "k",
};

const lineLabel = (s: Graph["symbols"][number]) =>
  s.line.start === s.line.end ? `${s.line.start}` : `${s.line.start}-${s.line.end}`;

const dirOf = (path: string) => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i + 1);
};
const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Classes that carry the shared visual language. One place, so all four variants agree. */
const symClass = (s: Graph["symbols"][number]) => {
  const out = ["cell", `k-${s.kind}`];
  out.push(s.touched ? "is-touched" : "is-neighbor");
  if (s.signatureTouched) out.push("is-sig");
  if (fileById.get(s.fileId)!.status === "deleted") out.push("is-gone");
  return out.join(" ");
};

// ---------------------------------------------------------------------------
// Scene model. Cells keep a fixed size; only their position moves between the
// full state and the focus state (untouched neighbors hidden). Group boxes may
// resize, so the script writes their width and height.
// ---------------------------------------------------------------------------

type Cell = { cid: string; sym?: string; w: number; h: number; cls: string; body: string };
type Group = { gid: string; sym?: string; cls: string; body: string; un: boolean };
type EdgeRef = { from: string; to: string; kind: "call" | "import" };

type State = {
  cells: Record<string, [number, number]>;
  groups: Record<string, [number, number, number, number]>;
  edges: string[];
  w: number;
  h: number;
};

type Variant = {
  key: string;
  name: string;
  note: string;
  cells: Cell[];
  groups: Group[];
  edges: EdgeRef[];
  full: State;
  focus: State;
};

const FOCUS = new Set(touchedSyms.map((s) => s.id));
const ALL = new Set(symbols.map((s) => s.id));

/** Call and import edges between two visible symbols, in sorted order. */
const visibleEdges = (visible: Set<string>) => edges.filter((e) => visible.has(e.from) && visible.has(e.to));

// ---------------------------------------------------------------------------
// elkjs plumbing
// ---------------------------------------------------------------------------

type ElkNode = {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
};
type ElkEdge = {
  id: string;
  sources: string[];
  targets: string[];
  container?: string;
  sections?: { startPoint: XY; endPoint: XY; bendPoints?: XY[] }[];
};
type XY = { x: number; y: number };

async function runElk(root: ElkNode) {
  const elk = new ELK();
  // elkjs mutates its input, so hand it a throwaway copy.
  return (await elk.layout(structuredClone(root))) as ElkNode;
}

/**
 * elkjs returns node coordinates relative to the parent and edge coordinates
 * relative to the edge container. Flatten both into one absolute space.
 */
function flattenElk(res: ElkNode) {
  const abs = new Map<string, XY>();
  const box = new Map<string, [number, number, number, number]>();

  const walk = (node: ElkNode, ox: number, oy: number, root: boolean) => {
    const x = root ? 0 : ox + (node.x ?? 0);
    const y = root ? 0 : oy + (node.y ?? 0);
    abs.set(node.id, { x, y });
    box.set(node.id, [r2(x), r2(y), r2(node.width ?? 0), r2(node.height ?? 0)]);
    for (const child of node.children ?? []) walk(child, x, y, false);
  };
  walk(res, 0, 0, true);

  const routes = new Map<string, XY[]>();
  const collect = (node: ElkNode) => {
    for (const e of node.edges ?? []) {
      const origin = abs.get(e.container ?? node.id) ?? { x: 0, y: 0 };
      const pts: XY[] = [];
      for (const sec of e.sections ?? []) {
        pts.push({ x: sec.startPoint.x + origin.x, y: sec.startPoint.y + origin.y });
        for (const b of sec.bendPoints ?? []) pts.push({ x: b.x + origin.x, y: b.y + origin.y });
        pts.push({ x: sec.endPoint.x + origin.x, y: sec.endPoint.y + origin.y });
      }
      routes.set(e.id, pts);
    }
    for (const child of node.children ?? []) collect(child);
  };
  collect(res);

  return { box, routes, w: r2(res.width ?? 0), h: r2(res.height ?? 0) };
}

/** Orthogonal polyline with softened corners. Reads like a drawn route, not a zigzag. */
function orthoPath(pts: XY[], radius = 6) {
  const p = pts.filter((pt, i) => i === 0 || Math.abs(pt.x - pts[i - 1]!.x) > 0.01 || Math.abs(pt.y - pts[i - 1]!.y) > 0.01);
  if (p.length === 0) return "";
  if (p.length < 3) return `M${r2(p[0]!.x)} ${r2(p[0]!.y)}` + p.slice(1).map((q) => `L${r2(q.x)} ${r2(q.y)}`).join("");

  let d = `M${r2(p[0]!.x)} ${r2(p[0]!.y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    const c = p[i + 1]!;
    const lenIn = Math.hypot(b.x - a.x, b.y - a.y);
    const lenOut = Math.hypot(c.x - b.x, c.y - b.y);
    const rIn = Math.min(radius, lenIn / 2);
    const rOut = Math.min(radius, lenOut / 2);
    const inX = b.x - ((b.x - a.x) / (lenIn || 1)) * rIn;
    const inY = b.y - ((b.y - a.y) / (lenIn || 1)) * rIn;
    const outX = b.x + ((c.x - b.x) / (lenOut || 1)) * rOut;
    const outY = b.y + ((c.y - b.y) / (lenOut || 1)) * rOut;
    d += `L${r2(inX)} ${r2(inY)}Q${r2(b.x)} ${r2(b.y)} ${r2(outX)} ${r2(outY)}`;
  }
  const last = p[p.length - 1]!;
  d += `L${r2(last.x)} ${r2(last.y)}`;
  return d;
}

/** Catmull-Rom through the routed points, so a polyline reads as one drawn stroke. */
function smoothPath(pts: XY[], tension = 0.5) {
  const p = pts.filter(
    (pt, i) => i === 0 || Math.hypot(pt.x - pts[i - 1]!.x, pt.y - pts[i - 1]!.y) > 0.01,
  );
  if (p.length < 2) return "";
  if (p.length === 2) {
    const [a, b] = p as [XY, XY];
    const dx = Math.max(26, Math.abs(b.x - a.x) * 0.42);
    return `M${r2(a.x)} ${r2(a.y)}C${r2(a.x + dx)} ${r2(a.y)} ${r2(b.x - dx)} ${r2(b.y)} ${r2(b.x)} ${r2(b.y)}`;
  }
  let d = `M${r2(p[0]!.x)} ${r2(p[0]!.y)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[Math.min(p.length - 1, i + 2)]!;
    const c1 = { x: p1.x + ((p2.x - p0.x) / 3) * tension, y: p1.y + ((p2.y - p0.y) / 3) * tension };
    const c2 = { x: p2.x - ((p3.x - p1.x) / 3) * tension, y: p2.y - ((p3.y - p1.y) / 3) * tension };
    d += `C${r2(c1.x)} ${r2(c1.y)} ${r2(c2.x)} ${r2(c2.y)} ${r2(p2.x)} ${r2(p2.y)}`;
  }
  return d;
}

const emptyState = (): State => ({ cells: {}, groups: {}, edges: [], w: 0, h: 0 });

// ===========================================================================
// Variant A - Blueprint. Files as containers, symbols as members, classes nest.
// ===========================================================================

const A_ROW = 27;
const A_PAD_X = 13;
const A_HEADER = 38;

function aCellSize(s: Graph["symbols"][number]) {
  const w = 24 + monoW(s.name, 11.5) + 18 + monoW(lineLabel(s), 9) + 12;
  return { w: Math.max(150, Math.round(w)), h: A_ROW };
}

function buildVariantA() {
  const cells: Cell[] = [];
  const groups: Group[] = [];

  for (const f of fileOrder) {
    const members = symbolsInFile(f.id);
    if (members.length === 0) continue;
    groups.push({
      gid: `A-file-${f.id}`,
      cls: `group file st-${f.status} ${f.touched ? "is-touched" : "is-neighbor"}`,
      un: !f.touched,
      body:
        `<rect class="box" x="0" y="0" width="10" height="10" rx="3"/>` +
        `<rect class="band" x="0" y="0" width="10" height="${A_HEADER}" data-span="width"/>` +
        `<line class="rule" x1="0" y1="${A_HEADER}" x2="10" y2="${A_HEADER}" data-span="x2"/>` +
        `<text class="g-name" x="${A_PAD_X}" y="17">${esc(baseOf(f.path))}</text>` +
        `<text class="g-meta" x="${A_PAD_X}" y="30">${esc(f.status)} &#183; ${members.length} symbols</text>`,
    });

    for (const s of members) {
      const { w, h } = aCellSize(s);
      const methods = methodsOf(s.id);
      if (methods.length > 0) {
        groups.push({
          gid: `A-class-${s.id}`,
          sym: s.id,
          cls: `group klass ${s.touched ? "is-touched" : "is-neighbor"}${s.signatureTouched ? " is-sig" : ""}`,
          un: !s.touched,
          body:
            `<rect class="box" x="0" y="0" width="10" height="10" rx="2"/>` +
            `<rect class="mark" x="0" y="0" width="3" height="10" data-span2="height"/>` +
            `<text class="c-kind" x="9" y="18">${kindTag[s.kind]}</text>` +
            `<text class="c-name" x="24" y="18">${esc(s.name)}</text>`,
        });
        continue;
      }
      cells.push({
        cid: `A-${s.id}`,
        sym: s.id,
        w,
        h,
        cls: symClass(s),
        body:
          `<rect class="box" x="0" y="0" width="${w}" height="${h}" rx="2"/>` +
          `<rect class="mark" x="0" y="0" width="3" height="${h}"/>` +
          `<rect class="sig" x="0" y="0" width="${w}" height="2.5"/>` +
          `<text class="c-kind" x="9" y="${h / 2 + 3.5}">${kindTag[s.kind]}</text>` +
          `<text class="c-name" x="24" y="${h / 2 + 3.5}">${esc(s.name)}</text>` +
          `<text class="c-line" x="${w - 10}" y="${h / 2 + 3.5}" text-anchor="end">${esc(lineLabel(s))}</text>`,
      });
    }
  }
  return { cells, groups };
}

async function layoutA(v: Variant, visible: Set<string>): Promise<State> {
  const sized = new Map(v.cells.filter((c) => c.sym).map((c) => [c.sym!, c]));
  const children: ElkNode[] = [];

  for (const f of fileOrder) {
    const members = topLevelIn(f.id).filter((s) => visible.has(s.id));
    if (members.length === 0) continue;
    const kids: ElkNode[] = [];
    for (const s of members) {
      const methods = methodsOf(s.id).filter((m) => visible.has(m.id));
      if (methods.length > 0) {
        kids.push({
          id: s.id,
          layoutOptions: {
            "elk.padding": "[top=30,left=10,bottom=10,right=10]",
            "elk.spacing.nodeNode": "7",
          },
          children: methods.map((m) => ({ id: m.id, width: sized.get(m.id)!.w, height: sized.get(m.id)!.h })),
        });
      } else {
        kids.push({ id: s.id, width: sized.get(s.id)!.w, height: sized.get(s.id)!.h });
      }
    }
    children.push({
      id: f.id,
      layoutOptions: {
        "elk.padding": `[top=${A_HEADER + 10},left=${A_PAD_X},bottom=14,right=${A_PAD_X}]`,
        "elk.spacing.nodeNode": "9",
      },
      children: kids,
    });
  }

  const wanted = visibleEdges(visible);
  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.randomSeed": "1",
      "elk.spacing.nodeNode": "22",
      "elk.layered.spacing.nodeNodeBetweenLayers": "52",
      "elk.spacing.edgeNode": "14",
      "elk.spacing.edgeEdge": "9",
      "elk.layered.spacing.edgeNodeBetweenLayers": "16",
      "elk.padding": "[top=30,left=30,bottom=30,right=30]",
      "elk.layered.mergeEdges": "false",
      "elk.layered.thoroughness": "12",
    },
    children,
    edges: wanted.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };

  const flat = flattenElk(await runElk(root));
  const st = emptyState();
  for (const c of v.cells) {
    const b = c.sym ? flat.box.get(c.sym) : undefined;
    if (b) st.cells[c.cid] = [b[0], b[1]];
  }
  for (const g of v.groups) {
    const key = g.gid.startsWith("A-file-") ? g.gid.slice("A-file-".length) : g.sym!;
    const b = flat.box.get(key);
    if (b) st.groups[g.gid] = b;
  }
  st.edges = v.edges.map((e) => {
    const i = wanted.findIndex((w) => w.from === e.from && w.to === e.to && w.kind === e.kind);
    const pts = i < 0 ? undefined : flat.routes.get(`e${i}`);
    return pts && pts.length > 1 ? orthoPath(pts) : "";
  });
  st.w = flat.w;
  st.h = flat.h;
  return st;
}

// ===========================================================================
// Variant B - Impact. Callers on the left, touched in the middle, callees right.
// ===========================================================================

/** 0 callers, 1 touched, 2 callees. elkjs turns partitions into bands of layers. */
function band(id: string) {
  if (symById.get(id)!.touched) return 1;
  const reachesTouched = calleesOf.get(id)!.some((t) => symById.get(t)!.touched);
  return reachesTouched ? 0 : 2;
}

function bCellSize(s: Graph["symbols"][number]) {
  if (s.touched) {
    const w = Math.max(
      262,
      Math.round(20 + monoW(s.name, 13) + 24),
      Math.round(20 + monoW(baseOf(fileById.get(s.fileId)!.path), 9.5) + 60),
    );
    return { w, h: 50 };
  }
  return { w: Math.max(140, Math.round(22 + monoW(s.name, 10.5) + 14)), h: 26 };
}

function buildVariantB() {
  const cells: Cell[] = [];
  for (const s of symbols) {
    const { w, h } = bCellSize(s);
    const f = fileById.get(s.fileId)!;
    const label = s.parentId ? `${symById.get(s.parentId)!.name}.${s.name}` : s.name;
    if (s.touched) {
      cells.push({
        cid: `B-${s.id}`,
        sym: s.id,
        w,
        h,
        cls: `${symClass(s)} big`,
        body:
          `<rect class="box" x="0" y="0" width="${w}" height="${h}" rx="2"/>` +
          `<rect class="mark" x="0" y="0" width="4" height="${h}"/>` +
          `<rect class="sig" x="0" y="0" width="${w}" height="3"/>` +
          `<text class="b-name" x="16" y="24">${esc(label)}</text>` +
          `<text class="b-file" x="16" y="39">${esc(baseOf(f.path))}<tspan class="b-dim">:${esc(lineLabel(s))}</tspan></text>` +
          `<text class="c-kind" x="${w - 12}" y="39" text-anchor="end">${kindTag[s.kind]}</text>`,
      });
    } else {
      cells.push({
        cid: `B-${s.id}`,
        sym: s.id,
        w,
        h,
        cls: symClass(s),
        body:
          `<rect class="box" x="0" y="0" width="${w}" height="${h}" rx="2"/>` +
          `<rect class="mark" x="0" y="0" width="3" height="${h}"/>` +
          `<text class="c-kind" x="9" y="17">${kindTag[s.kind]}</text>` +
          `<text class="c-name" x="22" y="17">${esc(label)}</text>`,
      });
    }
  }
  const groups: Group[] = [0, 1, 2].map((b) => ({
    gid: `B-band-${b}`,
    cls: `group lane lane-${b}`,
    un: false,
    body:
      `<rect class="lane-bg" x="0" y="0" width="10" height="10"/>` +
      `<text class="lane-label" x="0" y="-14">${["callers", "touched", "callees"][b]}</text>`,
  }));
  return { cells, groups };
}

async function layoutB(v: Variant, visible: Set<string>): Promise<State> {
  const sized = new Map(v.cells.filter((c) => c.sym).map((c) => [c.sym!, c]));
  const wanted = visibleEdges(visible);
  const present = symbols.filter((s) => visible.has(s.id));

  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.randomSeed": "1",
      "elk.partitioning.activate": "true",
      "elk.spacing.nodeNode": "16",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.spacing.edgeNode": "16",
      "elk.spacing.edgeEdge": "10",
      "elk.layered.crossingMinimization.semiInteractive": "true",
      "elk.edgeRouting": "POLYLINE",
      "elk.padding": "[top=54,left=30,bottom=30,right=30]",
    },
    children: present.map((s) => ({
      id: s.id,
      width: sized.get(s.id)!.w,
      height: sized.get(s.id)!.h,
      layoutOptions: { "elk.partitioning.partition": String(band(s.id)) },
    })),
    edges: wanted.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };

  const flat = flattenElk(await runElk(root));
  const st = emptyState();
  for (const c of v.cells) {
    const b = c.sym ? flat.box.get(c.sym) : undefined;
    if (b) st.cells[c.cid] = [b[0], b[1]];
  }

  // Lane plates are derived from where the nodes landed, so they always frame the real content.
  for (const b of [0, 1, 2]) {
    const members = present.filter((s) => band(s.id) === b).map((s) => flat.box.get(s.id)!).filter(Boolean);
    if (members.length === 0) continue;
    const x0 = Math.min(...members.map((m) => m[0])) - 18;
    const y0 = Math.min(...members.map((m) => m[1])) - 18;
    const x1 = Math.max(...members.map((m) => m[0] + m[2])) + 18;
    const y1 = Math.max(...members.map((m) => m[1] + m[3])) + 18;
    st.groups[`B-band-${b}`] = [r2(x0), r2(y0), r2(x1 - x0), r2(y1 - y0)];
  }

  st.edges = v.edges.map((e) => {
    const i = wanted.findIndex((w) => w.from === e.from && w.to === e.to && w.kind === e.kind);
    const pts = i < 0 ? undefined : flat.routes.get(`e${i}`);
    if (!pts || pts.length < 2) return "";
    return smoothPath(pts);
  });
  st.w = flat.w;
  st.h = flat.h;
  return st;
}

// ===========================================================================
// Variant C - Ledger. Every symbol on one vertical axis, call arcs on a spine.
// ===========================================================================

const C_GUTTER = Math.round(Math.max(320, Math.max(...files.map((f) => monoW(f.path, 11))) + 104));
const C_ROW = 21;
const C_FILE_ROW = 30;
const C_BAR = 246;

const C_SPINE = C_GUTTER + C_BAR + 34;

function buildVariantC() {
  const cells: Cell[] = [];
  const groups: Group[] = [
    {
      gid: "C-spine",
      cls: "group spine",
      un: false,
      body: `<line class="spine-line" x1="0" y1="0" x2="0" y2="10" data-span2="y2"/>`,
    },
  ];
  for (const f of fileOrder) {
    const members = symbolsInFile(f.id);
    if (members.length === 0) continue;
    groups.push({
      gid: `C-file-${f.id}`,
      cls: `group row-file st-${f.status} ${f.touched ? "is-touched" : "is-neighbor"}`,
      un: !f.touched,
      body:
        `<line class="rule" x1="0" y1="0" x2="10" y2="0" data-span="x2"/>` +
        `<text class="r-path" x="0" y="17"><tspan class="r-dir">${esc(dirOf(f.path))}</tspan>${esc(baseOf(f.path))}</text>` +
        `<text class="r-status" x="${C_GUTTER - 14}" y="17" text-anchor="end">${esc(f.status)}</text>`,
    });
    for (const s of members) {
      const indent = s.parentId ? 16 : 0;
      cells.push({
        cid: `C-${s.id}`,
        sym: s.id,
        w: C_BAR - indent,
        h: C_ROW,
        cls: symClass(s),
        body:
          `<rect class="box" x="0" y="0" width="${C_BAR - indent}" height="${C_ROW}" rx="1.5"/>` +
          `<rect class="mark" x="0" y="0" width="3" height="${C_ROW}"/>` +
          `<rect class="sig" x="0" y="0" width="${C_BAR - indent}" height="2"/>` +
          `<text class="c-kind" x="8" y="14.5">${kindTag[s.kind]}</text>` +
          `<text class="c-name" x="20" y="14.5">${esc(s.name)}</text>` +
          `<text class="c-line" x="${C_BAR - indent - 8}" y="14.5" text-anchor="end">${esc(lineLabel(s))}</text>`,
      });
      cells.push({
        cid: `C-lead-${s.id}`,
        w: 34,
        h: C_ROW,
        cls: "deco",
        body: `<line class="leader" x1="0" y1="${C_ROW / 2}" x2="34" y2="${C_ROW / 2}"/>`,
      });
    }
  }
  return { cells, groups };
}

function layoutC(v: Variant, visible: Set<string>): State {
  const st = emptyState();
  const spine = C_SPINE;
  const rowY = new Map<string, number>();
  let y = 30;

  for (const f of fileOrder) {
    const members = symbolsInFile(f.id).filter((s) => visible.has(s.id));
    if (members.length === 0) continue;
    st.groups[`C-file-${f.id}`] = [r2(0), r2(y), r2(spine + 14), r2(C_FILE_ROW + members.length * (C_ROW + 3))];
    y += C_FILE_ROW;
    for (const s of members) {
      const indent = s.parentId ? 16 : 0;
      st.cells[`C-${s.id}`] = [r2(C_GUTTER + indent), r2(y)];
      st.cells[`C-lead-${s.id}`] = [r2(C_GUTTER + C_BAR), r2(y)];
      rowY.set(s.id, y + C_ROW / 2);
      y += C_ROW + 3;
    }
    y += 13;
  }

  let maxBow = 0;
  st.edges = v.edges.map((e) => {
    const y1 = rowY.get(e.from);
    const y2 = rowY.get(e.to);
    if (y1 === undefined || y2 === undefined) return "";
    const span = Math.abs(y2 - y1);
    const bow = Math.min(64 + span * 0.5, 620);
    maxBow = Math.max(maxBow, bow);
    const x0 = spine + 2;
    const mid = (y1 + y2) / 2;
    return (
      `M${r2(x0)} ${r2(y1)}` +
      `C${r2(x0 + bow)} ${r2(y1)} ${r2(x0 + bow)} ${r2(mid)} ${r2(x0 + bow * 0.62)} ${r2(mid)}` +
      `C${r2(x0 + bow)} ${r2(mid)} ${r2(x0 + bow)} ${r2(y2)} ${r2(x0 + 7)} ${r2(y2)}`
    );
  });

  st.groups["C-spine"] = [r2(spine), r2(18), 0, r2(y - 6)];
  st.w = r2(spine + maxBow + 60);
  st.h = r2(y + 20);
  return st;
}

// ===========================================================================
// Variant D - Dossier. No edges. One card per touched file, neighbors as chips.
// ===========================================================================

const D_CARD = 398;
const D_COLS = 3;
const D_GAP = 26;

function chipSize(label: string) {
  return { w: Math.round(22 + monoW(label, 10)), h: 20 };
}

function buildVariantD() {
  const cells: Cell[] = [];
  const groups: Group[] = [];

  for (const f of fileOrder.filter((f) => f.touched)) {
    const members = symbolsInFile(f.id).filter((s) => s.touched);
    if (members.length === 0) continue;
    groups.push({
      gid: `D-card-${f.id}`,
      cls: `group card st-${f.status}`,
      un: false,
      body:
        `<rect class="box" x="0" y="0" width="${D_CARD}" height="10" rx="3" data-span2="height"/>` +
        `<rect class="mark" x="0" y="0" width="3" height="10" data-span2="height"/>` +
        `<text class="d-dir" x="18" y="24">${esc(dirOf(f.path))}</text>` +
        `<text class="d-base" x="18" y="41">${esc(baseOf(f.path))}</text>` +
        `<text class="d-status" x="${D_CARD - 18}" y="24" text-anchor="end">${esc(f.status)}</text>` +
        `<line class="rule" x1="18" y1="52" x2="${D_CARD - 18}" y2="52"/>`,
    });

    for (const s of members) {
      cells.push({
        cid: `D-t-${s.id}`,
        sym: s.id,
        w: D_CARD - 36,
        h: 24,
        cls: `${symClass(s)} title`,
        body:
          `<rect class="box" x="0" y="0" width="${D_CARD - 36}" height="24" rx="2"/>` +
          `<rect class="sig" x="0" y="0" width="${D_CARD - 36}" height="2.5"/>` +
          `<text class="c-kind" x="8" y="16">${kindTag[s.kind]}</text>` +
          `<text class="d-name" x="21" y="16">${esc(s.parentId ? `${symById.get(s.parentId)!.name}.${s.name}` : s.name)}</text>` +
          `<text class="c-line" x="${D_CARD - 44}" y="16" text-anchor="end">${esc(lineLabel(s))}</text>`,
      });
      for (const dir of ["in", "out"] as const) {
        cells.push({
          cid: `D-lbl-${dir}-${s.id}`,
          w: 58,
          h: 20,
          cls: "deco",
          body: `<text class="row-label" x="0" y="14">${dir === "in" ? "called by" : "calls"}</text>`,
        });
        cells.push({
          cid: `D-none-${dir}-${s.id}`,
          w: 240,
          h: 20,
          cls: "deco",
          body: `<text class="chip-empty" x="0" y="14">${dir === "in" ? "nothing in this graph calls it" : "calls nothing in this graph"}</text>`,
        });
        const list = (dir === "in" ? callersOf : calleesOf).get(s.id)!;
        for (const other of [...new Set(list)].sort(cmp)) {
          const o = symById.get(other)!;
          const label = o.parentId ? `${symById.get(o.parentId)!.name}.${o.name}` : o.name;
          const { w, h } = chipSize(label);
          cells.push({
            cid: `D-${dir}-${s.id}-${other}`,
            sym: other,
            w,
            h,
            cls: `cell chip chip-${dir} ${o.touched ? "is-touched" : "is-neighbor"}${o.signatureTouched ? " is-sig" : ""}`,
            body:
              `<rect class="box" x="0" y="0" width="${w}" height="${h}" rx="10"/>` +
              `<text class="chip-name" x="11" y="14">${esc(label)}</text>`,
          });
        }
      }
    }
  }
  return { cells, groups };
}

function layoutD(v: Variant, visible: Set<string>): State {
  const st = emptyState();
  const cols = Array.from({ length: D_COLS }, () => 30);
  const inner = D_CARD - 36;

  for (const f of fileOrder.filter((f) => f.touched)) {
    const members = symbolsInFile(f.id).filter((s) => s.touched && visible.has(s.id));
    if (members.length === 0) continue;

    // Shortest column wins, ties go left. Deterministic packing.
    let col = 0;
    for (let i = 1; i < D_COLS; i++) if (cols[i]! < cols[col]! - 0.001) col = i;
    const x = 30 + col * (D_CARD + D_GAP);
    const top = cols[col]!;
    let y = top + 66;

    for (const s of members) {
      st.cells[`D-t-${s.id}`] = [r2(x + 18), r2(y)];
      y += 28;
      for (const dir of ["in", "out"] as const) {
        const list = [...new Set((dir === "in" ? callersOf : calleesOf).get(s.id)!)]
          .sort(cmp)
          .filter((id) => visible.has(id));
        if (list.length === 0) {
          st.cells[`D-none-${dir}-${s.id}`] = [r2(x + 18 + 62), r2(y)];
          y += 24;
          continue;
        }
        st.cells[`D-lbl-${dir}-${s.id}`] = [r2(x + 18), r2(y + 1)];
        let cx = x + 18 + 62;
        let rowTop = y;
        for (const other of list) {
          const o = symById.get(other)!;
          const label = o.parentId ? `${symById.get(o.parentId)!.name}.${o.name}` : o.name;
          const { w } = chipSize(label);
          if (cx + w > x + 18 + inner) {
            cx = x + 18 + 62;
            rowTop += 24;
          }
          st.cells[`D-${dir}-${s.id}-${other}`] = [r2(cx), r2(rowTop)];
          cx += w + 6;
        }
        y = rowTop + 30;
      }
      y += 8;
    }

    const height = y - top + 8;
    st.groups[`D-card-${f.id}`] = [r2(x), r2(top), r2(D_CARD), r2(height)];
    cols[col] = top + height + D_GAP;
  }

  st.w = r2(30 + D_COLS * (D_CARD + D_GAP) + 4);
  st.h = r2(Math.max(...cols) + 10);
  st.edges = v.edges.map(() => "");
  return st;
}

// ===========================================================================
// Build every variant
// ===========================================================================

const allEdges: EdgeRef[] = edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind }));

const a = buildVariantA();
const variantA: Variant = {
  key: "A",
  name: "Blueprint",
  note: "files as containers, symbols as members",
  cells: a.cells,
  groups: a.groups,
  edges: allEdges,
  full: emptyState(),
  focus: emptyState(),
};
variantA.full = await layoutA(variantA, ALL);
variantA.focus = await layoutA(variantA, FOCUS);

const b = buildVariantB();
const variantB: Variant = {
  key: "B",
  name: "Impact",
  note: "callers, touched, callees, left to right",
  cells: b.cells,
  groups: b.groups,
  edges: allEdges,
  full: emptyState(),
  focus: emptyState(),
};
variantB.full = await layoutB(variantB, ALL);
variantB.focus = await layoutB(variantB, FOCUS);

const c = buildVariantC();
const variantC: Variant = {
  key: "C",
  name: "Ledger",
  note: "every symbol in one column, calls as arcs",
  cells: c.cells,
  groups: c.groups,
  edges: allEdges,
  full: emptyState(),
  focus: emptyState(),
};
variantC.full = layoutC(variantC, ALL);
variantC.focus = layoutC(variantC, FOCUS);

const d = buildVariantD();
const variantD: Variant = {
  key: "D",
  name: "Dossier",
  note: "no lines, one card per touched file",
  cells: d.cells,
  groups: d.groups,
  edges: allEdges,
  full: emptyState(),
  focus: emptyState(),
};
variantD.full = layoutD(variantD, ALL);
variantD.focus = layoutD(variantD, FOCUS);

const variants = [variantA, variantB, variantC, variantD];

// ===========================================================================
// Emit
// ===========================================================================

/** `<` must not appear raw inside a script element. \u003c is valid JSON. */
const island = (id: string, value: unknown) =>
  `<script type="application/json" id="${id}">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`;

const graphData = {
  pr: graph.pr,
  files: files.map((f) => ({ id: f.id, path: f.path, touched: f.touched, status: f.status })),
  symbols: symbols.map((s) => ({
    id: s.id,
    file: s.fileId,
    name: s.parentId ? `${symById.get(s.parentId)!.name}.${s.name}` : s.name,
    kind: s.kind,
    lines: lineLabel(s),
    touched: s.touched,
    sig: s.signatureTouched,
    hop: s.hop,
  })),
  edges: allEdges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
};

const layoutData: Record<string, { full: State; focus: State }> = {};
for (const v of variants) layoutData[v.key] = { full: v.full, focus: v.focus };

const sceneSvg = (v: Variant) => {
  const groups = v.groups
    .map(
      (g) =>
        `<g class="${g.cls}" data-gid="${g.gid}"${g.sym ? ` data-sym="${g.sym}"` : ""}${g.un ? ` data-un="1"` : ""}>${g.body}</g>`,
    )
    .join("");
  const wires = v.edges
    .map((e, i) => {
      const un = isUntouched(e.from) || isUntouched(e.to);
      return `<path class="edge edge-${e.kind}" data-ei="${i}" data-from="${e.from}" data-to="${e.to}"${un ? ` data-un="1"` : ""} marker-end="url(#arrow-${e.kind})"/>`;
    })
    .join("");
  const cells = v.cells
    .map((c) => {
      const sym = c.sym ? ` data-sym="${c.sym}"` : "";
      const un = c.sym && isUntouched(c.sym) ? ` data-un="1"` : "";
      return `<g class="${c.cls}" data-cid="${c.cid}"${sym}${un}>${c.body}</g>`;
    })
    .join("");
  return `<g class="scene" data-v="${v.key}"><g class="vp"><rect class="grid" x="-4000" y="-4000" width="16000" height="16000"/><g class="layer-groups">${groups}</g><g class="layer-edges">${wires}</g><g class="layer-cells">${cells}</g></g></g>`;
};

const counts = {
  touchedFiles: files.filter((f) => f.touched).length,
  touchedSymbols: touchedSyms.length,
  neighbors: neighbourSyms.length,
  neighborFiles: files.filter((f) => !f.touched).length,
  calls: edges.filter((e) => e.kind === "call").length,
};

const css = `
:root{
  --paper:oklch(0.972 0.008 84);
  --paper-2:oklch(0.951 0.012 84);
  --card:oklch(0.995 0.004 84);
  --ink:oklch(0.27 0.019 264);
  --ink-2:oklch(0.46 0.016 264);
  --ink-3:oklch(0.63 0.014 264);
  --hair:oklch(0.27 0.019 264 / 0.22);
  --touch:oklch(0.548 0.183 32);
  --touch-soft:oklch(0.548 0.183 32 / 0.09);
  --sig:oklch(0.466 0.134 286);
  --serif:ui-serif,"Iowan Old Style","Palatino Linotype",Palatino,"Hoefler Text",Georgia,serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,"Cascadia Mono",Consolas,monospace;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{
  background:var(--paper);color:var(--ink);font-family:var(--serif);
  display:grid;grid-template-columns:1fr 306px;grid-template-rows:auto 1fr;
  overflow:hidden;-webkit-font-smoothing:antialiased;
}
.masthead{
  grid-column:1/3;display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;
  padding:15px 22px 13px;border-bottom:1px solid var(--hair);background:var(--paper);
}
.masthead .pr{font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:var(--touch)}
.masthead h1{margin:0;font-size:19px;font-weight:600;letter-spacing:-.008em;line-height:1.2}
.masthead .sha{font-family:var(--mono);font-size:10.5px;color:var(--ink-3)}
.masthead .tally{margin-left:auto;display:flex;gap:16px;font-family:var(--mono);font-size:10.5px;color:var(--ink-2)}
.masthead .tally b{font-weight:600;color:var(--ink)}
.stagewrap{position:relative;overflow:hidden;border-right:1px solid var(--hair)}
svg#stage{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
svg#stage.dragging{cursor:grabbing}
.scene{display:none}
.scene.on{display:inline}

/* ---- drafting surface ---- */
.grid{fill:url(#dots)}

/* ---- file containers, lanes, cards ---- */
.group .box{fill:var(--card);stroke:var(--hair);stroke-width:1}
.group.file .band{fill:var(--paper-2)}
.group.file .rule,.group .rule{stroke:var(--hair);stroke-width:1}
.group.file.is-touched .box{stroke:oklch(0.27 0.019 264 / 0.42)}
.group.file.is-neighbor .box{fill:none;stroke-dasharray:3 3}
.group.file.is-neighbor .band{fill:none}
.g-name{font-family:var(--mono);font-size:12px;font-weight:600;fill:var(--ink)}
.g-meta{font-family:var(--mono);font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;fill:var(--ink-3)}
.group.st-deleted .g-name{text-decoration:line-through;fill:var(--ink-2)}
.group.st-deleted .box{fill:url(#hatch)}
.group.st-added .band{fill:var(--touch-soft)}
.group.klass .box{fill:oklch(0.27 0.019 264 / 0.035);stroke:var(--hair)}
.group.klass .mark{fill:none}
.group.klass.is-touched .mark{fill:var(--touch)}
.lane-bg{fill:none;stroke:var(--hair);stroke-dasharray:2 5}
.lane-1 .lane-bg{fill:var(--touch-soft);stroke:oklch(0.548 0.183 32 / 0.3);stroke-dasharray:none}
.lane-label{font-family:var(--mono);font-size:9px;letter-spacing:.16em;text-transform:uppercase;fill:var(--ink-3)}
.lane-1 .lane-label{fill:var(--touch)}
.group.row-file .rule{stroke:oklch(0.27 0.019 264 / 0.35)}
.group.row-file.is-neighbor .rule{stroke-dasharray:2 3}
.r-path{font-family:var(--mono);font-size:11px;fill:var(--ink)}
.r-dir{fill:var(--ink-3)}
.r-status{font-family:var(--mono);font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;fill:var(--ink-3)}
.group.row-file.st-deleted .r-path{text-decoration:line-through}
.group.card .box{fill:var(--card);stroke:oklch(0.27 0.019 264 / 0.3)}
.group.card .mark{fill:var(--touch)}
.group.card.st-untouched .mark{fill:var(--ink-3)}
.d-dir{font-family:var(--mono);font-size:9.5px;fill:var(--ink-3)}
.d-base{font-family:var(--mono);font-size:13px;font-weight:600;fill:var(--ink)}
.d-status{font-family:var(--mono);font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;fill:var(--touch)}
.group.card.st-deleted .d-base{text-decoration:line-through}

/* ---- symbol cells: one visual language in all four variants ---- */
.cell{cursor:pointer}
.cell .box{fill:var(--card);stroke:var(--hair);stroke-width:1}
.cell .mark{fill:none}
.cell .sig{fill:none}
.cell.is-touched .box{stroke:oklch(0.548 0.183 32 / 0.55)}
.cell.is-touched .mark{fill:var(--touch)}
.cell.is-touched .c-name,.cell.is-touched .b-name,.cell.is-touched .d-name{fill:var(--ink)}
.cell.is-neighbor .box{fill:var(--paper-2);stroke-dasharray:3 2.5}
.cell.is-neighbor .mark{fill:oklch(0.63 0.014 264)}
.cell.is-neighbor .c-name{fill:var(--ink-2)}
.cell.is-sig .sig{fill:var(--sig)}
.cell.is-gone .box{fill:url(#hatch)}
.cell.is-gone .c-name,.cell.is-gone .b-name{text-decoration:line-through}
.c-kind{font-family:var(--mono);font-size:8.5px;fill:var(--ink-3)}
.c-name{font-family:var(--mono);font-size:11.5px;fill:var(--ink)}
.c-line{font-family:var(--mono);font-size:9px;fill:var(--ink-3)}
.b-name{font-family:var(--mono);font-size:13px;font-weight:600;fill:var(--ink)}
.b-file{font-family:var(--mono);font-size:9.5px;fill:var(--ink-2)}
.b-dim{fill:var(--ink-3)}
.d-name{font-family:var(--mono);font-size:11.5px;font-weight:600;fill:var(--ink)}
.cell.title .box{fill:none;stroke:none}
.chip .box{fill:var(--paper-2);stroke:var(--hair)}
.chip.is-touched .box{fill:var(--touch-soft);stroke:oklch(0.548 0.183 32 / 0.4)}
.chip.is-sig .box{stroke:var(--sig)}
.chip-arrow{font-family:var(--mono);font-size:9px;fill:var(--ink-3)}
.chip-name{font-family:var(--mono);font-size:10px;fill:var(--ink-2)}
.chip.is-touched .chip-name{fill:var(--ink)}
.chip-empty{font-family:var(--serif);font-size:10px;font-style:italic;fill:var(--ink-3)}
.deco{pointer-events:none}
.leader{stroke:oklch(0.27 0.019 264 / 0.3);stroke-width:1;stroke-dasharray:1 3}
.spine-line{stroke:oklch(0.27 0.019 264 / 0.45);stroke-width:1}
.row-label{font-family:var(--mono);font-size:8.5px;letter-spacing:.09em;text-transform:uppercase;fill:var(--ink-3)}

/* ---- edges ---- */
.edge{fill:none;stroke:oklch(0.27 0.019 264 / 0.44);stroke-width:1.15}
.edge-import{stroke-dasharray:2 3;stroke:oklch(0.27 0.019 264 / 0.28)}
.cell,.group,.edge{transition:transform .34s cubic-bezier(.22,1,.36,1),opacity .18s linear}
.edge{transition:opacity .16s linear}

/* ---- selection ---- */
.scene.has-sel .cell:not(.lit),.scene.has-sel .group.klass:not(.lit){opacity:.16}
.scene.has-sel .edge:not(.lit){opacity:.05}
.scene.has-sel .group.file,.scene.has-sel .group.card,.scene.has-sel .group.row-file{opacity:.5}
.cell.sel .box{stroke:var(--ink);stroke-width:1.8}
.cell.lit-in .box{stroke:var(--sig);stroke-width:1.4}
.cell.lit-out .box{stroke:oklch(0.47 0.09 200);stroke-width:1.4}
.edge.lit{stroke-width:1.9;stroke:var(--ink)}
.edge.lit-in{stroke:var(--sig)}
.edge.lit-out{stroke:oklch(0.47 0.09 200)}
.hidden{display:none}
.swapping .edge{opacity:0 !important}

/* ---- rail ---- */
.rail{overflow-y:auto;padding:16px 18px 90px;display:flex;flex-direction:column;gap:18px;background:var(--paper)}
.rail h2{font-size:9.5px;letter-spacing:.17em;text-transform:uppercase;color:var(--ink-3);margin:0 0 9px;font-weight:600;font-family:var(--mono)}
.legend{display:flex;flex-direction:column;gap:7px}
.legend div{display:flex;align-items:center;gap:9px;font-size:11.5px;color:var(--ink-2)}
.swatch{width:28px;height:16px;flex:none;border:1px solid var(--hair);background:var(--card);position:relative}
.swatch.t{border-color:oklch(0.548 0.183 32 / 0.55);box-shadow:inset 3px 0 0 var(--touch)}
.swatch.n{background:var(--paper-2);border-style:dashed;box-shadow:inset 3px 0 0 var(--ink-3)}
.swatch.s{border-color:oklch(0.548 0.183 32 / 0.55);box-shadow:inset 3px 0 0 var(--touch),inset 0 3px 0 var(--sig)}
.swatch.g{background:repeating-linear-gradient(45deg,transparent,transparent 3px,var(--hair) 3px,var(--hair) 4px)}
.kinds{font-family:var(--mono);font-size:10.5px;color:var(--ink-2);line-height:1.7}
.kinds b{color:var(--ink);font-weight:600}
.toggle{display:flex;align-items:center;gap:10px;font-size:12px;cursor:pointer;user-select:none;color:var(--ink)}
.toggle input{appearance:none;width:32px;height:18px;border-radius:9px;background:var(--paper-2);border:1px solid var(--hair);position:relative;cursor:pointer;transition:background .18s}
.toggle input::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--ink-3);transition:transform .2s cubic-bezier(.22,1,.36,1)}
.toggle input:checked{background:var(--touch-soft);border-color:var(--touch)}
.toggle input:checked::after{transform:translateX(14px);background:var(--touch)}
.hint{font-size:11px;line-height:1.5;color:var(--ink-3);font-style:italic}
.inspector{border-top:1px solid var(--hair);padding-top:15px}
.insp-name{font-family:var(--mono);font-size:13.5px;font-weight:600;word-break:break-all;line-height:1.3}
.insp-path{font-family:var(--mono);font-size:10px;color:var(--ink-3);word-break:break-all;margin-top:5px;line-height:1.45}
.badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
.badge{font-family:var(--mono);font-size:9px;letter-spacing:.07em;text-transform:uppercase;padding:2.5px 6px;border:1px solid var(--hair);color:var(--ink-2)}
.badge.t{border-color:var(--touch);color:var(--touch)}
.badge.s{border-color:var(--sig);color:var(--sig)}
.rel{margin-top:15px}
.rel h3{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);margin:0 0 6px;font-weight:600;font-family:var(--mono);display:flex;justify-content:space-between}
.rel button{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--hair);padding:5px 0;font-family:var(--mono);font-size:11px;color:var(--ink);cursor:pointer;line-height:1.35}
.rel button:hover{color:var(--touch)}
.rel button span{display:block;font-size:9px;color:var(--ink-3)}
.rel .none{font-size:11px;color:var(--ink-3);font-style:italic;font-family:var(--serif)}

/* ---- tooltip ---- */
.tip{position:fixed;pointer-events:none;opacity:0;transform:translateY(3px);transition:opacity .11s;background:var(--ink);color:var(--paper);padding:6px 9px;font-family:var(--mono);font-size:10.5px;line-height:1.5;max-width:400px;z-index:40;box-shadow:0 5px 18px oklch(0.27 0.019 264 / .28)}
.tip.on{opacity:1;transform:none}
.tip b{color:var(--paper);font-weight:600}
.tip i{color:oklch(0.8 0.03 84);font-style:normal}

/* ---- floating switcher ---- */
.switcher{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);display:flex;align-items:stretch;background:var(--ink);color:var(--paper);z-index:50;box-shadow:0 8px 26px oklch(0.27 0.019 264 / .34)}
.switcher button{background:none;border:0;color:var(--paper);font-family:var(--mono);font-size:14px;padding:0 13px;cursor:pointer;opacity:.75}
.switcher button:hover{opacity:1;background:oklch(1 0 0 / .1)}
.switcher .label{padding:9px 16px;display:flex;flex-direction:column;gap:1px;min-width:232px;border-left:1px solid oklch(1 0 0 /.16);border-right:1px solid oklch(1 0 0 /.16)}
.switcher .k{font-family:var(--mono);font-size:11.5px;letter-spacing:.03em}
.switcher .k b{color:oklch(0.83 0.13 60)}
.switcher .n{font-size:10px;opacity:.6;font-family:var(--serif);font-style:italic}
.zoom{position:absolute;right:14px;bottom:14px;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--hair)}
.zoom button{background:none;border:0;border-bottom:1px solid var(--hair);width:29px;height:27px;cursor:pointer;font-family:var(--mono);font-size:13px;color:var(--ink-2)}
.zoom button:last-child{border-bottom:0;font-size:9px}
.zoom button:hover{background:var(--paper-2);color:var(--ink)}
.proto{position:absolute;left:14px;bottom:14px;font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
`;

const script = `
const G = JSON.parse(document.getElementById("graph-data").textContent);
const L = JSON.parse(document.getElementById("layout-data").textContent);
const VS = ${JSON.stringify(variants.map((v) => ({ key: v.key, name: v.name, note: v.note })))};

const sym = new Map(G.symbols.map(s => [s.id, s]));
const file = new Map(G.files.map(f => [f.id, f]));
const inOf = new Map(G.symbols.map(s => [s.id, []]));
const outOf = new Map(G.symbols.map(s => [s.id, []]));
for (const e of G.edges) { inOf.get(e.to).push(e.from); outOf.get(e.from).push(e.to); }

const stage = document.getElementById("stage");
const scenes = {};
for (const g of stage.querySelectorAll(".scene")) {
  const key = g.dataset.v;
  scenes[key] = {
    root: g, vp: g.querySelector(".vp"),
    cells: [...g.querySelectorAll("[data-cid]")],
    groups: [...g.querySelectorAll("[data-gid]")],
    edges: [...g.querySelectorAll("[data-ei]")],
    view: null, fitted: false,
  };
}

let variant = "A", focus = false, selected = null;

/* ---- geometry ---- */
function place(key, state) {
  const S = scenes[key], P = L[key][state];
  for (const el of S.cells) {
    const p = P.cells[el.dataset.cid];
    if (p) { el.setAttribute("transform", "translate(" + p[0] + " " + p[1] + ")"); el.classList.remove("nopos"); }
    else el.classList.add("nopos");
  }
  for (const el of S.groups) {
    const b = P.groups[el.dataset.gid];
    if (!b) { el.classList.add("nopos"); continue; }
    el.classList.remove("nopos");
    el.setAttribute("transform", "translate(" + b[0] + " " + b[1] + ")");
    for (const t of el.querySelectorAll("[data-span]")) t.setAttribute(t.dataset.span, b[2]);
    for (const t of el.querySelectorAll("[data-span2]")) t.setAttribute(t.dataset.span2, b[3]);
    const box = el.querySelector(".box");
    if (box) { box.setAttribute("width", b[2]); box.setAttribute("height", b[3]); }
    const bg = el.querySelector(".lane-bg");
    if (bg) { bg.setAttribute("width", b[2]); bg.setAttribute("height", b[3]); }
  }
  for (const el of S.edges) {
    const d = P.edges[+el.dataset.ei] || "";
    if (d) { el.setAttribute("d", d); el.classList.remove("nopos"); }
    else el.classList.add("nopos");
  }
  S.bounds = { w: P.w, h: P.h };
  applyVisibility(key);
}

function applyVisibility(key) {
  const S = scenes[key];
  for (const el of [...S.cells, ...S.groups, ...S.edges]) {
    const drop = el.classList.contains("nopos") || (focus && el.dataset.un === "1");
    el.classList.toggle("hidden", drop);
  }
}

/* ---- pan and zoom ---- */
function view(key, floor) {
  const S = scenes[key];
  if (!S.view) {
    const r = stage.getBoundingClientRect(), b = S.bounds || { w: 1000, h: 1000 };
    const whole = Math.min((r.width - 40) / Math.max(b.w, 1), (r.height - 40) / Math.max(b.h, 1));
    // A wide call graph would fit at an unreadable scale, so open no smaller than the floor and pan.
    const k = Math.min(1.05, Math.max(whole, floor || 0));
    S.view = { k, x: (r.width - b.w * k) / 2, y: Math.max(14, (r.height - b.h * k) / 2) };
  }
  return S.view;
}
function paint(key) {
  const v = view(key);
  scenes[key].vp.setAttribute("transform", "translate(" + v.x + " " + v.y + ") scale(" + v.k + ")");
}
function fit(key, floor) { scenes[key].view = null; view(key, floor); paint(key); }

let drag = null;
stage.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  const v = view(variant);
  // Pointer capture retargets pointerup to the stage, so remember the hit now.
  const hit = e.target.closest("[data-sym]");
  drag = { px: e.clientX, py: e.clientY, x: v.x, y: v.y, moved: false, sym: hit ? hit.dataset.sym : null };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add("dragging");
});
stage.addEventListener("pointermove", e => {
  if (!drag) return;
  const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  const v = view(variant); v.x = drag.x + dx; v.y = drag.y + dy; paint(variant);
});
stage.addEventListener("pointerup", () => {
  if (drag && !drag.moved) select(drag.sym);
  drag = null; stage.classList.remove("dragging");
});
stage.addEventListener("wheel", e => {
  e.preventDefault();
  const v = view(variant), r = stage.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const step = Math.exp(-e.deltaY * (e.ctrlKey ? 0.008 : 0.0016));
  const k = Math.max(0.08, Math.min(4, v.k * step));
  v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k;
  paint(variant);
}, { passive: false });
function zoomBy(f) {
  const v = view(variant), r = stage.getBoundingClientRect(), mx = r.width / 2, my = r.height / 2;
  const k = Math.max(0.08, Math.min(4, v.k * f));
  v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k;
  paint(variant);
}

/* ---- hover ---- */
const tip = document.querySelector(".tip");
stage.addEventListener("mousemove", e => {
  const hit = e.target.closest("[data-sym]");
  if (!hit || drag) { tip.classList.remove("on"); return; }
  const s = sym.get(hit.dataset.sym), f = file.get(s.file);
  tip.innerHTML = "<b>" + s.name + "</b>  <i>" + s.kind + "</i><br>" + f.path + "<i>:" + s.lines + "</i>" +
    "<br><i>" + inOf.get(s.id).length + " callers &#183; " + outOf.get(s.id).length + " callees" +
    (s.touched ? " &#183; touched" : " &#183; neighbor hop " + s.hop) + (s.sig ? " &#183; signature changed" : "") + "</i>";
  tip.classList.add("on");
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(e.clientX + 14, innerWidth - r.width - 8) + "px";
  tip.style.top = Math.min(e.clientY + 16, innerHeight - r.height - 8) + "px";
});
stage.addEventListener("mouseleave", () => tip.classList.remove("on"));

/* ---- selection: callers and callees lit, everything else dim ---- */
function select(id) {
  selected = selected === id ? null : id;
  for (const key in scenes) {
    const S = scenes[key];
    S.root.classList.toggle("has-sel", !!selected);
    for (const el of [...S.cells, ...S.groups]) el.classList.remove("lit", "lit-in", "lit-out", "sel");
    for (const el of S.edges) el.classList.remove("lit", "lit-in", "lit-out");
    if (!selected) continue;
    const ins = new Set(inOf.get(selected)), outs = new Set(outOf.get(selected));
    for (const el of [...S.cells, ...S.groups]) {
      const sid = el.dataset.sym;
      if (!sid) continue;
      if (sid === selected) el.classList.add("lit", "sel");
      else if (ins.has(sid)) el.classList.add("lit", "lit-in");
      else if (outs.has(sid)) el.classList.add("lit", "lit-out");
    }
    for (const el of S.edges) {
      if (el.dataset.to === selected) el.classList.add("lit", "lit-in");
      else if (el.dataset.from === selected) el.classList.add("lit", "lit-out");
    }
  }
  inspect();
}

/* ---- inspector ---- */
const insp = document.getElementById("inspector");
function row(id, dir) {
  const s = sym.get(id), f = file.get(s.file);
  return '<button data-jump="' + id + '">' + (dir === "in" ? "&#8592; " : "&#8594; ") + s.name +
    "<span>" + f.path + ":" + s.lines + (s.touched ? "  &#183; touched" : "") + "</span></button>";
}
function inspect() {
  if (!selected) {
    insp.innerHTML = '<h2>Selection</h2><p class="hint">Click any symbol to trace its callers and callees. Everything else dims. Click it again to release.</p>';
    return;
  }
  const s = sym.get(selected), f = file.get(s.file);
  const ins = [...new Set(inOf.get(selected))].sort(), outs = [...new Set(outOf.get(selected))].sort();
  insp.innerHTML = '<h2>Selection</h2>' +
    '<div class="insp-name">' + s.name + '</div>' +
    '<div class="insp-path">' + f.path + ':' + s.lines + '</div>' +
    '<div class="badges"><span class="badge">' + s.kind + '</span>' +
      (s.touched ? '<span class="badge t">touched</span>' : '<span class="badge">neighbor</span>') +
      (s.sig ? '<span class="badge s">signature</span>' : '') +
      '<span class="badge">' + f.status + '</span></div>' +
    '<div class="rel"><h3><span>Called by</span><span>' + ins.length + '</span></h3>' +
      (ins.length ? ins.map(i => row(i, "in")).join("") : '<div class="none">Nothing in this graph calls it.</div>') + '</div>' +
    '<div class="rel"><h3><span>Calls</span><span>' + outs.length + '</span></h3>' +
      (outs.length ? outs.map(i => row(i, "out")).join("") : '<div class="none">It calls nothing in this graph.</div>') + '</div>';
}
insp.addEventListener("click", e => {
  const b = e.target.closest("[data-jump]");
  if (b) { selected = null; select(b.dataset.jump); }
});

/* ---- focus toggle: swap to the layout that has no neighbors ---- */
const toggle = document.getElementById("focus-toggle");
toggle.addEventListener("change", () => {
  focus = toggle.checked;
  for (const key in scenes) {
    scenes[key].root.classList.add("swapping");
    place(key, focus ? "focus" : "full");
  }
  setTimeout(() => { for (const key in scenes) scenes[key].root.classList.remove("swapping"); }, 360);
});

/* ---- variant switching ---- */
function show(key, push) {
  variant = key;
  for (const k in scenes) scenes[k].root.classList.toggle("on", k === key);
  const meta = VS.find(v => v.key === key);
  document.querySelector(".switcher .k").innerHTML = "<b>" + key + "</b> &#183; " + meta.name;
  document.querySelector(".switcher .n").textContent = meta.note;
  if (!scenes[key].fitted) { scenes[key].fitted = true; fit(key, 0.45); } else paint(key);
  if (push) {
    const u = new URL(location.href); u.searchParams.set("variant", key);
    history.replaceState(null, "", u);
  }
}
document.querySelector(".switcher .prev").addEventListener("click", () => step(-1));
document.querySelector(".switcher .next").addEventListener("click", () => step(1));
function step(d) {
  const i = VS.findIndex(v => v.key === variant);
  show(VS[(i + d + VS.length) % VS.length].key, true);
}
addEventListener("keydown", e => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "ArrowRight") step(1);
  else if (e.key === "Escape") select(null);
  else if (e.key === "f") { toggle.checked = !toggle.checked; toggle.dispatchEvent(new Event("change")); }
});
document.querySelector(".zoom .in").addEventListener("click", () => zoomBy(1.25));
document.querySelector(".zoom .out").addEventListener("click", () => zoomBy(0.8));
document.querySelector(".zoom .fit").addEventListener("click", () => fit(variant));

for (const key in scenes) place(key, "full");
inspect();
const want = new URL(location.href).searchParams.get("variant");
show(VS.some(v => v.key === want) ? want : "A", false);
addEventListener("resize", () => { for (const k in scenes) scenes[k].fitted = false; show(variant, false); });
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PR ${graph.pr.number} architecture &#183; ${esc(graph.pr.title)}</title>
<style>${css}</style>
</head>
<body>
<header class="masthead">
  <span class="pr">PR #${graph.pr.number}</span>
  <h1>${esc(graph.pr.title)}</h1>
  <span class="sha">${esc(graph.pr.headSha.slice(0, 10))}</span>
  <div class="tally">
    <span><b>${counts.touchedFiles}</b> touched files</span>
    <span><b>${counts.touchedSymbols}</b> touched symbols</span>
    <span><b>${counts.neighbors}</b> neighbors in ${counts.neighborFiles} files</span>
    <span><b>${counts.calls}</b> calls</span>
  </div>
</header>

<div class="stagewrap">
  <svg id="stage" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.75" fill="oklch(0.27 0.019 264 / 0.13)"/>
      </pattern>
      <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="oklch(0.951 0.012 84)"/>
        <line x1="0" y1="0" x2="0" y2="6" stroke="oklch(0.27 0.019 264 / 0.2)" stroke-width="1"/>
      </pattern>
      <marker id="arrow-call" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 0.8L7 4L0 7.2Z" fill="context-stroke" stroke="none"/>
      </marker>
      <marker id="arrow-import" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0.5 1L6.5 4L0.5 7" fill="none" stroke="context-stroke" stroke-width="1.1"/>
      </marker>
    </defs>
    ${variants.map(sceneSvg).join("\n    ")}
  </svg>
  <div class="zoom">
    <button class="in" title="Zoom in">+</button>
    <button class="out" title="Zoom out">&#8722;</button>
    <button class="fit" title="Fit">fit</button>
  </div>
  <div class="proto">prototype &#183; issue #6</div>
</div>

<aside class="rail">
  <div>
    <h2>Legend</h2>
    <div class="legend">
      <div><span class="swatch t"></span>Touched symbol</div>
      <div><span class="swatch s"></span>Signature changed</div>
      <div><span class="swatch n"></span>Neighbor, one hop</div>
      <div><span class="swatch g"></span>Deleted file</div>
    </div>
    <div class="kinds" style="margin-top:11px">
      <b>f</b> function &#160; <b>c</b> class &#160; <b>m</b> method<br>
      <b>a</b> arrow &#160; <b>k</b> const<br>
      <span style="color:var(--sig)">&#8592;</span> caller &#160;
      <span style="color:oklch(0.47 0.09 200)">&#8594;</span> callee
    </div>
  </div>
  <div>
    <h2>Neighbors</h2>
    <label class="toggle"><input type="checkbox" id="focus-toggle"><span>Hide untouched neighbors</span></label>
    <p class="hint" style="margin:8px 0 0">The diagram relaxes into a tighter layout for the touched symbols only. Press <b>f</b>.</p>
  </div>
  <div class="inspector" id="inspector"></div>
  <div>
    <h2>Controls</h2>
    <p class="hint" style="margin:0">Drag to pan, scroll to zoom, arrow keys change variant, Esc clears the selection.</p>
  </div>
</aside>

<div class="tip"></div>

<nav class="switcher">
  <button class="prev" title="Previous variant">&#8592;</button>
  <div class="label"><span class="k"></span><span class="n"></span></div>
  <button class="next" title="Next variant">&#8594;</button>
</nav>

${island("graph-data", graphData)}
${island("layout-data", layoutData)}
<script>${script}</script>
</body>
</html>
`;

await Bun.write(outPath, html);
console.error(
  `wrote ${outPath} (${html.length} bytes) - ${variants.length} variants, ${symbols.length} symbols, ${edges.length} edges`,
);
