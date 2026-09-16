#!/usr/bin/env bun
/**
 * THROWAWAY UI PROTOTYPE - github issue #6, round 3. Not production code.
 *
 * Question: can a reviewer see, at a glance, whether a pull request stays inside
 * one module or leaks across module seams, and what it does to tests versus
 * production code? Round 3 iterates the winning variant E Blueprint: Git colors
 * for change state, a side diff panel in GitHub style, code linked to canvas,
 * and incremental disclosure of neighbors through ports.
 *
 *   E1 Blueprint, tests framed   module > (production files | tests frame) > symbols
 *   E2 Blueprint, tests dimmed   module > file > symbol, test files dimmed until hovered
 *   F  Seams                     reachable with ?variant=F, not in the switcher
 *   G  Compass                   reachable with ?variant=G, not in the switcher
 *
 * Incremental disclosure: clicking a port (or one entry of its list) places the
 * disclosed neighbors in a lane beside the drawing, at view time, with no layout
 * library. The elkjs layouts (focus and full) never move, so the reviewer's mental
 * map holds. See the `lane` functions in the client script.
 *
 * elkjs runs here, at generation time. The artifact loads nothing at view time.
 *
 * Usage: bun run prototype/renderer/render2.ts <enriched-graph.json> <out.html>
 */

import type { EnrichedGraph } from "./enrich";

delete (globalThis as { self?: unknown }).self;
const ELK = (await import("elkjs/lib/elk.bundled.js")).default;

/** A touched symbol longer than this is flagged. Michael's default. */
const LONG_SYMBOL_LINES = 60;

const [graphPath, outPath] = process.argv.slice(2);
if (!graphPath || !outPath) {
  console.error("usage: bun run prototype/renderer/render2.ts <enriched-graph.json> <out.html>");
  process.exit(2);
}
const graph = JSON.parse(await Bun.file(graphPath).text()) as EnrichedGraph;

// ---------------------------------------------------------------------------
// Normalise. Sorted arrays only, because elkjs layout depends on input order.
// ---------------------------------------------------------------------------

type Sym = EnrichedGraph["symbols"][number];
type File = EnrichedGraph["files"][number];
type Mod = EnrichedGraph["modules"][number];

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const files = [...graph.files].sort((a, b) => cmp(a.id, b.id));
const symbols = [...graph.symbols].sort((a, b) => cmp(a.id, b.id));
const edges = [...graph.edges].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
const modules = [...graph.modules].sort((a, b) => cmp(a.id, b.id));

const fileById = new Map(files.map((f) => [f.id, f]));
const symById = new Map(symbols.map((s) => [s.id, s]));
const modById = new Map(modules.map((m) => [m.id, m]));
const ROOT_MODULE: Mod = { id: "(root)", name: "workspace root", root: "" };
const moduleOfFile = (f: File) => (f.moduleId ? modById.get(f.moduleId)! : ROOT_MODULE);
const moduleOfSym = (s: Sym) => moduleOfFile(fileById.get(s.fileId)!);

for (const s of symbols) if (!fileById.has(s.fileId)) throw new Error(`symbol ${s.id} points at unknown file`);
for (const e of edges) if (!symById.has(e.from) || !symById.has(e.to)) throw new Error(`edge ${e.from} -> ${e.to} unknown end`);

const callersOf = new Map<string, string[]>(symbols.map((s) => [s.id, []]));
const calleesOf = new Map<string, string[]>(symbols.map((s) => [s.id, []]));
for (const e of edges) {
  callersOf.get(e.to)!.push(e.from);
  calleesOf.get(e.from)!.push(e.to);
}

const touchedFiles = files.filter((f) => f.touched);
const symbolsInFile = (fileId: string) =>
  symbols.filter((s) => s.fileId === fileId).sort((a, b) => a.line.start - b.line.start || cmp(a.name, b.name));
const isTest = (s: Sym) => s.kind === "test";
const isLong = (s: Sym) => s.touched && !isTest(s) && s.lineCount > LONG_SYMBOL_LINES;
/** Git change state; the enricher computes it, older fixtures fall back to the file status. */
const changeOf = (s: Sym): string => s.change ?? (s.touched ? fileById.get(s.fileId)!.status : "unchanged");

/** Modules that hold at least one file of the graph, touched ones first, by id. */
const modulesInGraph = [...new Set(files.map((f) => moduleOfFile(f).id))]
  .map((id) => (id === ROOT_MODULE.id ? ROOT_MODULE : modById.get(id)!))
  .sort((a, b) => {
    const ta = files.some((f) => f.touched && moduleOfFile(f).id === a.id);
    const tb = files.some((f) => f.touched && moduleOfFile(f).id === b.id);
    return Number(tb) - Number(ta) || cmp(a.id, b.id);
  });
const filesInModule = (modId: string) =>
  files
    .filter((f) => moduleOfFile(f).id === modId)
    .sort((a, b) => Number(b.touched) - Number(a.touched) || Number(a.role === "test") - Number(b.role === "test") || cmp(a.path, b.path));

// ---------------------------------------------------------------------------
// Seam report. This is the sentence the masthead opens with.
// ---------------------------------------------------------------------------

const touchedModules = [...new Set(touchedFiles.map((f) => moduleOfFile(f).id))].sort(cmp);
type Crossing = { from: string; to: string; role: "test" | "production"; edges: number; fromMod: string; toMod: string };
const crossings: Crossing[] = [];
for (const e of edges) {
  const a = symById.get(e.from)!;
  const b = symById.get(e.to)!;
  if (!a.touched && !b.touched) continue;
  const ma = moduleOfSym(a);
  const mb = moduleOfSym(b);
  if (ma.id === mb.id) continue;
  const role = fileById.get(a.fileId)!.role === "test" || fileById.get(b.fileId)!.role === "test" ? "test" : "production";
  const key = crossings.find((c) => c.from === a.fileId && c.to === b.fileId);
  if (key) key.edges++;
  else crossings.push({ from: a.fileId, to: b.fileId, role, edges: 1, fromMod: ma.id, toMod: mb.id });
}
const prodCrossings = crossings.filter((c) => c.role === "production");
const testCrossings = crossings.filter((c) => c.role === "test");
const prodTouchedModules = [...new Set(touchedFiles.filter((f) => f.role === "production").map((f) => moduleOfFile(f).name))].sort(cmp);

function seamSentence() {
  const names = (list: string[]) => list.map((m) => `<b>${esc(m)}</b>`).join(", ");
  const n = (k: number, word: string) => `<b>${k}</b> ${word}${k === 1 ? "" : "s"}`;
  const out: string[] = [];
  out.push(
    prodTouchedModules.length === 1
      ? `Production changes stay inside ${names(prodTouchedModules)}.`
      : `Production changes touch ${n(prodTouchedModules.length, "module")}: ${names(prodTouchedModules)}.`,
  );
  const prodCalls = prodCrossings.reduce((k, c) => k + c.edges, 0);
  if (prodCalls === 0) out.push("No production call crosses a module seam.");
  else out.push(`${n(prodCalls, "production call")} cross a seam into ${names([...new Set(prodCrossings.map((c) => modById.get(c.toMod)?.name ?? c.toMod))].sort(cmp))}.`);
  const testFiles = touchedFiles.filter((f) => f.role === "test");
  const testMods = [...new Set(testFiles.map((f) => moduleOfFile(f).name))].sort(cmp);
  out.push(`${n(testFiles.length, "test file")} changed in ${names(testMods)}.`);
  if (testCrossings.length) {
    const from = [...new Set(testCrossings.map((c) => modById.get(c.fromMod)?.name ?? c.fromMod))].sort(cmp);
    out.push(`${n(testCrossings.length, "test file")} in ${names(from)} reach${testCrossings.length === 1 ? "es" : ""} the change across a seam.`);
  }
  return out.join(" ");
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;
function esc(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
const monoW = (text: string, size: number) => text.length * size * 0.6;
const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
/** Path inside its module, so the module plate carries the prefix once. */
const relPath = (f: File) => {
  const m = moduleOfFile(f);
  return m.root && f.path.startsWith(m.root + "/") ? f.path.slice(m.root.length + 1) : f.path;
};
const lineLabel = (s: Sym) => (s.line.start === s.line.end ? `${s.line.start}` : `${s.line.start}-${s.line.end}`);
const kindTag: Record<Sym["kind"], string> = { function: "f", class: "c", method: "m", arrow: "a", const: "k", test: "t" };
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "\u2026" : s);

// ---------------------------------------------------------------------------
// Scene model. Fixed-size cells, resizable groups, edge paths. Two states per
// variant: focus (neighbors hidden, tests grouped) and full (everything).
// ---------------------------------------------------------------------------

type Cell = { cid: string; sel?: string; w: number; h: number; cls: string; body: string; un?: boolean; port?: string };
type Group = { gid: string; sel?: string; cls: string; body: string; un?: boolean };
type EdgeRef = { eid: string; from: string; to: string; pairs: [string, string][]; cls: string; un: boolean };
type State = {
  cells: Record<string, [number, number]>;
  groups: Record<string, [number, number, number, number]>;
  edges: Record<string, string>;
  labels: Record<string, [number, number]>;
  w: number;
  h: number;
};
type Variant = { key: string; name: string; note: string; hidden?: boolean; cells: Cell[]; groups: Group[]; edges: EdgeRef[]; full: State; focus: State };

const emptyState = (): State => ({ cells: {}, groups: {}, edges: {}, labels: {}, w: 0, h: 0 });

/** Hidden neighbor counts behind a touched file, split by direction and role. */
type Port = { fileId: string; dir: "in" | "out"; ids: string[] };
function portsFor(fileId: string): Port[] {
  const mine = new Set(symbolsInFile(fileId).filter((s) => s.touched).map((s) => s.id));
  const ins = new Set<string>();
  const outs = new Set<string>();
  for (const e of edges) {
    if (mine.has(e.to) && !symById.get(e.from)!.touched) ins.add(e.from);
    if (mine.has(e.from) && !symById.get(e.to)!.touched) outs.add(e.to);
  }
  const out: Port[] = [];
  if (ins.size) out.push({ fileId, dir: "in", ids: [...ins].sort(cmp) });
  if (outs.size) out.push({ fileId, dir: "out", ids: [...outs].sort(cmp) });
  return out;
}
const portLabel = (p: Port) => {
  const prod = p.ids.filter((id) => fileById.get(symById.get(id)!.fileId)!.role === "production").length;
  const test = p.ids.length - prod;
  const bits = [];
  if (prod) bits.push(`${prod}`);
  if (test) bits.push(`${test}t`);
  return bits.join("+");
};
const PORT_H = 18;
const portW = (p: Port) => Math.round(monoW(portLabel(p), 10) + 26);

// ---------------------------------------------------------------------------
// elkjs plumbing (unchanged from round 1)
// ---------------------------------------------------------------------------

type XY = { x: number; y: number };
type ElkNode = { id: string; width?: number; height?: number; x?: number; y?: number; children?: ElkNode[]; edges?: ElkEdge[]; layoutOptions?: Record<string, string> };
type ElkEdge = { id: string; sources: string[]; targets: string[]; container?: string; sections?: { startPoint: XY; endPoint: XY; bendPoints?: XY[] }[] };

async function runElk(root: ElkNode) {
  const elk = new ELK();
  // elkjs types demand section ids on input edges that only exist on output.
  const copy: ElkNode = structuredClone(root);
  return (await elk.layout(copy as unknown as never)) as unknown as ElkNode;
}
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
function orthoPath(pts: XY[], radius = 6) {
  const p = pts.filter((pt, i) => i === 0 || Math.abs(pt.x - pts[i - 1]!.x) > 0.01 || Math.abs(pt.y - pts[i - 1]!.y) > 0.01);
  if (p.length === 0) return "";
  if (p.length < 3) return `M${r2(p[0]!.x)} ${r2(p[0]!.y)}` + p.slice(1).map((q) => `L${r2(q.x)} ${r2(q.y)}`).join("");
  let d = `M${r2(p[0]!.x)} ${r2(p[0]!.y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1]!, b = p[i]!, c = p[i + 1]!;
    const lenIn = Math.hypot(b.x - a.x, b.y - a.y), lenOut = Math.hypot(c.x - b.x, c.y - b.y);
    const rIn = Math.min(radius, lenIn / 2), rOut = Math.min(radius, lenOut / 2);
    const inX = b.x - ((b.x - a.x) / (lenIn || 1)) * rIn, inY = b.y - ((b.y - a.y) / (lenIn || 1)) * rIn;
    const outX = b.x + ((c.x - b.x) / (lenOut || 1)) * rOut, outY = b.y + ((c.y - b.y) / (lenOut || 1)) * rOut;
    d += `L${r2(inX)} ${r2(inY)}Q${r2(b.x)} ${r2(b.y)} ${r2(outX)} ${r2(outY)}`;
  }
  const last = p[p.length - 1]!;
  d += `L${r2(last.x)} ${r2(last.y)}`;
  return d;
}
const midOf = (pts: XY[]): XY => {
  if (pts.length === 0) return { x: 0, y: 0 };
  const total = pts.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y), 0);
  let walk = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    if (walk + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - walk) / seg;
      return { x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * t, y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * t };
    }
    walk += seg;
  }
  return pts[pts.length - 1]!;
};

// ===========================================================================
// Shared visual language for symbol cells
// ===========================================================================

const ROW = 26;
const FILE_HEAD = 40;
const MOD_HEAD = 34;

function symClass(s: Sym) {
  const f = fileById.get(s.fileId)!;
  const out = ["cell", "sym", `k-${s.kind}`, `st-${changeOf(s)}`, ...(f.role === "test" ? ["is-test", "tdim"] : ["is-prod"]), s.touched ? "is-touched" : "is-neighbor"];
  if (s.signatureTouched) out.push("is-sig");
  if (isLong(s)) out.push("is-long");
  if (f.status === "deleted") out.push("is-gone");
  return out.join(" ");
}
/** The long flag is a badge, not a color: `long 920 L` in an outlined pill. */
const linesLabel = (s: Sym) => (isLong(s) ? `! ${s.lineCount} L` : `${s.lineCount} L`);
function symCellSize(s: Sym) {
  const name = isTest(s) ? truncate(s.name, 44) : s.name;
  const w = 24 + monoW(name, 11.5) + 14 + monoW(linesLabel(s), 9) + (isLong(s) ? 24 : 12);
  return { w: Math.max(150, Math.round(w)), h: ROW };
}
function symCell(prefix: string, s: Sym): Cell {
  const { w, h } = symCellSize(s);
  const name = isTest(s) ? truncate(s.name, 44) : s.name;
  return {
    cid: `${prefix}-${s.id}`,
    sel: s.id,
    w, h,
    un: !s.touched,
    cls: symClass(s),
    body:
      `<rect class="box" x="0" y="0" width="${w}" height="${h}" rx="2"/>` +
      `<rect class="mark" x="0" y="0" width="3" height="${h}"/>` +
      `<rect class="sig" x="0" y="0" width="${w}" height="2.5"/>` +
      `<text class="c-kind" x="9" y="${h / 2 + 3.5}">${kindTag[s.kind]}</text>` +
      `<text class="c-name" x="24" y="${h / 2 + 3.5}">${esc(name)}</text>` +
      (isLong(s) ? `<rect class="lbadge" x="${w - 14 - monoW(linesLabel(s), 9) - 6}" y="${h / 2 - 8}" width="${Math.round(monoW(linesLabel(s), 9) + 12)}" height="16" rx="8"/>` : "") +
      `<text class="c-lines" x="${w - (isLong(s) ? 14 : 8)}" y="${h / 2 + 3.5}" text-anchor="end">${linesLabel(s)}</text>`,
  };
}
/** One cell that stands for every test case of a file in the focus state. */
function testGroupCell(prefix: string, f: File, tests: Sym[]): Cell {
  const touched = tests.filter((t) => t.touched).length;
  const label = `${tests.length} test case${tests.length === 1 ? "" : "s"}`;
  const sub = touched === tests.length ? "all changed" : touched === 0 ? "unchanged" : `${touched} changed`;
  const w = Math.max(190, Math.round(24 + monoW(label, 11.5) + 14 + monoW(sub, 9) + 12));
  return {
    cid: `${prefix}-tests-${f.id}`,
    sel: `file:${f.id}`,
    w, h: ROW,
    cls: `cell sym tests is-test tdim st-${f.touched ? f.status : "unchanged"} ${touched ? "is-touched" : "is-neighbor"}`,
    body:
      `<rect class="box" x="0" y="0" width="${w}" height="${ROW}" rx="2"/>` +
      `<rect class="mark" x="0" y="0" width="3" height="${ROW}"/>` +
      `<text class="c-kind" x="9" y="${ROW / 2 + 3.5}">t</text>` +
      `<text class="c-name" x="24" y="${ROW / 2 + 3.5}">${label}</text>` +
      `<text class="c-lines" x="${w - 8}" y="${ROW / 2 + 3.5}" text-anchor="end">${sub}</text>`,
  };
}
function fileGroup(prefix: string, f: File, extra = ""): Group {
  const all = symbolsInFile(f.id);
  const touched = all.filter((s) => s.touched);
  const meta = f.touched
    ? touched.length === 0
      ? `${f.status}, ${f.changedLines.length} lines outside any symbol`
      : `${f.status}, ${touched.length} of ${all.length} symbols`
    : `${all.length} symbol${all.length === 1 ? "" : "s"} reached`;
  return {
    gid: `${prefix}-file-${f.id}`,
    sel: `file:${f.id}`,
    un: !f.touched,
    cls: `group file st-${f.touched ? f.status : "unchanged"} ${f.role === "test" ? "is-test tdim" : "is-prod"} ${f.touched ? "is-touched" : "is-neighbor"}${extra}`,
    body:
      `<rect class="box" x="0" y="0" width="10" height="10" rx="3"/>` +
      `<rect class="band" x="0" y="0" width="10" height="${FILE_HEAD}" data-span="width"/>` +
      `<rect class="mark" x="0" y="0" width="3" height="10" data-span2="height"/>` +
      `<text class="g-name" x="13" y="17">${esc(baseOf(f.path))}</text>` +
      `<text class="g-meta" x="13" y="31">${esc(meta)}</text>` +
      `<text class="g-role" x="10" y="17" text-anchor="end" data-spanx="width" data-dx="-10">${f.role}</text>`,
  };
}
/** E1: one frame per module that holds its test files, split from production. */
function testFrameGroup(prefix: string, m: Mod): Group {
  const tests = filesInModule(m.id).filter((f) => f.role === "test");
  const touched = tests.filter((f) => f.touched).length;
  return {
    gid: `${prefix}-tframe-${m.id}`,
    un: touched === 0,
    cls: `group tframe ${touched ? "is-touched" : "is-neighbor"}`,
    body:
      `<rect class="box" x="0" y="0" width="10" height="10" rx="4"/>` +
      `<text class="t-name" x="12" y="18">tests</text>` +
      `<text class="t-meta" x="10" y="18" text-anchor="end" data-spanx="width" data-dx="-12">${tests.length} file${tests.length === 1 ? "" : "s"}${touched ? `, ${touched} changed` : ""}</text>`,
  };
}
function moduleGroup(prefix: string, m: Mod): Group {
  const inGraph = filesInModule(m.id);
  const touched = inGraph.filter((f) => f.touched).length;
  return {
    gid: `${prefix}-mod-${m.id}`,
    un: touched === 0,
    cls: `group module ${touched ? "is-touched" : "is-neighbor"}`,
    body:
      `<rect class="box" x="0" y="0" width="10" height="10" rx="5"/>` +
      `<text class="m-name" x="16" y="22">${esc(m.name)}</text>` +
      `<text class="m-meta" x="10" y="22" text-anchor="end" data-spanx="width" data-dx="-16">${esc(m.root || "workspace root")}</text>`,
  };
}
function portCell(prefix: string, p: Port): Cell {
  const w = portW(p);
  const arrow = p.dir === "out" ? "&#8594;" : "&#8592;";
  return {
    cid: `${prefix}-port-${p.dir}-${p.fileId}`,
    port: `${p.dir}:${p.fileId}`,
    w, h: PORT_H,
    cls: `cell port port-${p.dir}`,
    body:
      `<rect class="box" x="0" y="0" width="${w}" height="${PORT_H}" rx="9"/>` +
      (p.dir === "out"
        ? `<text class="p-text" x="8" y="13">${portLabel(p)} <tspan class="p-arrow">${arrow}</tspan></text>`
        : `<text class="p-text" x="8" y="13"><tspan class="p-arrow">${arrow}</tspan> ${portLabel(p)}</text>`),
  };
}

/** Edge class from its underlying symbol pair: seam crossing, test, in-module. */
function edgeClass(from: Sym, to: Sym) {
  const cls = ["edge"];
  const cross = moduleOfSym(from).id !== moduleOfSym(to).id;
  const test = fileById.get(from.fileId)!.role === "test" || fileById.get(to.fileId)!.role === "test";
  cls.push(cross ? "edge-seam" : from.fileId === to.fileId ? "edge-local" : "edge-file");
  cls.push(test ? "edge-test" : "edge-prod");
  return cls.join(" ");
}

// ===========================================================================
// Variants E and F share one nested layout. `leaf` picks the granularity.
// ===========================================================================

type Leaf = "symbol" | "file";
const TFRAME_HEAD = 28;

function buildNested(prefix: string, leaf: Leaf, testFrame = false) {
  const cells: Cell[] = [];
  const groups: Group[] = [];
  const edgeRefs: EdgeRef[] = [];

  for (const m of modulesInGraph) {
    groups.push(moduleGroup(prefix, m));
    if (testFrame && filesInModule(m.id).some((f) => f.role === "test")) groups.push(testFrameGroup(prefix, m));
    for (const f of filesInModule(m.id)) {
      groups.push(fileGroup(prefix, f, leaf === "file" ? " leaf" : ""));
      if (leaf === "symbol") {
        const all = symbolsInFile(f.id);
        for (const s of all.filter((s) => !isTest(s))) cells.push(symCell(prefix, s));
        const tests = all.filter(isTest);
        for (const t of tests) cells.push(symCell(prefix, t));
        if (tests.length) cells.push(testGroupCell(prefix, f, tests));
      }
      if (f.touched) for (const p of portsFor(f.id)) cells.push(portCell(prefix, p));
    }
  }

  if (leaf === "symbol") {
    // One drawn edge per symbol pair, except test cases in the focus state, which
    // funnel into their file's test group cell. Both edge sets exist; the state
    // decides which one carries a path.
    for (const e of edges) {
      const a = symById.get(e.from)!, b = symById.get(e.to)!;
      edgeRefs.push({ eid: `${prefix}-e-${e.from}->${e.to}`, from: e.from, to: e.to, pairs: [[e.from, e.to]], cls: edgeClass(a, b), un: !a.touched || !b.touched });
    }
    const grouped = new Map<string, EdgeRef>();
    for (const e of edges) {
      const a = symById.get(e.from)!, b = symById.get(e.to)!;
      if (!isTest(a)) continue;
      const key = `${prefix}-eg-${a.fileId}->${e.to}`;
      const g = grouped.get(key);
      if (g) g.pairs.push([e.from, e.to]);
      else grouped.set(key, { eid: key, from: `tests:${a.fileId}`, to: e.to, pairs: [[e.from, e.to]], cls: edgeClass(a, b) + " edge-bundle", un: !b.touched });
    }
    edgeRefs.push(...grouped.values());
  } else {
    const grouped = new Map<string, EdgeRef>();
    for (const e of edges) {
      const a = symById.get(e.from)!, b = symById.get(e.to)!;
      if (a.fileId === b.fileId) continue;
      const key = `${prefix}-ef-${a.fileId}->${b.fileId}`;
      const g = grouped.get(key);
      if (g) g.pairs.push([e.from, e.to]);
      else grouped.set(key, { eid: key, from: `file:${a.fileId}`, to: `file:${b.fileId}`, pairs: [[e.from, e.to]], cls: edgeClass(a, b) + " edge-bundle", un: !(fileById.get(a.fileId)!.touched && fileById.get(b.fileId)!.touched) });
    }
    edgeRefs.push(...grouped.values());
  }
  return { cells, groups, edges: edgeRefs };
}

/**
 * focus: touched files only, tests grouped per file, ports for hidden neighbors.
 * full: every file and symbol, every test case, no ports.
 */
async function layoutNested(prefix: string, leaf: Leaf, v: Variant, mode: "focus" | "full", testFrame = false): Promise<State> {
  const cellById = new Map(v.cells.map((c) => [c.cid, c]));
  const focus = mode === "focus";
  const showFile = (f: File) => (focus ? f.touched : true);
  const showSym = (s: Sym) => (focus ? s.touched : true);

  const elkChildren: ElkNode[] = [];
  const nodeIds = new Set<string>();
  for (const m of modulesInGraph) {
    const fileNodes: ElkNode[] = [];
    for (const f of filesInModule(m.id)) {
      if (!showFile(f)) continue;
      const kids: ElkNode[] = [];
      if (leaf === "symbol") {
        const all = symbolsInFile(f.id);
        for (const s of all.filter((s) => !isTest(s) && showSym(s))) {
          const c = cellById.get(`${prefix}-${s.id}`)!;
          kids.push({ id: s.id, width: c.w, height: c.h });
          nodeIds.add(s.id);
        }
        const tests = all.filter(isTest);
        if (tests.length) {
          if (focus) {
            const c = cellById.get(`${prefix}-tests-${f.id}`)!;
            kids.push({ id: `tests:${f.id}`, width: c.w, height: c.h });
            nodeIds.add(`tests:${f.id}`);
          } else {
            for (const t of tests) {
              const c = cellById.get(`${prefix}-${t.id}`)!;
              kids.push({ id: t.id, width: c.w, height: c.h });
              nodeIds.add(t.id);
            }
          }
        }
      }
      const fileNode: ElkNode = { id: `file:${f.id}`, layoutOptions: { "elk.padding": `[top=${FILE_HEAD + 10},left=13,bottom=13,right=13]`, "elk.spacing.nodeNode": "8" } };
      if (kids.length) fileNode.children = kids;
      else {
        fileNode.width = Math.max(220, Math.round(monoW(baseOf(f.path), 12) + 120));
        fileNode.height = FILE_HEAD + (leaf === "symbol" ? 14 : 30);
      }
      nodeIds.add(`file:${f.id}`);
      fileNodes.push(fileNode);
    }
    if (fileNodes.length === 0) continue;
    // E1: test files move into one nested frame per module.
    let children = fileNodes;
    if (testFrame) {
      const testIds = new Set(filesInModule(m.id).filter((f) => f.role === "test").map((f) => `file:${f.id}`));
      const tests = fileNodes.filter((n) => testIds.has(n.id));
      const prod = fileNodes.filter((n) => !testIds.has(n.id));
      children = prod;
      if (tests.length) {
        children = [...prod, { id: `tframe:${m.id}`, layoutOptions: { "elk.padding": `[top=${TFRAME_HEAD + 10},left=12,bottom=12,right=12]`, "elk.spacing.nodeNode": "20", "elk.layered.spacing.nodeNodeBetweenLayers": "40" }, children: tests }];
        nodeIds.add(`tframe:${m.id}`);
      }
    }
    elkChildren.push({
      id: `mod:${m.id}`,
      layoutOptions: {
        "elk.padding": `[top=${MOD_HEAD + 14},left=16,bottom=16,right=16]`,
        "elk.spacing.nodeNode": "24",
        "elk.layered.spacing.nodeNodeBetweenLayers": "44",
      },
      children,
    });
  }

  // Node membership decides: in focus the test cells are absent and the
  // `tests:<file>` bundle node is present, in full it is the other way round.
  const drawn = v.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.randomSeed": "1",
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      "elk.spacing.edgeNode": "14",
      "elk.spacing.edgeEdge": "8",
      "elk.layered.spacing.edgeNodeBetweenLayers": "18",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
      "elk.layered.mergeEdges": "false",
      "elk.layered.thoroughness": "12",
      "elk.separateConnectedComponents": "false",
    },
    children: elkChildren,
    edges: drawn.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };

  const flat = flattenElk(await runElk(root));
  const st = emptyState();
  for (const c of v.cells) {
    if (c.port) continue;
    const key = c.cid.startsWith(`${prefix}-tests-`) ? `tests:${c.cid.slice(`${prefix}-tests-`.length)}` : c.sel!;
    const b = flat.box.get(key);
    if (b && nodeIds.has(key)) st.cells[c.cid] = [b[0], b[1]];
  }
  for (const g of v.groups) {
    const key = g.gid.startsWith(`${prefix}-file-`)
      ? `file:${g.gid.slice(`${prefix}-file-`.length)}`
      : g.gid.startsWith(`${prefix}-tframe-`)
        ? `tframe:${g.gid.slice(`${prefix}-tframe-`.length)}`
        : `mod:${g.gid.slice(`${prefix}-mod-`.length)}`;
    const b = flat.box.get(key);
    if (b) st.groups[g.gid] = b;
  }
  drawn.forEach((e, i) => {
    const pts = flat.routes.get(`e${i}`);
    if (pts && pts.length > 1) {
      st.edges[e.eid] = orthoPath(pts);
      if (e.pairs.length > 1) {
        const m = midOf(pts);
        st.labels[e.eid] = [r2(m.x), r2(m.y)];
      }
    }
  });
  // Ports sit on the file's right (callees) or left (callers) wall, below the header.
  if (focus) {
    for (const c of v.cells) {
      if (!c.port) continue;
      const [dir, fileId] = c.port.split(":") as ["in" | "out", string];
      const b = flat.box.get(`file:${fileId}`);
      if (!b) continue;
      const y = b[1] + b[3] - PORT_H - 6;
      st.cells[c.cid] = dir === "out" ? [r2(b[0] + b[2] - c.w / 2), r2(y)] : [r2(b[0] - c.w / 2), r2(y)];
    }
  }
  st.w = flat.w;
  st.h = flat.h;
  return st;
}

// ===========================================================================
// Variant G - Compass. Modules as arcs on a ring, files as segments, calls as chords.
// ===========================================================================

const G_R = 300;
const G_SEG = 26;
const G_GAP_MOD = 0.11;
const G_GAP_FILE = 0.014;

function buildCompass(prefix: string) {
  const cells: Cell[] = [];
  const groups: Group[] = [];
  const edgeRefs: EdgeRef[] = [];
  for (const m of modulesInGraph) {
    groups.push({ gid: `${prefix}-mod-${m.id}`, un: !filesInModule(m.id).some((f) => f.touched), cls: "group arc-mod", body: `<path class="arc" d=""/><text class="m-name arc-label" x="0" y="0">${esc(m.name)}</text>` });
    for (const f of filesInModule(m.id)) {
      const all = symbolsInFile(f.id);
      const touched = all.filter((s) => s.touched).length;
      groups.push({
        gid: `${prefix}-file-${f.id}`,
        sel: `file:${f.id}`,
        un: !f.touched,
        cls: `group arc-file st-${f.status} ${f.role === "test" ? "is-test" : "is-prod"} ${f.touched ? "is-touched" : "is-neighbor"}`,
        body: `<path class="seg" d=""/><text class="seg-label" x="0" y="0">${esc(baseOf(f.path))}<tspan class="seg-meta"> ${touched ? `${touched}/${all.length}` : all.length}</tspan></text>`,
      });
      if (f.touched) for (const p of portsFor(f.id)) cells.push(portCell(prefix, p));
    }
  }
  const grouped = new Map<string, EdgeRef>();
  for (const e of edges) {
    const a = symById.get(e.from)!, b = symById.get(e.to)!;
    if (a.fileId === b.fileId) continue;
    const key = `${prefix}-ef-${a.fileId}->${b.fileId}`;
    const g = grouped.get(key);
    if (g) g.pairs.push([e.from, e.to]);
    else grouped.set(key, { eid: key, from: `file:${a.fileId}`, to: `file:${b.fileId}`, pairs: [[e.from, e.to]], cls: edgeClass(a, b) + " edge-bundle chord", un: !(fileById.get(a.fileId)!.touched && fileById.get(b.fileId)!.touched) });
  }
  edgeRefs.push(...grouped.values());
  return { cells, groups, edges: edgeRefs };
}

function layoutCompass(prefix: string, v: Variant, mode: "focus" | "full"): State {
  const focus = mode === "focus";
  const st = emptyState();
  const cx = G_R + 300, cy = G_R + 190;
  const R = G_R;

  const mods = modulesInGraph.map((m) => ({ m, files: filesInModule(m.id).filter((f) => !focus || f.touched) })).filter((x) => x.files.length);
  const totalFiles = mods.reduce((n, x) => n + x.files.length, 0);
  const totalGaps = mods.length * G_GAP_MOD + Math.max(0, totalFiles - mods.length) * G_GAP_FILE;
  const per = (Math.PI * 2 - totalGaps) / totalFiles;

  const pol = (r: number, a: number): XY => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  const arcPath = (r0: number, r1: number, a0: number, a1: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p0 = pol(r1, a0), p1 = pol(r1, a1), p2 = pol(r0, a1), p3 = pol(r0, a0);
    return `M${r2(p0.x)} ${r2(p0.y)}A${r1} ${r1} 0 ${large} 1 ${r2(p1.x)} ${r2(p1.y)}L${r2(p2.x)} ${r2(p2.y)}A${r0} ${r0} 0 ${large} 0 ${r2(p3.x)} ${r2(p3.y)}Z`;
  };

  const anchor = new Map<string, number>();
  let a = -Math.PI / 2 + 0.2;
  const shapes: Record<string, string> = {};
  const labels: Record<string, [number, number, number, string]> = {};
  for (const { m, files: fs } of mods) {
    const a0 = a;
    for (const f of fs) {
      const mid = a + per / 2;
      anchor.set(f.id, mid);
      shapes[`${prefix}-file-${f.id}`] = arcPath(R, R + G_SEG, a, a + per);
      const lp = pol(R + G_SEG + 10, mid);
      const flip = Math.cos(mid) < 0;
      labels[`${prefix}-file-${f.id}`] = [r2(lp.x), r2(lp.y), r2((mid * 180) / Math.PI + (flip ? 180 : 0)), flip ? "end" : "start"];
      st.groups[`${prefix}-file-${f.id}`] = [0, 0, 0, 0];
      a += per + G_GAP_FILE;
    }
    const a1 = a - G_GAP_FILE;
    shapes[`${prefix}-mod-${m.id}`] = arcPath(R + G_SEG + 4, R + G_SEG + 8, a0, a1);
    const mid = (a0 + a1) / 2;
    const lp = pol(R + G_SEG + 150, mid);
    labels[`${prefix}-mod-${m.id}`] = [r2(lp.x), r2(lp.y), 0, Math.cos(mid) < -0.2 ? "end" : Math.cos(mid) > 0.2 ? "start" : "middle"];
    st.groups[`${prefix}-mod-${m.id}`] = [0, 0, 0, 0];
    a += G_GAP_MOD;
  }

  for (const e of v.edges) {
    const fa = anchor.get(e.from.slice(5)), fb = anchor.get(e.to.slice(5));
    if (fa === undefined || fb === undefined) continue;
    const p0 = pol(R - 2, fa), p1 = pol(R - 2, fb);
    const bend = e.cls.includes("edge-seam") ? 0.15 : 0.45;
    const c = { x: cx + (p0.x + p1.x - 2 * cx) * bend * 0.5, y: cy + (p0.y + p1.y - 2 * cy) * bend * 0.5 };
    st.edges[e.eid] = `M${r2(p0.x)} ${r2(p0.y)}Q${r2(c.x)} ${r2(c.y)} ${r2(p1.x)} ${r2(p1.y)}`;
    if (e.pairs.length > 1) st.labels[e.eid] = [r2((p0.x + p1.x + 2 * c.x) / 4), r2((p0.y + p1.y + 2 * c.y) / 4)];
  }
  if (focus) {
    for (const c of v.cells) {
      if (!c.port) continue;
      const [dir, fileId] = c.port.split(":") as ["in" | "out", string];
      const ang = anchor.get(fileId);
      if (ang === undefined) continue;
      const p = pol(R + G_SEG + 24 + (dir === "in" ? 0 : 0), ang + (dir === "in" ? -per * 0.22 : per * 0.22));
      st.cells[c.cid] = [r2(p.x - c.w / 2), r2(p.y - PORT_H / 2)];
    }
  }
  // Shapes and label placements travel in the labels map under the group id.
  for (const [k, d] of Object.entries(shapes)) st.edges[`shape:${k}`] = d;
  for (const [k, l] of Object.entries(labels)) st.edges[`label:${k}`] = l.join("|");
  st.w = r2(cx * 2);
  st.h = r2(cy * 2);
  return st;
}

// ===========================================================================
// Build every variant
// ===========================================================================

const mk = (key: string, name: string, note: string, built: { cells: Cell[]; groups: Group[]; edges: EdgeRef[] }, hidden = false): Variant => ({ key, name, note, hidden, ...built, full: emptyState(), focus: emptyState() });

const E1 = mk("E1", "Blueprint, tests framed", "test files in their own frame inside the module", buildNested("E1", "symbol", true));
E1.focus = await layoutNested("E1", "symbol", E1, "focus", true);
E1.full = await layoutNested("E1", "symbol", E1, "full", true);

const E2 = mk("E2", "Blueprint, tests dimmed", "test files in place, dimmed until hovered", buildNested("E2", "symbol"));
E2.focus = await layoutNested("E2", "symbol", E2, "focus");
E2.full = await layoutNested("E2", "symbol", E2, "full");

const F = mk("F", "Seams", "module > file, calls bundled per file pair", buildNested("F", "file"), true);
F.focus = await layoutNested("F", "file", F, "focus");
F.full = await layoutNested("F", "file", F, "full");

const G = mk("G", "Compass", "surprise: modules as arcs, files as segments, calls as chords", buildCompass("G"), true);
G.focus = layoutCompass("G", G, "focus");
G.full = layoutCompass("G", G, "full");

const variants = [E1, E2, F, G];

// ===========================================================================
// Emit
// ===========================================================================

const island = (id: string, value: unknown) => `<script type="application/json" id="${id}">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`;

const graphData = {
  pr: graph.pr,
  longThreshold: LONG_SYMBOL_LINES,
  modules: [...modulesInGraph].map((m) => ({ id: m.id, name: m.name, root: m.root })),
  files: files.map((f) => ({ id: f.id, path: f.path, rel: relPath(f), module: moduleOfFile(f).id, moduleName: moduleOfFile(f).name, touched: f.touched, status: f.status, role: f.role, changed: f.changedLines.length })),
  symbols: symbols.map((s) => ({
    id: s.id, file: s.fileId, name: s.parentId ? `${symById.get(s.parentId)!.name}.${s.name}` : s.name, short: s.name, kind: s.kind,
    start: s.line.start, end: s.line.end, lines: s.lineCount, touched: s.touched, sig: s.signatureTouched, hop: s.hop, change: changeOf(s),
    long: isLong(s), changed: s.changedLines, diff: s.diff ?? null, hand: s.handAdded ?? false,
  })),
  edges: edges.map((e) => ({ from: e.from, to: e.to, hand: e.handAdded ?? false })),
  ports: Object.fromEntries(touchedFiles.flatMap((f) => portsFor(f.id)).map((p) => [`${p.dir}:${p.fileId}`, p.ids])),
};
const layoutData: Record<string, { full: State; focus: State }> = {};
for (const v of variants) layoutData[v.key] = { full: v.full, focus: v.focus };

const sceneSvg = (v: Variant) => {
  const groups = v.groups.map((g) => `<g class="${g.cls}" data-gid="${g.gid}"${g.sel ? ` data-sel="${esc(g.sel)}"` : ""}${g.un ? ` data-un="1"` : ""}>${g.body}</g>`).join("");
  const wires = v.edges.map((e) => `<g class="wire" data-eid="${esc(e.eid)}"${e.un ? ` data-un="1"` : ""} data-pairs="${esc(JSON.stringify(e.pairs))}"><path class="${e.cls}" marker-end="url(#arrow)"/>${e.pairs.length > 1 ? `<g class="elabel"><rect rx="7" width="${12 + String(e.pairs.length).length * 7}" height="14" x="${-(12 + String(e.pairs.length).length * 7) / 2}" y="-7"/><text y="3.5" text-anchor="middle">${e.pairs.length}</text></g>` : ""}</g>`).join("");
  const cells = v.cells.map((c) => `<g class="${c.cls}" data-cid="${esc(c.cid)}"${c.sel ? ` data-sel="${esc(c.sel)}"` : ""}${c.port ? ` data-port="${esc(c.port)}"` : ""}${c.un ? ` data-un="1"` : ""}>${c.body}</g>`).join("");
  return `<g class="scene" data-v="${v.key}"><g class="vp"><rect class="grid" x="-6000" y="-6000" width="20000" height="20000"/><g class="layer-groups">${groups}</g><g class="layer-edges">${wires}</g><g class="layer-cells">${cells}</g><g class="layer-lane"></g></g></g>`;
};

const counts = {
  touchedFiles: touchedFiles.length,
  touchedSymbols: symbols.filter((s) => s.touched && !isTest(s)).length,
  touchedTests: symbols.filter((s) => s.touched && isTest(s)).length,
  neighbors: symbols.filter((s) => !s.touched).length,
  neighborFiles: files.filter((f) => !f.touched).length,
  modules: touchedModules.length,
  long: symbols.filter(isLong).length,
  added: symbols.filter((s) => s.touched && !isTest(s) && changeOf(s) === "added").length,
  modified: symbols.filter((s) => s.touched && !isTest(s) && changeOf(s) === "modified").length,
};

const css = `
:root{
  --paper:oklch(0.975 0.004 250);--paper-2:oklch(0.945 0.006 250);--card:oklch(0.995 0.002 250);
  --ink:oklch(0.24 0.02 262);--ink-2:oklch(0.44 0.018 262);--ink-3:oklch(0.62 0.014 262);
  --hair:oklch(0.24 0.02 262 / 0.2);--hair-2:oklch(0.24 0.02 262 / 0.4);
  /* Git change state, the colors every Git tool uses. Red only ever means deleted. */
  --add:oklch(0.56 0.15 152);--add-bg:oklch(0.94 0.06 152);--add-bg-2:oklch(0.88 0.11 152);
  --chg:oklch(0.66 0.14 76);--chg-bg:oklch(0.95 0.06 86);
  --del:oklch(0.54 0.19 26);--del-bg:oklch(0.94 0.045 22);--del-bg-2:oklch(0.88 0.08 22);
  --ren:oklch(0.58 0.02 262);
  --accent:oklch(0.48 0.15 266);--accent-soft:oklch(0.48 0.15 266 / 0.1);
  --touch:var(--chg);--touch-soft:oklch(0.66 0.14 76 / 0.14);
  --test:oklch(0.52 0.11 302);--test-soft:oklch(0.52 0.11 302 / 0.09);
  --prod:oklch(0.42 0.04 240);
  --sig:oklch(0.45 0.16 322);
  --in:oklch(0.5 0.16 250);--out:oklch(0.5 0.13 160);
  --long:var(--ink-2);
  --link:oklch(0.55 0.16 232);--link-soft:oklch(0.55 0.16 232 / 0.16);
  --mod:oklch(0.24 0.02 262 / 0.05);
  --shadow:oklch(0.24 0.02 262 / 0.28);
  --sans:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Inter,system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,"Cascadia Mono",Consolas,monospace;
  color-scheme:light;
}
:root[data-theme="dark"],:root:not([data-theme="light"]).sys-dark{
  --paper:oklch(0.2 0.012 262);--paper-2:oklch(0.25 0.014 262);--card:oklch(0.235 0.013 262);
  --ink:oklch(0.93 0.008 250);--ink-2:oklch(0.74 0.012 250);--ink-3:oklch(0.56 0.012 250);
  --hair:oklch(0.93 0.008 250 / 0.16);--hair-2:oklch(0.93 0.008 250 / 0.36);
  --add:oklch(0.74 0.16 152);--add-bg:oklch(0.32 0.055 152);--add-bg-2:oklch(0.42 0.1 152);
  --chg:oklch(0.79 0.14 80);--chg-bg:oklch(0.33 0.05 86);
  --del:oklch(0.7 0.16 24);--del-bg:oklch(0.31 0.06 22);--del-bg-2:oklch(0.4 0.1 22);
  --ren:oklch(0.7 0.02 262);
  --accent:oklch(0.74 0.13 266);--accent-soft:oklch(0.74 0.13 266 / 0.16);
  --touch:var(--chg);--touch-soft:oklch(0.79 0.14 80 / 0.16);
  --test:oklch(0.72 0.1 302);--test-soft:oklch(0.72 0.1 302 / 0.12);
  --prod:oklch(0.78 0.04 240);
  --sig:oklch(0.76 0.14 322);
  --in:oklch(0.72 0.13 250);--out:oklch(0.72 0.13 160);
  --long:var(--ink-2);
  --link:oklch(0.76 0.13 232);--link-soft:oklch(0.76 0.13 232 / 0.2);
  --mod:oklch(0.93 0.008 250 / 0.04);
  --shadow:oklch(0 0 0 / 0.6);
  color-scheme:dark;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{--side-w:340px;background:var(--paper);color:var(--ink);font-family:var(--sans);display:grid;grid-template-columns:minmax(0,1fr) var(--side-w);grid-template-rows:auto minmax(0,1fr);overflow:hidden;-webkit-font-smoothing:antialiased}
body.resizing{cursor:col-resize;user-select:none}
.masthead{grid-column:1/3;display:grid;grid-template-columns:1fr auto;gap:6px 24px;padding:14px 22px 12px;border-bottom:1px solid var(--hair);background:var(--paper);align-items:start}
.masthead .top{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.masthead .pr{font-family:var(--mono);font-size:11px;color:var(--accent)}
.masthead h1{margin:0;font-size:17px;font-weight:600;letter-spacing:-.01em;line-height:1.25}
.masthead .sha{font-family:var(--mono);font-size:10.5px;color:var(--ink-3)}
.verdict{font-size:14px;line-height:1.45;max-width:78ch;color:var(--ink-2);margin-top:2px}
.verdict b{color:var(--ink);font-weight:600;font-family:var(--mono);font-size:12.5px}
.masthead .side{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.tally{display:flex;gap:14px;font-family:var(--mono);font-size:10.5px;color:var(--ink-2);white-space:nowrap}
.tally b{font-weight:600;color:var(--ink)}
.tally .long b{color:var(--ink)}
.tally .add b{color:var(--add)}
.theme{display:flex;border:1px solid var(--hair);border-radius:999px;overflow:hidden}
.theme button{background:none;border:0;color:var(--ink-3);font:inherit;font-size:11px;padding:3px 10px;cursor:pointer}
.theme button.on{background:var(--paper-2);color:var(--ink)}
.stagewrap{position:relative;overflow:hidden;min-height:0;min-width:0;border-right:1px solid var(--hair)}
svg#stage{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
svg#stage.dragging{cursor:grabbing}
.scene{display:none}.scene.on{display:inline}
.grid{fill:url(#dots)}

/* ---- modules and files ---- */
.group.module .box{fill:var(--mod);stroke:var(--hair-2);stroke-width:1.5}
.group.module.is-neighbor .box{stroke-dasharray:4 4;stroke:var(--hair)}
.m-name{font-family:var(--mono);font-size:13px;font-weight:600;fill:var(--ink)}
.m-meta{font-family:var(--mono);font-size:9.5px;fill:var(--ink-3)}
.group.file .box{fill:var(--card);stroke:var(--hair-2);stroke-width:1}
.group.file .band{fill:var(--paper-2)}
.group.file .mark{fill:var(--prod)}
.group.file.is-test.st-unchanged .mark{fill:var(--test)}
.group.file.is-test .band{fill:var(--test-soft)}
.group.file.is-neighbor .box{fill:none;stroke-dasharray:3 3;stroke:var(--hair)}
.group.file.is-neighbor .band{fill:none}
.group.file.is-neighbor .mark{opacity:.45}
.group.file.is-touched .box{stroke:var(--hair-2)}
.g-name{font-family:var(--mono);font-size:12px;font-weight:600;fill:var(--ink)}
.g-meta{font-family:var(--mono);font-size:9px;fill:var(--ink-3)}
.g-role{font-family:var(--mono);font-size:9px;fill:var(--prod)}
.group.file.is-test .g-role{fill:var(--test)}
.group.st-added .g-meta{fill:var(--add)}
.group.st-modified .g-meta{fill:var(--chg)}
.group.st-deleted .g-meta{fill:var(--del)}
.group.st-deleted .g-name{text-decoration:line-through}
/* E1: the module's test files live in their own frame */
.group.tframe .box{fill:none;stroke:var(--test);stroke-width:1.2;stroke-dasharray:6 4;opacity:.75}
.t-name{font-family:var(--mono);font-size:10.5px;font-weight:600;fill:var(--test);letter-spacing:.04em}
.t-meta{font-family:var(--mono);font-size:9px;fill:var(--ink-3)}
/* E2: test files stay in place but step back until the pointer finds them */
.scene[data-v="E2"] .tdim{opacity:.3;transition:opacity .14s linear}
.scene[data-v="E2"] .tdim.tlit{opacity:1}
.scene[data-v="E2"].has-sel .tdim.lit{opacity:1}
/* disclosed neighbors, parked in a lane beside the drawing */
.chip .box{fill:var(--card);stroke:var(--link);stroke-width:1.2;stroke-dasharray:4 2.5}
.chip .mark{fill:var(--ink-3)}
.chip.is-test .box{stroke:var(--test)}
.chip .c-name{font-family:var(--mono);font-size:11px;fill:var(--ink)}
.chip .c-kind{font-family:var(--mono);font-size:8.5px;fill:var(--ink-3)}
.chip .c-where{font-family:var(--mono);font-size:8.5px;fill:var(--ink-3)}
.chip .x{fill:var(--ink-3);font-family:var(--mono);font-size:11px;cursor:pointer}
.chip .x:hover{fill:var(--del)}
.lane-edge{fill:none;stroke:var(--link);stroke-width:1.3;stroke-dasharray:5 3;opacity:.8}
.lane-rule{stroke:var(--hair);stroke-width:1;stroke-dasharray:3 5}
.lane-cap{font-family:var(--mono);font-size:9.5px;fill:var(--ink-3)}

/* ---- symbols ---- */
.cell{cursor:pointer}
.cell .box{fill:var(--card);stroke:var(--hair);stroke-width:1}
.cell .mark,.cell .sig{fill:none}
/* Git change state, on symbols and on files. The left rule carries the state. */
.cell.st-added .mark,.group.st-added .mark{fill:var(--add)}
.cell.st-modified .mark,.group.st-modified .mark{fill:var(--chg)}
.cell.st-deleted .mark,.group.st-deleted .mark{fill:var(--del)}
.cell.st-renamed .mark,.group.st-renamed .mark{fill:var(--ren)}
.cell.st-added .box{stroke:oklch(from var(--add) l c h / 0.5)}
.cell.st-modified .box{stroke:oklch(from var(--chg) l c h / 0.55)}
.cell.st-deleted .box{stroke:oklch(from var(--del) l c h / 0.5)}
.cell.st-renamed .box{stroke:oklch(from var(--ren) l c h / 0.5)}
.cell.st-deleted .c-name{text-decoration:line-through}
.cell.is-neighbor .box{fill:var(--paper-2);stroke-dasharray:3 2.5;stroke:var(--hair)}
.cell.is-neighbor .mark{fill:var(--ink-3)}
.cell.is-neighbor .c-name{fill:var(--ink-2)}
.cell.is-test .box{fill:oklch(from var(--test) l c h / 0.05)}
.cell.is-test .c-kind{fill:var(--test)}
.cell.is-sig .sig{fill:var(--sig)}
/* The long-symbol flag is a badge, never a color: colors belong to Git state. */
.cell.is-long .lbadge{fill:none;stroke:var(--ink-2);stroke-width:1}
.cell.is-long .c-lines{fill:var(--ink);font-weight:700}
.cell.tests .box{stroke-dasharray:none}
/* code-to-canvas link: an identifier in the open diff points here */
.cell.hot .box{stroke:var(--link);stroke-width:2.4}
.cell.hot .c-name{fill:var(--link)}
.scene.has-sel .cell.hot{opacity:1}
.c-kind{font-family:var(--mono);font-size:8.5px;fill:var(--ink-3)}
.c-name{font-family:var(--mono);font-size:11.5px;fill:var(--ink)}
.c-lines{font-family:var(--mono);font-size:9px;fill:var(--ink-3)}

/* ---- ports: hidden neighbors behind a touched file ---- */
.port .box{fill:var(--ink);stroke:none}
.p-text{font-family:var(--mono);font-size:10px;fill:var(--paper);font-weight:600}
.p-arrow{fill:oklch(from var(--paper) l c h / 0.7)}
.port:hover .box{fill:var(--accent)}

/* ---- edges ---- */
.edge{fill:none;stroke:var(--hair-2);stroke-width:1.1}
.edge-local{stroke:var(--hair);stroke-dasharray:2 3}
.edge-seam{stroke:var(--ink);stroke-width:2.2}
.edge-test{stroke:var(--test)}
.edge-seam.edge-test{stroke:var(--test);stroke-width:2.2}
.edge-prod.edge-seam{stroke:var(--ink)}
.elabel rect{fill:var(--paper);stroke:var(--hair-2)}
.elabel text{font-family:var(--mono);font-size:9px;fill:var(--ink);font-weight:600}
.wire.lit .elabel rect{stroke:var(--ink)}

/* ---- compass ---- */
.arc-mod .arc{fill:var(--ink-3)}
.arc-mod.is-neighbor .arc{fill:var(--hair)}
.arc-label{font-size:12px}
.arc-file .seg{fill:var(--prod);stroke:var(--paper);stroke-width:1.5}
.arc-file.is-test .seg{fill:var(--test)}
.arc-file.is-neighbor .seg{fill:var(--paper-2);stroke:var(--hair-2)}
.arc-file.is-touched .seg{stroke:var(--touch);stroke-width:2.5}
.seg-label{font-family:var(--mono);font-size:10.5px;fill:var(--ink)}
.seg-meta{fill:var(--ink-3)}
.arc-file{cursor:pointer}
.chord{stroke-width:1.4;opacity:.85}
.chord.edge-seam{stroke-width:2.6}
.chord.edge-local{display:none}

.cell,.group,.wire{transition:transform .34s cubic-bezier(.22,1,.36,1),opacity .18s linear}
.hidden{display:none}
.swapping .wire{opacity:0 !important}

/* ---- selection ---- */
.scene.has-sel .cell:not(.lit):not(.port),.scene.has-sel .group.arc-file:not(.lit){opacity:.18}
.scene.has-sel .wire:not(.lit){opacity:.06}
.scene.has-sel .group.file:not(.lit),.scene.has-sel .group.module{opacity:.55}
.cell.sel .box,.group.sel .box,.group.sel .seg{stroke:var(--ink);stroke-width:1.8}
.cell.lit-in .box,.group.lit-in .box,.group.lit-in .seg{stroke:var(--in);stroke-width:1.6}
.cell.lit-out .box,.group.lit-out .box,.group.lit-out .seg{stroke:var(--out);stroke-width:1.6}
.wire.lit .edge{stroke-width:2.2;stroke:var(--ink)}
.wire.lit-in .edge{stroke:var(--in)}
.wire.lit-out .edge{stroke:var(--out)}

/* ---- right column: review rail and code panel share one resizable side ---- */
.side{position:relative;display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;min-height:0;overflow:hidden;background:var(--paper)}
.grip{position:absolute;left:-3px;top:0;bottom:0;width:7px;cursor:col-resize;z-index:33}
.grip::after{content:"";position:absolute;left:3px;top:0;bottom:0;width:1px;background:var(--hair)}
.grip:hover::after,body.resizing .grip::after{background:var(--accent);width:2px;left:2.5px}
.tabs{display:flex;gap:2px;padding:9px 14px 0;border-bottom:1px solid var(--hair)}
.tabs button{background:none;border:0;border-bottom:2px solid transparent;color:var(--ink-3);font:inherit;font-size:12px;padding:5px 11px 7px;cursor:pointer;display:flex;align-items:center;gap:7px}
.tabs button:hover{color:var(--ink)}
.tabs button.on{color:var(--ink);border-bottom-color:var(--accent)}
.tabs button[disabled]{opacity:.42;cursor:default}
.tabs .where{font-family:var(--mono);font-size:10px;color:var(--ink-3);max-width:20ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pane{min-height:0;flex-direction:column}
.pane:not(.on){display:none}
.pane.on{display:flex}
.rail{overflow-y:auto;padding:16px 18px 90px;display:flex;flex-direction:column;gap:18px;background:var(--paper)}
.rail h2{font-size:11px;letter-spacing:.02em;color:var(--ink-3);margin:0 0 9px;font-weight:600}
.legend{display:flex;flex-direction:column;gap:7px}
.legend div{display:flex;align-items:center;gap:9px;font-size:11.5px;color:var(--ink-2)}
.sw{width:28px;height:16px;flex:none;border:1px solid var(--hair);background:var(--card);position:relative}
.sw.a{border-color:oklch(from var(--add) l c h / .5);box-shadow:inset 3px 0 0 var(--add)}
.sw.m{border-color:oklch(from var(--chg) l c h / .55);box-shadow:inset 3px 0 0 var(--chg)}
.sw.dl{border-color:oklch(from var(--del) l c h / .5);box-shadow:inset 3px 0 0 var(--del)}
.sw.rn{border-color:oklch(from var(--ren) l c h / .5);box-shadow:inset 3px 0 0 var(--ren)}
.sw.s{border-color:oklch(from var(--chg) l c h / .55);box-shadow:inset 3px 0 0 var(--chg),inset 0 3px 0 var(--sig)}
.sw.n{background:var(--paper-2);border-style:dashed;box-shadow:inset 3px 0 0 var(--ink-3)}
.sw.te{background:var(--test-soft);border-color:var(--test)}
.sw.pr{border-color:var(--prod);box-shadow:inset 3px 0 0 var(--prod)}
.sw.lo{width:46px}
.sw.lo::after{content:"! 920 L";position:absolute;right:2px;top:1px;padding:0 3px;white-space:nowrap;border:1px solid var(--ink-2);border-radius:7px;font:700 8px/12px var(--mono);color:var(--ink)}
.sw.po{background:var(--ink);border-radius:8px;border:0}
.sw.po::after{content:"3+1t \\2192";position:absolute;inset:0;text-align:center;font:600 8px/16px var(--mono);color:var(--paper)}
.sw.line{border:0;background:none;height:2px;background:var(--ink)}
.sw.line.thin{height:1px;background:var(--hair-2)}
.sw.line.dash{height:0;background:none;border-top:1.5px dashed var(--ink-2)}
.sw.line.tst{background:var(--test)}
.toggle{display:flex;align-items:center;gap:10px;font-size:12px;cursor:pointer;user-select:none;color:var(--ink)}
.toggle input{appearance:none;width:32px;height:18px;border-radius:9px;background:var(--paper-2);border:1px solid var(--hair);position:relative;cursor:pointer;transition:background .18s;margin:0}
.toggle input::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--ink-3);transition:transform .2s cubic-bezier(.22,1,.36,1)}
.toggle input:checked{background:var(--accent-soft);border-color:var(--accent)}
.toggle input:checked::after{transform:translateX(14px);background:var(--accent)}
.hint{font-size:11px;line-height:1.5;color:var(--ink-3);margin:8px 0 0}
.hint b{color:var(--ink-2)}
.linky{background:none;border:0;padding:0;font:inherit;color:var(--link);cursor:pointer;text-decoration:underline}
.inspector{border-top:1px solid var(--hair);padding-top:15px}
.insp-name{font-family:var(--mono);font-size:13.5px;font-weight:600;word-break:break-all;line-height:1.3}
.insp-path{font-family:var(--mono);font-size:10px;color:var(--ink-3);word-break:break-all;margin-top:5px;line-height:1.45}
.badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
.badge{font-family:var(--mono);font-size:9.5px;padding:2.5px 6px;border:1px solid var(--hair);color:var(--ink-2);border-radius:3px}
.badge.t{border-color:var(--accent);color:var(--accent)}
.badge.st-added{border-color:var(--add);color:var(--add)}
.badge.st-modified{border-color:var(--chg);color:var(--chg)}
.badge.st-deleted{border-color:var(--del);color:var(--del)}
.badge.st-renamed{border-color:var(--ren);color:var(--ren)}
.badge.s{border-color:var(--sig);color:var(--sig)}
.badge.te{border-color:var(--test);color:var(--test)}
.badge.lo{border-color:var(--ink-2);color:var(--ink);font-weight:700}
.rel{margin-top:15px}
.rel h3{font-size:10px;color:var(--ink-3);margin:0 0 6px;font-weight:600;display:flex;justify-content:space-between}
.rel button,.rail .open{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--hair);padding:5px 0;font-family:var(--mono);font-size:11px;color:var(--ink);cursor:pointer;line-height:1.35}
.rel button:hover{color:var(--accent)}
.rel button span{display:block;font-size:9px;color:var(--ink-3)}
.rel button span.seam{color:var(--ink);font-weight:600}
.rel .none{font-size:11px;color:var(--ink-3);font-style:italic}
.rail .open{border:1px solid var(--hair);border-radius:4px;padding:6px 9px;margin-top:10px;text-align:center}
.rail .open:hover{border-color:var(--ink)}

/* ---- popover for a port ---- */
.pop{position:fixed;pointer-events:auto;z-index:45;background:var(--card);border:1px solid var(--hair-2);box-shadow:0 8px 28px var(--shadow);padding:10px 12px;min-width:260px;max-width:380px;max-height:60vh;overflow:auto;font-size:11px;display:none;border-radius:4px}
.pop.on{display:block}
.pop h4{margin:0 0 6px;font-size:11px;font-weight:600;color:var(--ink)}
.pop .grp{margin-top:8px}
.pop .grp h5{margin:0 0 3px;font:600 10px var(--mono);color:var(--ink-2)}
.pop .grp h5.te{color:var(--test)}
.pop .grp button{display:block;width:100%;text-align:left;background:none;border:0;border-radius:3px;font-family:var(--mono);font-size:10.5px;color:var(--ink);padding:2.5px 7px 2.5px 10px;line-height:1.35;cursor:pointer}
.pop .grp button:hover{background:var(--link-soft);color:var(--link)}
.pop .grp button span{color:var(--ink-3)}
.pop .grp button.shown{opacity:.5}
.pop .all{margin-top:9px;width:100%;background:none;border:1px solid var(--hair);border-radius:3px;color:var(--ink);font:inherit;font-size:10.5px;padding:4px;cursor:pointer}
.pop .all:hover{border-color:var(--link);color:var(--link)}
.pop .foot{margin-top:9px;color:var(--ink-3);font-size:10.5px}

/* ---- code panel: a unified diff in the shape every Git tool draws it ---- */
.code{background:var(--card);border-left:1px solid var(--hair)}
.code .head{padding:11px 14px 10px;border-bottom:1px solid var(--hair);display:flex;flex-direction:column;gap:5px}
.code .head .t{display:flex;align-items:baseline;gap:9px}
.code .head b{font-family:var(--mono);font-size:13px;font-weight:600;word-break:break-all}
.code .head .path{font-family:var(--mono);font-size:10px;color:var(--ink-3);word-break:break-all;line-height:1.45}
.code .head .stat{display:flex;gap:10px;font-family:var(--mono);font-size:10.5px;color:var(--ink-3);align-items:center;flex-wrap:wrap}
.code .head .stat .plus{color:var(--add);font-weight:700}
.code .head .stat .minus{color:var(--del);font-weight:700}
.code .head .close{margin-left:auto;background:none;border:1px solid var(--hair);border-radius:3px;color:var(--ink-2);font:inherit;font-size:11px;padding:2px 8px;cursor:pointer;flex:none}
.code .head .close:hover{border-color:var(--ink-2);color:var(--ink)}
.code .warn{font-size:11px;color:var(--ink);background:var(--paper-2);border:1px solid var(--hair-2);border-radius:3px;padding:5px 8px;line-height:1.4}
.code .warn b{font-family:var(--mono);font-weight:700;font-size:11px}
.diff{margin:0;overflow:auto;flex:1;font-family:var(--mono);font-size:11.5px;line-height:1.55;tab-size:2;white-space:pre}
.diff .ln{display:flex;min-width:max-content}
.diff .ln .n{width:40px;flex:none;text-align:right;padding:0 7px 0 4px;color:oklch(from var(--ink-3) l c h / .8);user-select:none;font-variant-numeric:tabular-nums}
.diff .ln .s{width:15px;flex:none;text-align:center;user-select:none;color:var(--ink-3)}
.diff .ln .t{padding:0 16px 0 2px;flex:1}
.diff .ln.add{background:var(--add-bg)}
.diff .ln.add .s{color:var(--add);font-weight:700}
.diff .ln.add .n{color:oklch(from var(--add) l c h / .85)}
.diff .ln.del{background:var(--del-bg)}
.diff .ln.del .s{color:var(--del);font-weight:700}
.diff .ln.del .n{color:oklch(from var(--del) l c h / .85)}
.diff .ln.sig{box-shadow:inset 3px 0 0 var(--sig)}
.diff .exp{display:flex;align-items:stretch;background:var(--paper-2);border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);color:var(--ink-3);font-size:10.5px;user-select:none}
.diff .exp button{background:none;border:0;border-right:1px solid var(--hair);color:var(--link);font:inherit;font-family:var(--mono);cursor:pointer;padding:3px 0;width:55px;flex:none;text-align:center}
.diff .exp button:hover{background:var(--link-soft)}
.diff .exp span{padding:3px 10px;flex:1;font-family:var(--mono)}
/* the code-to-canvas link */
.diff .id{border-bottom:1px dotted oklch(from var(--link) l c h / .6);cursor:pointer;border-radius:2px}
.diff .id.here{background:var(--link-soft);border-bottom:1px solid var(--link)}
.diff .id.hot{background:var(--link);color:var(--paper);border-bottom-color:transparent}
.diff .id.self{border-bottom-style:none;font-weight:700}
.code .foot{border-top:1px solid var(--hair);padding:7px 14px;font-size:10.5px;color:var(--ink-3);line-height:1.45;display:flex;gap:8px;align-items:center}
.code .foot .key{border-bottom:1px dotted oklch(from var(--link) l c h / .6);color:var(--ink-2)}
.code .empty{padding:24px 16px;color:var(--ink-3);font-size:12px;line-height:1.5}

/* ---- tooltip ---- */
.tip{position:fixed;pointer-events:none;opacity:0;transform:translateY(3px);transition:opacity .11s;background:var(--ink);color:var(--paper);padding:6px 9px;font-family:var(--mono);font-size:10.5px;line-height:1.5;max-width:420px;z-index:40;box-shadow:0 5px 18px var(--shadow);border-radius:3px}
.tip.on{opacity:1;transform:none}
.tip b{font-weight:600}
.tip i{opacity:.7;font-style:normal}

/* ---- switcher and zoom ---- */
.switcher{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);display:flex;align-items:stretch;background:var(--ink);color:var(--paper);z-index:50;box-shadow:0 8px 26px var(--shadow);border-radius:4px}
.switcher button{background:none;border:0;color:var(--paper);font-family:var(--mono);font-size:14px;padding:0 13px;cursor:pointer;opacity:.75}
.switcher button:hover{opacity:1}
.switcher .label{padding:8px 16px;display:flex;flex-direction:column;gap:1px;min-width:280px;border-left:1px solid oklch(from var(--paper) l c h / .16);border-right:1px solid oklch(from var(--paper) l c h / .16)}
.switcher .k{font-family:var(--mono);font-size:11.5px}
.switcher .k b{color:var(--paper);font-weight:700}
.switcher .n{font-size:10px;opacity:.65}
.zoom{position:absolute;right:14px;bottom:14px;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--hair);z-index:31}
.zoom button{background:none;border:0;border-bottom:1px solid var(--hair);width:29px;height:27px;cursor:pointer;font-family:var(--mono);font-size:13px;color:var(--ink-2)}
.zoom button:last-child{border-bottom:0;font-size:9px}
.zoom button:hover{background:var(--paper-2);color:var(--ink)}
.proto{position:absolute;left:14px;bottom:14px;font-family:var(--mono);font-size:9px;color:var(--ink-3)}
@media (prefers-reduced-motion: reduce){.cell,.group,.wire,.tdim{transition:none}}
`;

const script = `
const G = JSON.parse(document.getElementById("graph-data").textContent);
const L = JSON.parse(document.getElementById("layout-data").textContent);
const VS = ${JSON.stringify(variants.map((v) => ({ key: v.key, name: v.name, note: v.note, hidden: v.hidden ?? false })))};

const sym = new Map(G.symbols.map(s => [s.id, s]));
const file = new Map(G.files.map(f => [f.id, f]));
const mod = new Map(G.modules.map(m => [m.id, m]));
const inOf = new Map(G.symbols.map(s => [s.id, []]));
const outOf = new Map(G.symbols.map(s => [s.id, []]));
for (const e of G.edges) { inOf.get(e.to).push(e.from); outOf.get(e.from).push(e.to); }
const symsOfFile = id => G.symbols.filter(s => s.file === id).map(s => s.id);

/* ---- theme ---- */
const root = document.documentElement;
const mq = matchMedia("(prefers-color-scheme: dark)");
function applySys() { root.classList.toggle("sys-dark", mq.matches); }
applySys(); mq.addEventListener("change", applySys);
function setTheme(t) {
  if (t === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
  for (const b of document.querySelectorAll(".theme button")) b.classList.toggle("on", b.dataset.t === t);
}
document.querySelector(".theme").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setTheme(b.dataset.t); });
setTheme("system");

const stage = document.getElementById("stage");
const scenes = {};
for (const g of stage.querySelectorAll(".scene")) {
  scenes[g.dataset.v] = {
    root: g, vp: g.querySelector(".vp"),
    cells: [...g.querySelectorAll("[data-cid]")],
    groups: [...g.querySelectorAll("[data-gid]")],
    wires: [...g.querySelectorAll("[data-eid]")],
    laneG: g.querySelector(".layer-lane"), chips: [], order: [],
    view: null, fitted: false,
  };
}

let variant = "E1", disclosed = false, selected = null, openSym = null;
const NAV = VS.filter(v => !v.hidden);
const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const att = t => esc(t).replace(/"/g, "&quot;");

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
    const shape = P.edges["shape:" + el.dataset.gid];
    if (shape) {
      el.removeAttribute("transform");
      el.querySelector("path").setAttribute("d", shape);
      const [lx, ly, rot, anchor] = P.edges["label:" + el.dataset.gid].split("|");
      const t = el.querySelector("text");
      t.setAttribute("transform", "translate(" + lx + " " + ly + ") rotate(" + rot + ")");
      t.setAttribute("text-anchor", anchor);
      t.setAttribute("y", "3.5");
      continue;
    }
    el.setAttribute("transform", "translate(" + b[0] + " " + b[1] + ")");
    for (const t of el.querySelectorAll("[data-span]")) t.setAttribute(t.dataset.span, b[2]);
    for (const t of el.querySelectorAll("[data-span2]")) t.setAttribute(t.dataset.span2, b[3]);
    for (const t of el.querySelectorAll("[data-spanx]")) t.setAttribute("x", b[2] + Number(t.dataset.dx || 0));
    const box = el.querySelector(".box");
    if (box) { box.setAttribute("width", b[2]); box.setAttribute("height", b[3]); }
  }
  for (const el of S.wires) {
    const d = P.edges[el.dataset.eid] || "";
    const path = el.querySelector("path");
    if (d) { path.setAttribute("d", d); el.classList.remove("nopos"); } else el.classList.add("nopos");
    const lab = el.querySelector(".elabel"), lp = P.labels[el.dataset.eid];
    if (lab) { if (lp) { lab.setAttribute("transform", "translate(" + lp[0] + " " + lp[1] + ")"); lab.style.display = ""; } else lab.style.display = "none"; }
  }
  S.bounds = { w: P.w, h: P.h };
  for (const el of [...S.cells, ...S.groups, ...S.wires]) el.classList.toggle("hidden", el.classList.contains("nopos"));
}

/* ---- pan and zoom ---- */
/** Drawing box plus whatever the lanes hold, so a fit never cuts a disclosed chip. */
function extent(S) {
  const b = S.bounds || { w: 1000, h: 1000 };
  let x0 = 0, x1 = b.w, y1 = b.h;
  for (const c of S.chips) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x + LANE_W); y1 = Math.max(y1, c.y + CHIP_H); }
  return { x: x0, y: 0, w: x1 - x0, h: y1 };
}
function view(key, floor) {
  const S = scenes[key];
  if (!S.view) {
    const r = stage.getBoundingClientRect(), b = extent(S);
    const whole = Math.min((r.width - 40) / Math.max(b.w, 1), (r.height - 40) / Math.max(b.h, 1));
    const k = Math.min(1.1, Math.max(whole, floor || 0));
    S.view = { k, x: (r.width - b.w * k) / 2 - b.x * k, y: Math.max(14, (r.height - b.h * k) / 2) };
  }
  return S.view;
}
function paint(key) { const v = view(key); scenes[key].vp.setAttribute("transform", "translate(" + v.x + " " + v.y + ") scale(" + v.k + ")"); }
function fit(key, floor) { scenes[key].view = null; view(key, floor); paint(key); }

let drag = null;
stage.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  const v = view(variant);
  const hit = e.target.closest("[data-sel],[data-port],[data-drop]");
  drag = { px: e.clientX, py: e.clientY, x: v.x, y: v.y, moved: false, hit };
  stage.setPointerCapture(e.pointerId); stage.classList.add("dragging");
});
stage.addEventListener("pointermove", e => {
  if (!drag) return;
  const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  const v = view(variant); v.x = drag.x + dx; v.y = drag.y + dy; paint(variant);
});
stage.addEventListener("pointerup", e => {
  if (drag && !drag.moved) {
    const h = drag.hit;
    const drop = e.target.closest("[data-drop]");
    if (drop) dropChip(variant, drop.dataset.drop);
    else if (h && h.dataset.port) discloseP(h.dataset.port);
    else if (h) select(h.dataset.sel, true);
    else select(null);
  }
  drag = null; stage.classList.remove("dragging");
});
stage.addEventListener("wheel", e => {
  e.preventDefault();
  const v = view(variant), r = stage.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const step = Math.exp(-e.deltaY * (e.ctrlKey ? 0.008 : 0.0016));
  const k = Math.max(0.08, Math.min(4, v.k * step));
  v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k; paint(variant);
}, { passive: false });
function zoomBy(f) {
  const v = view(variant), r = stage.getBoundingClientRect(), mx = r.width / 2, my = r.height / 2;
  const k = Math.max(0.08, Math.min(4, v.k * f));
  v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k; paint(variant);
}

/* ---- hover: tooltip for symbols and files, popover for ports ---- */
const tip = document.querySelector(".tip"), pop = document.querySelector(".pop");
let pinnedPop = null;
stage.addEventListener("mousemove", e => {
  const port = e.target.closest("[data-port]");
  if (port && !drag) { showPop(port.dataset.port, e.clientX, e.clientY); tip.classList.remove("on"); return; }
  if (!pinnedPop) pop.classList.remove("on");
  const hit = e.target.closest("[data-sel]");
  hotCode(hit && !hit.dataset.sel.startsWith("file:") ? hit.dataset.sel : null);
  litTests(hit ? hit.dataset.sel : null);
  if (!hit || drag) { tip.classList.remove("on"); return; }
  const id = hit.dataset.sel;
  if (id.startsWith("file:")) {
    const f = file.get(id.slice(5)), syms = symsOfFile(f.id), t = syms.filter(s => sym.get(s).touched).length;
    tip.innerHTML = "<b>" + f.path + "</b><br><i>" + f.moduleName + " &#183; " + f.role + " &#183; " + f.status + (f.changed ? " &#183; " + f.changed + " lines changed" : "") + "</i><br><i>" + t + " of " + syms.length + " symbols touched</i>";
  } else {
    const s = sym.get(id), f = file.get(s.file);
    tip.innerHTML = "<b>" + s.name + "</b>  <i>" + s.kind + (s.hand ? " (hand-added)" : "") + "</i><br>" + f.path + "<i>:" + s.start + "-" + s.end + "</i>" +
      "<br><i>" + s.lines + " lines" + (s.long ? " &#183; long, over " + G.longThreshold : "") + " &#183; " + inOf.get(s.id).length + " callers &#183; " + outOf.get(s.id).length + " callees" +
      (s.touched ? " &#183; touched, " + s.changed.length + " lines changed" : " &#183; neighbor") + (s.sig ? " &#183; signature changed" : "") + "</i>" +
      (s.diff ? "<br><i>click to open the diff</i>" : "");
  }
  tip.classList.add("on");
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(e.clientX + 14, innerWidth - r.width - 8) + "px";
  tip.style.top = Math.min(e.clientY + 16, innerHeight - r.height - 8) + "px";
});
stage.addEventListener("mouseleave", () => { tip.classList.remove("on"); hotCode(null); litTests(null); if (!pinnedPop) pop.classList.remove("on"); });
/** E2 keeps test files in place but steps them back until the pointer finds one. */
function litTests(sel) {
  const S = scenes[variant];
  const fid = !sel ? null : sel.startsWith("file:") ? sel.slice(5) : sym.get(sel) && sym.get(sel).file;
  for (const el of [...S.cells, ...S.groups]) {
    if (!el.classList.contains("tdim")) continue;
    const own = el.dataset.sel || "";
    const f = own.startsWith("file:") ? own.slice(5) : sym.get(own) && sym.get(own).file;
    el.classList.toggle("tlit", !!fid && f === fid);
  }
}

pop.addEventListener("mouseenter", () => { pinnedPop = 1; });
pop.addEventListener("mouseleave", () => { pinnedPop = null; pop.classList.remove("on"); });
pop.addEventListener("click", e => {
  const one = e.target.closest("[data-one]");
  if (one) { discloseOne(one.dataset.one, one.dataset.dir, pop.dataset.anchor); one.classList.add("shown"); select(one.dataset.one, false); return; }
  const all = e.target.closest("[data-all]");
  if (all) { discloseP(all.dataset.all); pinnedPop = null; pop.classList.remove("on"); }
});
function showPop(portKey, x, y) {
  const [dir, fileId] = [portKey.slice(0, portKey.indexOf(":")), portKey.slice(portKey.indexOf(":") + 1)];
  const ids = G.ports[portKey] || [];
  const f = file.get(fileId);
  const byMod = new Map();
  for (const id of ids) {
    const s = sym.get(id), sf = file.get(s.file);
    const k = sf.moduleName + "|" + sf.role;
    if (!byMod.has(k)) byMod.set(k, []);
    byMod.get(k).push(s);
  }
  let html = "<h4>" + (dir === "out" ? "Callees" : "Callers") + " outside the change &#183; " + ids.length + "</h4><div style='font-family:var(--mono);font-size:10px;color:var(--ink-3)'>" + f.path + "</div>";
  for (const [k, list] of [...byMod.entries()].sort()) {
    const [m, role] = k.split("|");
    html += "<div class='grp'><h5 class='" + (role === "test" ? "te" : "") + "'>" + m + " &#183; " + role + (m !== f.moduleName ? " &#183; across a seam" : "") + "</h5>";
    for (const s of list) html += '<button data-one="' + att(s.id) + '" data-dir="' + dir + '">' + esc(s.short) + " <span>" + esc(file.get(s.file).rel) + ":" + s.start + "</span></button>";
    html += "</div>";
  }
  html += '<button class="all" data-all="' + att(portKey) + '">Place all ' + ids.length + " in the lane</button>";
  html += "<div class='foot'>Or click one entry to place only that symbol.</div>";
  pop.innerHTML = html;
  pop.dataset.anchor = fileId;
  pop.classList.add("on");
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.min(x + 14, innerWidth - r.width - 8) + "px";
  pop.style.top = Math.min(y + 14, innerHeight - r.height - 8) + "px";
}
/* ---- incremental disclosure -------------------------------------------
   No layout library runs at view time, so a disclosed neighbor is not folded
   back into the elkjs drawing. It is parked in a lane beside the drawing and
   tied to its anchor by a dashed line. The elkjs geometry never moves, and a
   chip that is already placed never shifts, so the reviewer's mental map holds.
   The cost: a chip's position in the lane is disclosure order, not graph
   structure. The chip carries its module and path as text instead.        */
const LANE_W = 244, CHIP_H = 28, CHIP_GAP = 8, LANE_GAP = 120, COL_GAP = 18;

function anchorBox(key, sel) {
  const P = L[key][disclosed ? "full" : "focus"];
  const g = P.groups[key + "-file-" + sel];
  if (g) return g;
  const c = P.cells[key + "-sym-" + sel];
  return c ? [c[0], c[1], 150, 24] : null;
}
/** Place one neighbor in the lane of the active scene. Returns false if it is already there. */
function placeChip(key, id, dir, anchorId) {
  const S = scenes[key];
  if (S.chips.some(c => c.id === id)) return false;
  const s = sym.get(id), f = file.get(s.file), b = extent(S);
  const list = S.chips.filter(c => c.dir === dir);
  const rows = Math.max(5, Math.floor((S.bounds.h || 600) / (CHIP_H + CHIP_GAP)));
  const i = list.length, col = Math.floor(i / rows), row = i % rows;
  const laneX = dir === "out"
    ? (S.bounds.w || 0) + LANE_GAP + col * (LANE_W + COL_GAP)
    : -LANE_GAP - LANE_W - col * (LANE_W + COL_GAP);
  const ab0 = anchorBox(key, anchorId);
  if (!list.length) S["top_" + dir] = ab0 ? Math.max(0, ab0[1] - 10) : 30;
  const chip = { id, dir, anchorId, x: laneX, y: (S["top_" + dir] || 30) + row * (CHIP_H + CHIP_GAP) };
  const where = f.moduleName + " \u00b7 " + f.rel + ":" + s.start;
  const html =
    '<g class="cell chip ' + (f.role === "test" ? "is-test" : "is-prod") + '" data-chip="1" data-sel="' + att(id) + '" transform="translate(' + chip.x + " " + chip.y + ')">' +
    '<rect class="box" x="0" y="0" width="' + LANE_W + '" height="' + CHIP_H + '" rx="3"/>' +
    '<rect class="mark" x="0" y="0" width="3" height="' + CHIP_H + '"/>' +
    '<text class="c-kind" x="9" y="12">' + (s.kind === "test" ? "t" : s.kind[0]) + '</text>' +
    '<text class="c-name" x="22" y="12">' + esc(s.short.length > 26 ? s.short.slice(0, 25) + "\u2026" : s.short) + '</text>' +
    '<text class="c-where" x="22" y="23">' + esc(where.length > 34 ? "\u2026" + where.slice(-33) : where) + '</text>' +
    '<text class="x" x="' + (LANE_W - 8) + '" y="13" text-anchor="end" data-drop="' + att(id) + '">\u00d7</text>' +
    '</g>';
  const ab = anchorBox(key, anchorId) || [0, 0, 10, 10];
  const ax = dir === "out" ? ab[0] + ab[2] : ab[0];
  const ay = ab[1] + Math.min(ab[3], 40) / 2;
  const cx = dir === "out" ? chip.x : chip.x + LANE_W;
  const cy = chip.y + CHIP_H / 2;
  const mid = (ax + cx) / 2;
  const edge = '<path class="lane-edge" d="M' + ax + " " + ay + " C" + mid + " " + ay + " " + mid + " " + cy + " " + cx + " " + cy + '" marker-end="url(#arrow)"/>';
  S.laneG.insertAdjacentHTML("beforeend", edge + html);
  chip.el = S.laneG.lastElementChild;
  chip.edgeEl = chip.el.previousElementSibling;
  S.chips.push(chip);
  return true;
}
function dropChip(key, id) {
  const S = scenes[key], i = S.chips.findIndex(c => c.id === id);
  if (i < 0) return;
  S.chips[i].el.remove(); S.chips[i].edgeEl.remove(); S.chips.splice(i, 1);
  afterLane(key);
}
function clearLane(key) {
  const S = scenes[key];
  S.laneG.textContent = ""; S.chips = [];
  afterLane(key);
}
function afterLane(key) {
  const S = scenes[key], caps = S.chips.length;
  laneNote();
  refreshIdents();
  if (selected) select(selected, false, true);
}
function laneNote() {
  const S = scenes[variant], n = S.chips.length;
  const box = document.getElementById("lane-state");
  box.innerHTML = n === 0
    ? '<p class="hint" style="margin:0 0 9px">Nothing disclosed yet.</p>'
    : '<p class="hint" style="margin:0 0 9px"><b>' + n + '</b> neighbor' + (n === 1 ? "" : "s") + ' in the lane. <button class="linky" id="clear-lane">Clear</button></p>';
  const b = document.getElementById("clear-lane");
  if (b) b.addEventListener("click", () => { clearLane(variant); fit(variant, 0.3); });
}
/** A whole port: every neighbor behind that one count, and nothing else. */
function discloseP(portKey) {
  const ids = G.ports[portKey] || [];
  const dir = portKey.slice(0, portKey.indexOf(":"));
  const fileId = portKey.slice(portKey.indexOf(":") + 1);
  if (disclosed) { setDisclosed(false); }
  let added = 0;
  for (const id of ids) if (placeChip(variant, id, dir, fileId)) added++;
  afterLane(variant);
  if (added) fit(variant, 0.28);
}
/** One entry of a port list, or one identifier in the open diff. */
function discloseOne(id, dir, anchorId) {
  if (disclosed) setDisclosed(false);
  const ok = placeChip(variant, id, dir, anchorId);
  afterLane(variant);
  if (ok) fit(variant, 0.32);
  return ok;
}

/* ---- selection: a symbol, or a whole file ---- */
function selectionSet(id) {
  if (!id) return new Set();
  return new Set(id.startsWith("file:") ? symsOfFile(id.slice(5)) : [id]);
}
function select(id, withCode, keep) {
  selected = keep ? id : (selected === id ? null : id);
  const set = selectionSet(selected);
  const ins = new Set(), outs = new Set();
  for (const s of set) { for (const i of inOf.get(s)) if (!set.has(i)) ins.add(i); for (const o of outOf.get(s)) if (!set.has(o)) outs.add(o); }
  for (const key in scenes) {
    const S = scenes[key];
    S.root.classList.toggle("has-sel", !!selected);
    for (const el of [...S.cells, ...S.chips.map(c => c.el), ...S.groups]) {
      el.classList.remove("lit", "lit-in", "lit-out", "sel");
      if (!selected || !el.dataset.sel) continue;
      const mine = selectionSet(el.dataset.sel);
      const all = [...mine];
      if (all.length && all.every(s => set.has(s))) el.classList.add("lit", "sel");
      else if (all.some(s => set.has(s))) el.classList.add("lit");
      else if (all.some(s => ins.has(s))) el.classList.add("lit", "lit-in");
      else if (all.some(s => outs.has(s))) el.classList.add("lit", "lit-out");
    }
    for (const el of S.wires) {
      el.classList.remove("lit", "lit-in", "lit-out");
      if (!selected) continue;
      const pairs = JSON.parse(el.dataset.pairs);
      if (pairs.some(p => set.has(p[1]) && !set.has(p[0]))) el.classList.add("lit", "lit-in");
      else if (pairs.some(p => set.has(p[0]) && !set.has(p[1]))) el.classList.add("lit", "lit-out");
      else if (pairs.some(p => set.has(p[0]) && set.has(p[1]))) el.classList.add("lit");
    }
  }
  inspect();
  if (selected && !selected.startsWith("file:") && sym.get(selected).diff && withCode !== false) openCode(selected);
  else if (!selected && !keep) closeCode();
}

/* ---- inspector ---- */
const insp = document.getElementById("inspector");
function row(id, dir, from) {
  const s = sym.get(id), f = file.get(s.file);
  const seam = from && file.get(from).module !== f.module;
  return '<button data-jump="' + id + '">' + (dir === "in" ? "&#8592; " : "&#8594; ") + s.name +
    "<span" + (seam ? " class='seam'" : "") + ">" + (seam ? "across a seam: " + f.moduleName + " &#183; " : "") + f.rel + ":" + s.start + " &#183; " + f.role + (s.touched ? " &#183; touched" : "") + "</span></button>";
}
function inspect() {
  if (!selected) {
    insp.innerHTML = '<h2>Selection</h2><p class="hint" style="margin:0">Click a symbol or a file to trace its callers and callees. Click a touched symbol to open its source. Click a port to disclose the neighbors behind it.</p>';
    return;
  }
  if (selected.startsWith("file:")) {
    const f = file.get(selected.slice(5)), syms = symsOfFile(f.id).map(id => sym.get(id));
    insp.innerHTML = '<h2>Selection</h2><div class="insp-name">' + f.path.slice(f.path.lastIndexOf("/") + 1) + '</div><div class="insp-path">' + f.path + '</div>' +
      '<div class="badges"><span class="badge ' + (f.role === "test" ? "te" : "") + '">' + f.role + '</span><span class="badge">' + f.moduleName + '</span><span class="badge ' + (f.touched ? "st-" + f.status : "") + '">' + f.status + '</span></div>' +
      '<div class="rel"><h3><span>Symbols</span><span>' + syms.length + '</span></h3>' +
      syms.sort((a, b) => a.start - b.start).map(s => '<button data-jump="' + s.id + '">' + s.name + '<span>' + s.kind + ' &#183; ' + s.lines + ' lines' + (s.touched ? ' &#183; touched' : '') + (s.long ? ' &#183; long' : '') + '</span></button>').join("") + '</div>';
    return;
  }
  const s = sym.get(selected), f = file.get(s.file);
  const ins = [...new Set(inOf.get(selected))].sort(), outs = [...new Set(outOf.get(selected))].sort();
  insp.innerHTML = '<h2>Selection</h2>' +
    '<div class="insp-name">' + s.name + '</div>' +
    '<div class="insp-path">' + f.path + ':' + s.start + '-' + s.end + '</div>' +
    '<div class="badges"><span class="badge">' + s.kind + '</span>' +
      (s.touched ? '<span class="badge st-' + s.change + '">' + s.change + '</span>' : '<span class="badge">neighbor</span>') +
      (s.sig ? '<span class="badge s">signature</span>' : '') +
      '<span class="badge ' + (f.role === "test" ? "te" : "") + '">' + f.role + '</span>' +
      '<span class="badge' + (s.long ? ' lo' : '') + '">' + (s.long ? '! ' : '') + s.lines + ' lines</span>' +
      (s.hand ? '<span class="badge">hand-added</span>' : '') + '</div>' +
    (s.diff ? '<button class="open" data-open="' + att(s.id) + '">Open the diff, ' + s.changed.length + ' changed lines</button>' : '') +
    '<div class="rel"><h3><span>Called by</span><span>' + ins.length + '</span></h3>' +
      (ins.length ? ins.map(i => row(i, "in", s.file)).join("") : '<div class="none">Nothing in this graph calls it.</div>') + '</div>' +
    '<div class="rel"><h3><span>Calls</span><span>' + outs.length + '</span></h3>' +
      (outs.length ? outs.map(i => row(i, "out", s.file)).join("") : '<div class="none">It calls nothing in this graph.</div>') + '</div>';
}
insp.addEventListener("click", e => {
  const b = e.target.closest("[data-jump]");
  if (b) { selected = null; select(b.dataset.jump, false); return; }
  const o = e.target.closest("[data-open]");
  if (o) openCode(o.dataset.open);
});

/* ---- code panel: one symbol's unified diff, GitHub shape -----------------
   Unchanged runs collapse to an expander with three lines of context around
   each hunk. Identifiers that name a symbol in this graph are marked, so the
   code and the canvas point at each other.                               */
const codePane = document.querySelector(".pane.code");
const diffEl = codePane.querySelector(".diff");
const CTX = 3, STEP = 20;
let expanded = [], names = new Map(), IDRE = null;

const BS = String.fromCharCode(92);
const rxEsc = t => t.replace(/[^A-Za-z0-9_$]/g, c => BS + c);

function buildNames(id) {
  names = new Map(); IDRE = null;
  const add = (n, sid) => { if (!n || n.length < 2) return; if (!names.has(n)) names.set(n, []); if (!names.get(n).includes(sid)) names.get(n).push(sid); };
  for (const o of outOf.get(id) || []) add(sym.get(o).short, o);
  add(sym.get(id).short, id);
  if (!names.size) return;
  const keys = [...names.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  IDRE = new RegExp(BS + "b(?:" + keys.map(rxEsc).join("|") + ")" + BS + "b", "g");
}
/** Escape the line, then wrap the identifiers that are symbols in this graph. */
function markup(t) {
  if (!IDRE) return esc(t);
  let out = "", last = 0, m;
  IDRE.lastIndex = 0;
  while ((m = IDRE.exec(t))) {
    out += esc(t.slice(last, m.index));
    const ids = names.get(m[0]);
    out += '<span class="id' + (ids.includes(openSym) ? " self" : "") + '" data-sym="' + att(ids[0]) + '">' + esc(m[0]) + "</span>";
    last = m.index + m[0].length;
  }
  return out + esc(t.slice(last));
}
function renderDiff() {
  const s = sym.get(openSym), rows = s.diff || [];
  if (!rows.length) { diffEl.innerHTML = '<div class="empty">No diff for this symbol.</div>'; return; }
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => { if (r.k !== "ctx") for (let j = Math.max(0, i - CTX); j <= Math.min(rows.length - 1, i + CTX); j++) keep[j] = true; });
  for (const [a, b] of expanded) for (let j = a; j <= b; j++) keep[j] = true;
  const sigLines = new Set(s.sig ? [s.start] : []);
  let html = "", i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      const r = rows[i];
      html += '<div class="ln ' + r.k + (r.n && sigLines.has(r.n) ? " sig" : "") + '">' +
        '<span class="n">' + (r.o == null ? "" : r.o) + '</span>' +
        '<span class="n">' + (r.n == null ? "" : r.n) + '</span>' +
        '<span class="s">' + (r.k === "add" ? "+" : r.k === "del" ? "−" : " ") + '</span>' +
        '<span class="t">' + markup(r.t) + "</span></div>";
      i++; continue;
    }
    let j = i; while (j < rows.length && !keep[j]) j++;
    const a = i, b = j - 1, gap = b - a + 1;
    html += '<div class="exp">' +
      (gap > STEP ? '<button data-exp="' + a + "," + Math.min(b, a + STEP - 1) + '" title="Expand ' + STEP + ' lines up">↑</button>' : "") +
      '<button data-exp="' + a + "," + b + '" title="Expand every hidden line">' + (gap > STEP ? "all" : "↕") + "</button>" +
      (gap > STEP ? '<button data-exp="' + Math.max(a, b - STEP + 1) + "," + b + '" title="Expand ' + STEP + ' lines down">↓</button>' : "") +
      "<span>" + gap + " unchanged line" + (gap === 1 ? "" : "s") + "</span></div>";
    i = j;
  }
  diffEl.innerHTML = html;
  refreshIdents();
}
function openCode(id) {
  const s = sym.get(id), f = file.get(s.file);
  if (!s.diff) return;
  openSym = id; expanded = [];
  buildNames(id);
  const plus = s.diff.filter(r => r.k === "add").length, minus = s.diff.filter(r => r.k === "del").length;
  codePane.querySelector(".head").innerHTML =
    '<div class="t"><b>' + esc(s.name) + "</b>" +
      '<span class="badge st-' + s.change + '">' + s.change + "</span>" +
      '<button class="close" data-close>Close</button></div>' +
    '<div class="path">' + esc(f.path) + ":" + s.start + "–" + s.end + "</div>" +
    '<div class="stat"><span class="plus">+' + plus + '</span><span class="minus">−' + minus + "</span>" +
      "<span>" + s.lines + " lines</span><span>" + f.moduleName + "</span><span>" + f.role + "</span>" +
      (s.sig ? '<span style="color:var(--sig);font-weight:700">signature changed</span>' : "") + "</div>" +
    (s.long ? '<div class="warn"><b>! ' + s.lines + " L</b> — over the " + G.longThreshold + " line threshold. A symbol this long hides its own seams.</div>" : "");
  codePane.querySelector(".foot").innerHTML =
    '<span><span class="key">dotted</span> identifiers are symbols in this graph. Hover to find one on the canvas, click to place it.</span>';
  renderDiff();
  document.querySelector('.tabs [data-tab="code"]').disabled = false;
  document.querySelector('.tabs .where').textContent = " " + f.path.slice(f.path.lastIndexOf("/") + 1);
  setTab("code");
  const first = diffEl.querySelector(".ln.add, .ln.del");
  if (first) setTimeout(() => first.scrollIntoView({ block: "center" }), 40);
}
function closeCode() {
  openSym = null; names = new Map(); IDRE = null;
  diffEl.innerHTML = ""; codePane.querySelector(".head").innerHTML = ""; codePane.querySelector(".foot").innerHTML = "";
  document.querySelector('.tabs [data-tab="code"]').disabled = true;
  document.querySelector('.tabs .where').textContent = "";
  setTab("review");
  hotCanvas(null);
}
/** Which symbols the active scene currently shows: placed cells plus lane chips. */
function placedIds() {
  const S = scenes[variant], out = new Set();
  for (const el of S.cells) if (!el.classList.contains("hidden") && el.dataset.sel && !el.dataset.sel.startsWith("file:")) out.add(el.dataset.sel);
  for (const c of S.chips) out.add(c.id);
  return out;
}
function refreshIdents() {
  if (!openSym) return;
  const on = placedIds();
  for (const el of diffEl.querySelectorAll(".id")) el.classList.toggle("here", on.has(el.dataset.sym));
}
/** Light the canvas from the code, and the code from the canvas. */
function hotCanvas(ids) {
  for (const key in scenes) {
    const S = scenes[key];
    for (const el of [...S.cells, ...S.chips.map(c => c.el)]) el.classList.toggle("hot", !!ids && ids.has(el.dataset.sel));
  }
}
function hotCode(id) {
  for (const el of diffEl.querySelectorAll(".id")) el.classList.toggle("hot", !!id && el.dataset.sym === id);
}
diffEl.addEventListener("click", e => {
  const x = e.target.closest("[data-exp]");
  if (x) { const [a, b] = x.dataset.exp.split(",").map(Number); expanded.push([a, b]); renderDiff(); return; }
  const id = e.target.closest(".id");
  if (!id) return;
  const sid = id.dataset.sym;
  if (sid === openSym) return;
  if (!placedIds().has(sid)) discloseOne(sid, "out", sym.get(openSym).file);
  select(sid, false);
});
diffEl.addEventListener("mouseover", e => {
  const id = e.target.closest(".id");
  hotCanvas(id ? new Set([id.dataset.sym]) : null);
});
diffEl.addEventListener("mouseleave", () => hotCanvas(null));
codePane.addEventListener("click", e => { if (e.target.closest("[data-close]")) { selected = null; select(null); } });

/* ---- tabs and the resizable side ---- */
let railW = 340, codeW = 620;
function setTab(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  for (const pane of document.querySelectorAll(".pane")) pane.classList.toggle("on", pane.dataset.pane === name);
  document.body.style.setProperty("--side-w", (name === "code" ? codeW : railW) + "px");
  for (const k in scenes) scenes[k].fitted = false;
  requestAnimationFrame(() => show(variant, false));
}
document.querySelector(".tabs").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b && !b.disabled) setTab(b.dataset.tab);
});
const grip = document.querySelector(".grip");
grip.addEventListener("pointerdown", e => {
  e.preventDefault();
  const code = document.querySelector('.tabs [data-tab="code"]').classList.contains("on");
  const start = e.clientX, from = code ? codeW : railW;
  document.body.classList.add("resizing");
  grip.setPointerCapture(e.pointerId);
  const move = ev => {
    const w = Math.max(code ? 380 : 260, Math.min(code ? 1000 : 520, from + (start - ev.clientX)));
    if (code) codeW = w; else railW = w;
    document.body.style.setProperty("--side-w", w + "px");
  };
  const up = () => {
    grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up);
    document.body.classList.remove("resizing");
    for (const k in scenes) scenes[k].fitted = false;
    show(variant, false);
  };
  grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
});

/* ---- disclosure toggle ---- */
const toggle = document.getElementById("disclose-toggle");
function setDisclosed(on) {
  disclosed = on; toggle.checked = on;
  for (const key in scenes) { scenes[key].laneG.textContent = ""; scenes[key].chips = []; }
  laneNote(); refreshIdents();
  for (const key in scenes) { scenes[key].root.classList.add("swapping"); place(key, on ? "full" : "focus"); }
  setTimeout(() => { for (const key in scenes) scenes[key].root.classList.remove("swapping"); }, 360);
  for (const k in scenes) scenes[k].fitted = false;
  show(variant, false);
}
toggle.addEventListener("change", () => setDisclosed(toggle.checked));

/* ---- variant switching ---- */
function show(key, push) {
  variant = key;
  for (const k in scenes) scenes[k].root.classList.toggle("on", k === key);
  const meta = VS.find(v => v.key === key);
  document.querySelector(".switcher .k").innerHTML = "<b>" + key + "</b> &#183; " + meta.name;
  document.querySelector(".switcher .n").textContent = meta.note;
  if (!scenes[key].fitted) { scenes[key].fitted = true; fit(key, 0.42); } else paint(key);
  if (push) { const u = new URL(location.href); u.searchParams.set("variant", key); history.replaceState(null, "", u); }
}
document.querySelector(".switcher .prev").addEventListener("click", () => step(-1));
document.querySelector(".switcher .next").addEventListener("click", () => step(1));
function step(d) { const i = NAV.findIndex(v => v.key === variant); show(NAV[(i < 0 ? 0 : i + d + NAV.length) % NAV.length].key, true); }
addEventListener("keydown", e => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "ArrowRight") step(1);
  else if (e.key === "Escape") { select(null); closeCode(); }
  else if (e.key === "f") setDisclosed(!disclosed);
  else if (e.key === "d") setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
});
document.querySelector(".zoom .in").addEventListener("click", () => zoomBy(1.25));
document.querySelector(".zoom .out").addEventListener("click", () => zoomBy(0.8));
document.querySelector(".zoom .fit").addEventListener("click", () => fit(variant));

for (const key in scenes) place(key, "focus");
inspect();
laneNote();
const q = new URL(location.href).searchParams;
if (q.get("disclosed") === "1") { disclosed = true; toggle.checked = true; for (const key in scenes) place(key, "full"); }
if (q.get("theme")) setTheme(q.get("theme"));
const want = q.get("variant");
show(VS.some(v => v.key === want) ? want : "E1", false);
addEventListener("resize", () => { for (const k in scenes) scenes[k].fitted = false; show(variant, false); });
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PR ${graph.pr.number} seams &#183; ${esc(graph.pr.title)}</title>
<style>${css}</style>
</head>
<body>
<header class="masthead">
  <div>
    <div class="top">
      <span class="pr">PR #${graph.pr.number}</span>
      <h1>${esc(graph.pr.title)}</h1>
      <span class="sha">${esc(graph.pr.headSha.slice(0, 10))}</span>
    </div>
    <p class="verdict">${seamSentence()}</p>
  </div>
  <div class="side">
    <div class="theme"><button data-t="light">Light</button><button data-t="system">System</button><button data-t="dark">Dark</button></div>
    <div class="tally">
      <span><b>${counts.modules}</b> module${counts.modules === 1 ? "" : "s"}</span>
      <span><b>${counts.touchedFiles}</b> files</span>
      <span><b>${counts.touchedSymbols}</b> symbols</span>
      <span><b>${counts.touchedTests}</b> test cases</span>
      <span class="add"><b>${counts.added}</b> added</span>
      <span><b>${counts.modified}</b> modified</span>
      <span class="long"><b>${counts.long}</b> long</span>
      <span><b>${counts.neighbors}</b> neighbors in ${counts.neighborFiles} files</span>
    </div>
  </div>
</header>

<div class="stagewrap">
  <svg id="stage" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.75" fill="var(--hair)"/></pattern>
      <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0.8L7 4L0 7.2Z" fill="context-stroke" stroke="none"/></marker>
    </defs>
    ${variants.map(sceneSvg).join("\n    ")}
  </svg>
  <div class="zoom"><button class="in" title="Zoom in">+</button><button class="out" title="Zoom out">&#8722;</button><button class="fit" title="Fit">fit</button></div>
  <div class="proto">prototype round 3 &#183; issue #6</div>
</div>

<aside class="side">
  <div class="grip" title="Drag to resize"></div>
  <div class="tabs">
    <button data-tab="review" class="on">Review</button>
    <button data-tab="code" disabled>Code<span class="where"></span></button>
  </div>
  <div class="pane rail on" data-pane="review">
  <div>
    <h2>Legend</h2>
    <div class="legend">
      <div><span class="sw a"></span>Added</div>
      <div><span class="sw m"></span>Modified</div>
      <div><span class="sw dl"></span>Deleted</div>
      <div><span class="sw rn"></span>Renamed</div>
      <div><span class="sw s"></span>Signature changed</div>
      <div><span class="sw lo"></span>Long symbol, over ${LONG_SYMBOL_LINES} lines</div>
      <div><span class="sw pr"></span>Production file</div>
      <div><span class="sw te"></span>Test file or test case</div>
      <div><span class="sw n"></span>Neighbor, hidden by default</div>
      <div><span class="sw po"></span>Port: hidden neighbors, tests marked t</div>
      <div><span class="sw line"></span>Call across a module seam</div>
      <div><span class="sw line thin"></span>Call between files, same module</div>
      <div><span class="sw line dash"></span>Call inside one file</div>
      <div><span class="sw line tst"></span>Call from or into test code</div>
    </div>
  </div>
  <div>
    <h2>Neighbors</h2>
    <p class="hint" style="margin:0 0 9px">Hover a port to list what hides behind it. Click the port to place those neighbors in the lane beside the drawing, or click one entry to place just that symbol.</p>
    <div id="lane-state"></div>
    <label class="toggle"><input type="checkbox" id="disclose-toggle"><span>Show every neighbor at once</span></label>
    <p class="hint">Reflows into the full layout and clears the lane. Press <b>f</b>.</p>
  </div>
  <div class="inspector" id="inspector"></div>
  <div>
    <h2>Controls</h2>
    <p class="hint" style="margin:0">Drag to pan, scroll to zoom, arrow keys change variant, <b>d</b> toggles dark mode, Esc clears.</p>
  </div>
  </div>
  <div class="pane code" data-pane="code">
    <div class="head"></div>
    <pre class="diff"></pre>
    <div class="foot"></div>
  </div>
</aside>

<div class="tip"></div>
<div class="pop"></div>

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
console.error(`wrote ${outPath} (${html.length} bytes) - ${variants.length} variants, ${symbols.length} symbols, ${edges.length} edges`);
for (const v of variants) console.error(`  ${v.key} ${v.name}: focus ${v.focus.w}x${v.focus.h}, full ${v.full.w}x${v.full.h}`);
