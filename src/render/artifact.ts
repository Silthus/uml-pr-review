import type { ChangeState, RenderFile, RenderModel, RenderModule, RenderSymbol } from "./model.ts";
import type ElkConstructor from "elkjs/lib/elk.bundled.js";
import CLIENT_SCRIPT from "./artifact-client.js" with { type: "text" };
import CSS from "./artifact.css" with { type: "text" };

type Elk = InstanceType<typeof ElkConstructor>;
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
type Scene = { key: string; name: string; note: string; cells: Cell[]; groups: Group[]; edges: EdgeRef[]; full: State; focus: State };
type Port = { fileId: string; dir: "in" | "out"; ids: string[] };
type XY = { x: number; y: number };
type ElkNode = { id: string; width?: number; height?: number; x?: number; y?: number; children?: ElkNode[]; edges?: ElkEdge[]; layoutOptions?: Record<string, string> };
type ElkEdge = { id: string; sources: string[]; targets: string[]; container?: string; sections?: { startPoint: XY; endPoint: XY; bendPoints?: XY[] }[] };
type RenderContext = ReturnType<typeof createContext>;

const LONG_SYMBOL_LINES = 60;
const ROOT_MODULE: RenderModule = { id: "(root)", name: "workspace root", root: "" };
const ROW = 26;
const FILE_HEAD = 40;
const MOD_HEAD = 34;
const TFRAME_HEAD = 28;
const PORT_H = 18;

let elkConstructor: typeof ElkConstructor | null = null;

export async function renderArtifact(model: RenderModel): Promise<string> {
  const context = createContext(model);
  const elk = await loadElk();
  const scene = buildScene(context);
  scene.focus = await layoutScene(elk, context, scene, "focus");
  scene.full = await layoutScene(elk, context, scene, "full");
  return htmlDocument(context, scene);
}

async function loadElk(): Promise<Elk> {
  if (!elkConstructor) {
    delete (globalThis as { self?: unknown }).self;
    elkConstructor = (await import("elkjs/lib/elk.bundled.js")).default;
  }
  return new elkConstructor();
}

function createContext(model: RenderModel) {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const files = [...model.files].sort((a, b) => cmp(a.id, b.id));
  const symbols = [...model.symbols].sort((a, b) => cmp(a.id, b.id));
  const edges = [...model.edges].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
  const modules = [...model.modules].sort((a, b) => cmp(a.id, b.id));
  const fileById = new Map(files.map((f) => [f.id, f]));
  const symById = new Map(symbols.map((s) => [s.id, s]));
  const modById = new Map(modules.map((m) => [m.id, m]));
  const validSymbols = symbols.filter((s) => fileById.has(s.fileId));
  const validSymById = new Map(validSymbols.map((s) => [s.id, s]));
  const validEdges = edges.filter((e) => validSymById.has(e.from) && validSymById.has(e.to));
  const moduleOfFile = (file: RenderFile) => (file.moduleId ? (modById.get(file.moduleId) ?? ROOT_MODULE) : ROOT_MODULE);
  const moduleOfSym = (symbol: RenderSymbol) => moduleOfFile(fileById.get(symbol.fileId) ?? fallbackFile(symbol.fileId));
  const touchedFiles = files.filter((f) => f.touched);
  const symbolsInFile = (fileId: string) => validSymbols.filter((s) => s.fileId === fileId).sort((a, b) => a.line.start - b.line.start || cmp(a.name, b.name));
  const isTest = (symbol: RenderSymbol) => symbol.kind === "test" || symbol.kind === "hook";
  const isContainer = (symbol: RenderSymbol) => symbol.kind === "class" || symbol.kind === "object" || symbol.kind === "describe";
  const isLong = (symbol: RenderSymbol) => symbol.touched && !isTest(symbol) && symbol.lineCount > LONG_SYMBOL_LINES;
  const changeOf = (symbol: RenderSymbol): ChangeState => symbol.change ?? (symbol.touched ? fileById.get(symbol.fileId)?.status ?? "unchanged" : "unchanged");
  const modulesInGraph = [...new Set(files.map((f) => moduleOfFile(f).id))]
    .map((id) => (id === ROOT_MODULE.id ? ROOT_MODULE : modById.get(id) ?? ROOT_MODULE))
    .sort((a, b) => {
      const ta = files.some((f) => f.touched && moduleOfFile(f).id === a.id);
      const tb = files.some((f) => f.touched && moduleOfFile(f).id === b.id);
      return Number(tb) - Number(ta) || cmp(a.id, b.id);
    });
  const filesInModule = (moduleId: string) => files.filter((f) => moduleOfFile(f).id === moduleId).sort((a, b) => Number(b.touched) - Number(a.touched) || Number(a.role === "test") - Number(b.role === "test") || cmp(a.path, b.path));
  const callersOf = new Map(validSymbols.map((s) => [s.id, [] as string[]]));
  const calleesOf = new Map(validSymbols.map((s) => [s.id, [] as string[]]));
  for (const edge of validEdges) {
    callersOf.get(edge.to)?.push(edge.from);
    calleesOf.get(edge.from)?.push(edge.to);
  }
  for (const ids of [...callersOf.values(), ...calleesOf.values()]) ids.sort(cmp);
  return { model, cmp, files, symbols: validSymbols, edges: validEdges, modules, fileById, symById: validSymById, modById, moduleOfFile, moduleOfSym, touchedFiles, symbolsInFile, isTest, isContainer, isLong, changeOf, modulesInGraph, filesInModule, callersOf, calleesOf };
}

function fallbackFile(id: string): RenderFile {
  return { id, path: id, touched: false, status: "untouched", moduleId: null, role: "production", library: false, changedLines: [], deleteAnchors: [], removedLines: [] };
}

function buildScene(context: RenderContext): Scene {
  const cells: Cell[] = [];
  const groups: Group[] = [];
  const edgeRefs: EdgeRef[] = [];
  const prefix = "E1";
  for (const module of context.modulesInGraph) {
    groups.push(moduleGroup(context, prefix, module));
    if (context.filesInModule(module.id).some((f) => f.role === "test")) groups.push(testFrameGroup(context, prefix, module));
    for (const file of context.filesInModule(module.id)) {
      groups.push(fileGroup(context, prefix, file));
      const symbols = context.symbolsInFile(file.id);
      for (const symbol of topLevelSymbols(context, symbols).filter((s) => !context.isTest(s))) cells.push(symCell(context, prefix, symbol));
      for (const symbol of topLevelSymbols(context, symbols).filter((s) => context.isTest(s))) cells.push(symCell(context, prefix, symbol));
      const tests = symbols.filter(context.isTest);
      if (tests.length) cells.push(testGroupCell(prefix, file, tests));
      if (file.touched) for (const port of portsFor(context, file.id)) cells.push(portCell(context, prefix, port));
    }
  }
  for (const edge of context.edges) {
    const from = context.symById.get(edge.from);
    const to = context.symById.get(edge.to);
    if (!from || !to) continue;
    edgeRefs.push({ eid: `${prefix}-e-${edge.from}->${edge.to}`, from: edge.from, to: edge.to, pairs: [[edge.from, edge.to]], cls: edgeClass(context, from, to), un: !from.touched || !to.touched });
  }
  const grouped = new Map<string, EdgeRef>();
  for (const edge of context.edges) {
    const from = context.symById.get(edge.from);
    const to = context.symById.get(edge.to);
    if (!from || !to || !context.isTest(from)) continue;
    const key = `${prefix}-eg-${from.fileId}->${edge.to}`;
    const group = grouped.get(key);
    if (group) group.pairs.push([edge.from, edge.to]);
    else grouped.set(key, { eid: key, from: `tests:${from.fileId}`, to: edge.to, pairs: [[edge.from, edge.to]], cls: `${edgeClass(context, from, to)} edge-bundle`, un: !to.touched });
  }
  edgeRefs.push(...grouped.values());
  return { key: prefix, name: "Blueprint, tests framed", note: "test files in their own frame inside the module", cells, groups, edges: edgeRefs, full: emptyState(), focus: emptyState() };
}

function topLevelSymbols(context: RenderContext, symbols: RenderSymbol[]) {
  const ids = new Set(symbols.map((s) => s.id));
  return symbols.filter((s) => !s.parentId || !ids.has(s.parentId) || !context.isContainer(context.symById.get(s.parentId) ?? s));
}

function emptyState(): State {
  return { cells: {}, groups: {}, edges: {}, labels: {}, w: 0, h: 0 };
}

function portsFor(context: RenderContext, fileId: string): Port[] {
  const mine = new Set(context.symbolsInFile(fileId).filter((s) => s.touched).map((s) => s.id));
  const ins = new Set<string>();
  const outs = new Set<string>();
  for (const edge of context.edges) {
    const from = context.symById.get(edge.from);
    const to = context.symById.get(edge.to);
    if (!from || !to) continue;
    if (mine.has(edge.to) && !from.touched) ins.add(edge.from);
    if (mine.has(edge.from) && !to.touched) outs.add(edge.to);
  }
  const out: Port[] = [];
  if (ins.size) out.push({ fileId, dir: "in", ids: [...ins].sort(context.cmp) });
  if (outs.size) out.push({ fileId, dir: "out", ids: [...outs].sort(context.cmp) });
  return out;
}

function portLabel(context: RenderContext, port: Port) {
  const prod = port.ids.filter((id) => context.fileById.get(context.symById.get(id)?.fileId ?? "")?.role === "production").length;
  const test = port.ids.length - prod;
  const bits: string[] = [];
  if (prod) bits.push(`${prod}`);
  if (test) bits.push(`${test}t`);
  return bits.join("+");
}

function symClass(context: RenderContext, symbol: RenderSymbol) {
  const file = context.fileById.get(symbol.fileId) ?? fallbackFile(symbol.fileId);
  const out = ["cell", "sym", `k-${symbol.kind}`, `st-${context.changeOf(symbol)}`, ...(file.role === "test" ? ["is-test", "tdim"] : ["is-prod"]), symbol.touched ? "is-touched" : "is-neighbor"];
  if (symbol.signatureTouched) out.push("is-sig");
  if (context.isLong(symbol)) out.push("is-long");
  if (file.status === "deleted") out.push("is-gone");
  return out.join(" ");
}

function linesLabel(context: RenderContext, symbol: RenderSymbol) {
  return context.isLong(symbol) ? `! ${symbol.lineCount} L` : `${symbol.lineCount} L`;
}

function symCellSize(context: RenderContext, symbol: RenderSymbol) {
  const name = context.isTest(symbol) ? truncate(symbol.name, 44) : symbol.name;
  const w = 24 + monoW(name, 11.5) + 14 + monoW(linesLabel(context, symbol), 9) + (context.isLong(symbol) ? 24 : 12);
  return { w: Math.max(150, Math.round(w)), h: ROW };
}

function symCell(context: RenderContext, prefix: string, symbol: RenderSymbol): Cell {
  const { w, h } = symCellSize(context, symbol);
  const name = context.isTest(symbol) ? truncate(symbol.name, 44) : symbol.name;
  return {
    cid: `${prefix}-${symbol.id}`,
    sel: symbol.id,
    w,
    h,
    un: !symbol.touched,
    cls: symClass(context, symbol),
    body:
      `<rect class="box" x="0" y="0" width="${w}" height="${h}" rx="2"/>` +
      `<rect class="mark" x="0" y="0" width="3" height="${h}"/>` +
      `<rect class="sig" x="0" y="0" width="${w}" height="2.5"/>` +
      `<text class="c-kind" x="9" y="${h / 2 + 3.5}">${kindTag(symbol)}</text>` +
      `<text class="c-name" x="24" y="${h / 2 + 3.5}">${esc(name)}</text>` +
      (context.isLong(symbol) ? `<rect class="lbadge" x="${w - 14 - monoW(linesLabel(context, symbol), 9) - 6}" y="${h / 2 - 8}" width="${Math.round(monoW(linesLabel(context, symbol), 9) + 12)}" height="16" rx="8"/>` : "") +
      `<text class="c-lines" x="${w - (context.isLong(symbol) ? 14 : 8)}" y="${h / 2 + 3.5}" text-anchor="end">${linesLabel(context, symbol)}</text>`,
  };
}

function testGroupCell(prefix: string, file: RenderFile, tests: RenderSymbol[]): Cell {
  const touched = tests.filter((t) => t.touched).length;
  const label = `${tests.length} test case${tests.length === 1 ? "" : "s"}`;
  const sub = touched === tests.length ? "all changed" : touched === 0 ? "unchanged" : `${touched} changed`;
  const w = Math.max(190, Math.round(24 + monoW(label, 11.5) + 14 + monoW(sub, 9) + 12));
  return {
    cid: `${prefix}-tests-${file.id}`,
    sel: `file:${file.id}`,
    w,
    h: ROW,
    cls: `cell sym tests is-test tdim st-${file.touched ? file.status : "unchanged"} ${touched ? "is-touched" : "is-neighbor"}`,
    body:
      `<rect class="box" x="0" y="0" width="${w}" height="${ROW}" rx="2"/>` +
      `<rect class="mark" x="0" y="0" width="3" height="${ROW}"/>` +
      `<text class="c-kind" x="9" y="${ROW / 2 + 3.5}">t</text>` +
      `<text class="c-name" x="24" y="${ROW / 2 + 3.5}">${label}</text>` +
      `<text class="c-lines" x="${w - 8}" y="${ROW / 2 + 3.5}" text-anchor="end">${sub}</text>`,
  };
}

function fileGroup(context: RenderContext, prefix: string, file: RenderFile): Group {
  const all = context.symbolsInFile(file.id);
  const touched = all.filter((s) => s.touched);
  const meta = file.touched
    ? touched.length === 0
      ? `${file.status}, ${file.changedLines.length} lines outside any symbol`
      : `${file.status}, ${touched.length} of ${all.length} symbols`
    : `${all.length} symbol${all.length === 1 ? "" : "s"} reached`;
  return {
    gid: `${prefix}-file-${file.id}`,
    sel: `file:${file.id}`,
    un: !file.touched,
    cls: `group file st-${file.touched ? file.status : "unchanged"} ${file.role === "test" ? "is-test tdim" : "is-prod"} ${file.touched ? "is-touched" : "is-neighbor"}`,
    body:
      `<rect class="box" x="0" y="0" width="10" height="10" rx="3"/>` +
      `<rect class="band" x="0" y="0" width="10" height="${FILE_HEAD}" data-span="width"/>` +
      `<rect class="mark" x="0" y="0" width="3" height="10" data-span2="height"/>` +
      `<text class="g-name" x="13" y="17">${esc(baseOf(file.path))}</text>` +
      `<text class="g-meta" x="13" y="31">${esc(meta)}</text>` +
      `<text class="g-role" x="10" y="17" text-anchor="end" data-spanx="width" data-dx="-10">${file.role}</text>`,
  };
}

function testFrameGroup(context: RenderContext, prefix: string, module: RenderModule): Group {
  const tests = context.filesInModule(module.id).filter((f) => f.role === "test");
  const touched = tests.filter((f) => f.touched).length;
  return {
    gid: `${prefix}-tframe-${module.id}`,
    un: touched === 0,
    cls: `group tframe ${touched ? "is-touched" : "is-neighbor"}`,
    body:
      `<rect class="box" x="0" y="0" width="10" height="10" rx="4"/>` +
      `<text class="t-name" x="12" y="18">tests</text>` +
      `<text class="t-meta" x="10" y="18" text-anchor="end" data-spanx="width" data-dx="-12">${tests.length} file${tests.length === 1 ? "" : "s"}${touched ? `, ${touched} changed` : ""}</text>`,
  };
}

function moduleGroup(context: RenderContext, prefix: string, module: RenderModule): Group {
  const inGraph = context.filesInModule(module.id);
  const touched = inGraph.filter((f) => f.touched).length;
  return {
    gid: `${prefix}-mod-${module.id}`,
    un: touched === 0,
    cls: `group module ${touched ? "is-touched" : "is-neighbor"}`,
    body:
      `<rect class="box" x="0" y="0" width="10" height="10" rx="5"/>` +
      `<text class="m-name" x="16" y="22">${esc(module.name)}</text>` +
      `<text class="m-meta" x="10" y="22" text-anchor="end" data-spanx="width" data-dx="-16">${esc(module.root || "workspace root")}</text>`,
  };
}

function portCell(context: RenderContext, prefix: string, port: Port): Cell {
  const w = portW(context, port);
  const arrow = port.dir === "out" ? "&#8594;" : "&#8592;";
  return {
    cid: `${prefix}-port-${port.dir}-${port.fileId}`,
    port: `${port.dir}:${port.fileId}`,
    w,
    h: PORT_H,
    cls: `cell port port-${port.dir}`,
    body:
      `<rect class="box" x="0" y="0" width="${w}" height="${PORT_H}" rx="9"/>` +
      (port.dir === "out"
        ? `<text class="p-text" x="8" y="13">${portLabel(context, port)} <tspan class="p-arrow">${arrow}</tspan></text>`
        : `<text class="p-text" x="8" y="13"><tspan class="p-arrow">${arrow}</tspan> ${portLabel(context, port)}</text>`),
  };
}

function edgeClass(context: RenderContext, from: RenderSymbol, to: RenderSymbol) {
  const cls = ["edge"];
  const cross = context.moduleOfSym(from).id !== context.moduleOfSym(to).id;
  const test = context.fileById.get(from.fileId)?.role === "test" || context.fileById.get(to.fileId)?.role === "test";
  cls.push(cross ? "edge-seam" : from.fileId === to.fileId ? "edge-local" : "edge-file");
  cls.push(test ? "edge-test" : "edge-prod");
  return cls.join(" ");
}

async function layoutScene(elk: Elk, context: RenderContext, scene: Scene, mode: "focus" | "full"): Promise<State> {
  const cellById = new Map(scene.cells.map((c) => [c.cid, c]));
  const focus = mode === "focus";
  const showFile = (file: RenderFile) => (focus ? file.touched : true);
  const showSym = (symbol: RenderSymbol) => (focus ? symbol.touched : true);
  const elkChildren: ElkNode[] = [];
  const nodeIds = new Set<string>();
  for (const module of context.modulesInGraph) {
    const fileNodes: ElkNode[] = [];
    for (const file of context.filesInModule(module.id)) {
      if (!showFile(file)) continue;
      const kids: ElkNode[] = [];
      const all = context.symbolsInFile(file.id);
      for (const symbol of topLevelSymbols(context, all).filter((s) => !context.isTest(s) && showSym(s))) {
        const cell = cellById.get(`E1-${symbol.id}`);
        if (!cell) continue;
        kids.push({ id: symbol.id, width: cell.w, height: cell.h });
        nodeIds.add(symbol.id);
      }
      const tests = all.filter(context.isTest);
      if (tests.length) {
        if (focus) {
          const cell = cellById.get(`E1-tests-${file.id}`);
          if (cell) {
            kids.push({ id: `tests:${file.id}`, width: cell.w, height: cell.h });
            nodeIds.add(`tests:${file.id}`);
          }
        } else {
          for (const test of topLevelSymbols(context, tests).filter(showSym)) {
            const cell = cellById.get(`E1-${test.id}`);
            if (!cell) continue;
            kids.push({ id: test.id, width: cell.w, height: cell.h });
            nodeIds.add(test.id);
          }
        }
      }
      const fileNode: ElkNode = { id: `file:${file.id}`, layoutOptions: { "elk.padding": `[top=${FILE_HEAD + 10},left=13,bottom=13,right=13]`, "elk.spacing.nodeNode": "8" } };
      if (kids.length) fileNode.children = kids;
      else {
        fileNode.width = Math.max(220, Math.round(monoW(baseOf(file.path), 12) + 120));
        fileNode.height = FILE_HEAD + 14;
      }
      nodeIds.add(`file:${file.id}`);
      fileNodes.push(fileNode);
    }
    if (fileNodes.length === 0) continue;
    const testIds = new Set(context.filesInModule(module.id).filter((f) => f.role === "test").map((f) => `file:${f.id}`));
    const tests = fileNodes.filter((n) => testIds.has(n.id));
    const prod = fileNodes.filter((n) => !testIds.has(n.id));
    const children = tests.length ? [...prod, { id: `tframe:${module.id}`, layoutOptions: { "elk.padding": `[top=${TFRAME_HEAD + 10},left=12,bottom=12,right=12]`, "elk.spacing.nodeNode": "20", "elk.layered.spacing.nodeNodeBetweenLayers": "40" }, children: tests }] : prod;
    if (tests.length) nodeIds.add(`tframe:${module.id}`);
    elkChildren.push({
      id: `mod:${module.id}`,
      layoutOptions: {
        "elk.padding": `[top=${MOD_HEAD + 14},left=16,bottom=16,right=16]`,
        "elk.spacing.nodeNode": "24",
        "elk.layered.spacing.nodeNodeBetweenLayers": "44",
      },
      children,
    });
  }
  const drawn = scene.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
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
    edges: drawn.map((edge, index) => ({ id: `e${index}`, sources: [edge.from], targets: [edge.to] })),
  };
  const flat = flattenElk(await elk.layout(structuredClone(root) as never) as unknown as ElkNode);
  const state = emptyState();
  for (const cell of scene.cells) {
    if (cell.port) continue;
    const key = cell.cid.startsWith("E1-tests-") ? `tests:${cell.cid.slice("E1-tests-".length)}` : cell.sel;
    if (!key) continue;
    const box = flat.box.get(key);
    if (box && nodeIds.has(key)) state.cells[cell.cid] = [box[0], box[1]];
  }
  for (const group of scene.groups) {
    const key = group.gid.startsWith("E1-file-") ? `file:${group.gid.slice("E1-file-".length)}` : group.gid.startsWith("E1-tframe-") ? `tframe:${group.gid.slice("E1-tframe-".length)}` : `mod:${group.gid.slice("E1-mod-".length)}`;
    const box = flat.box.get(key);
    if (box) state.groups[group.gid] = box;
  }
  drawn.forEach((edge, index) => {
    const points = flat.routes.get(`e${index}`);
    if (points && points.length > 1) {
      state.edges[edge.eid] = orthoPath(points);
      if (edge.pairs.length > 1) {
        const mid = midOf(points);
        state.labels[edge.eid] = [r2(mid.x), r2(mid.y)];
      }
    }
  });
  if (focus) {
    for (const cell of scene.cells) {
      if (!cell.port) continue;
      const [dir, fileId] = cell.port.split(":") as ["in" | "out", string];
      const box = flat.box.get(`file:${fileId}`);
      if (!box) continue;
      const y = box[1] + box[3] - PORT_H - 6;
      state.cells[cell.cid] = dir === "out" ? [r2(box[0] + box[2] - cell.w / 2), r2(y)] : [r2(box[0] - cell.w / 2), r2(y)];
    }
  }
  state.w = flat.w;
  state.h = flat.h;
  return state;
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
    for (const edge of node.edges ?? []) {
      const origin = abs.get(edge.container ?? node.id) ?? { x: 0, y: 0 };
      const points: XY[] = [];
      for (const section of edge.sections ?? []) {
        points.push({ x: section.startPoint.x + origin.x, y: section.startPoint.y + origin.y });
        for (const bend of section.bendPoints ?? []) points.push({ x: bend.x + origin.x, y: bend.y + origin.y });
        points.push({ x: section.endPoint.x + origin.x, y: section.endPoint.y + origin.y });
      }
      routes.set(edge.id, points);
    }
    for (const child of node.children ?? []) collect(child);
  };
  collect(res);
  return { box, routes, w: r2(res.width ?? 0), h: r2(res.height ?? 0) };
}

function orthoPath(points: XY[], radius = 6) {
  const pathPoints = points.filter((point, index) => index === 0 || Math.abs(point.x - points[index - 1]!.x) > 0.01 || Math.abs(point.y - points[index - 1]!.y) > 0.01);
  if (pathPoints.length === 0) return "";
  const first = pathPoints[0];
  if (!first) return "";
  if (pathPoints.length < 3) return `M${r2(first.x)} ${r2(first.y)}` + pathPoints.slice(1).map((point) => `L${r2(point.x)} ${r2(point.y)}`).join("");
  let out = `M${r2(first.x)} ${r2(first.y)}`;
  for (let index = 1; index < pathPoints.length - 1; index++) {
    const a = pathPoints[index - 1]!;
    const b = pathPoints[index]!;
    const c = pathPoints[index + 1]!;
    const lenIn = Math.hypot(b.x - a.x, b.y - a.y);
    const lenOut = Math.hypot(c.x - b.x, c.y - b.y);
    const rIn = Math.min(radius, lenIn / 2);
    const rOut = Math.min(radius, lenOut / 2);
    const inX = b.x - ((b.x - a.x) / (lenIn || 1)) * rIn;
    const inY = b.y - ((b.y - a.y) / (lenIn || 1)) * rIn;
    const outX = b.x + ((c.x - b.x) / (lenOut || 1)) * rOut;
    const outY = b.y + ((c.y - b.y) / (lenOut || 1)) * rOut;
    out += `L${r2(inX)} ${r2(inY)}Q${r2(b.x)} ${r2(b.y)} ${r2(outX)} ${r2(outY)}`;
  }
  const last = pathPoints[pathPoints.length - 1]!;
  return `${out}L${r2(last.x)} ${r2(last.y)}`;
}

function midOf(points: XY[]): XY {
  if (points.length === 0) return { x: 0, y: 0 };
  const total = points.slice(1).reduce((length, point, index) => length + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0);
  let walk = 0;
  for (let index = 1; index < points.length; index++) {
    const current = points[index]!;
    const previous = points[index - 1]!;
    const segment = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (walk + segment >= total / 2) {
      const t = segment === 0 ? 0 : (total / 2 - walk) / segment;
      return { x: previous.x + (current.x - previous.x) * t, y: previous.y + (current.y - previous.y) * t };
    }
    walk += segment;
  }
  return points[points.length - 1]!;
}

function htmlDocument(context: RenderContext, scene: Scene) {
  const graphData = buildGraphData(context);
  const layoutData = { E1: { full: scene.full, focus: scene.focus } };
  const counts = buildCounts(context);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PR ${context.model.pr.number} seams &#183; ${esc(context.model.pr.title)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="masthead">
  <div>
    <div class="top"><div class="pr">PR ${context.model.pr.number}</div><h1>${esc(context.model.pr.title)}</h1><div class="sha">${esc(context.model.pr.headSha.slice(0, 12))}</div></div>
    <div class="verdict">${seamSentence(context)}</div>
  </div>
  <div class="side">
    <div class="tally"><span><b>${counts.touchedFiles}</b> files</span><span><b>${counts.touchedSymbols}</b> symbols</span><span><b>${counts.touchedTests}</b> tests</span><span><b>${counts.neighbors}</b> neighbors</span><span class="long"><b>${counts.long}</b> long</span></div>
    <div class="theme" aria-label="theme"><button data-t="light">light</button><button data-t="system">system</button><button data-t="dark">dark</button></div>
  </div>
</header>

<div class="stagewrap">
  <svg id="stage" role="img" aria-label="Pull request architecture diagram">
    <defs>
      <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--hair)"/></pattern>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>
    </defs>
    ${sceneSvg(scene)}
  </svg>
  <div class="zoom"><button class="in">+</button><button class="out">-</button><button class="fit">fit</button></div>
  <div class="proto">drag to pan &#183; wheel to zoom &#183; click a symbol for its calls and diff</div>
</div>

<aside class="side">
  <div class="grip"></div>
  <div class="tabs"><button class="on" data-tab="review">Review rail</button><button data-tab="code" disabled>Diff <span class="where"></span></button></div>
  <div class="pane rail on" data-pane="review">
    <section><h2>Legend</h2><div class="legend">
      <div><span class="sw a"></span>added symbol or file</div><div><span class="sw m"></span>modified symbol or file</div><div><span class="sw dl"></span>deleted symbol or file</div><div><span class="sw s"></span>signature touched</div><div><span class="sw n"></span>unchanged reached neighbor</div><div><span class="sw te"></span>test code</div><div><span class="sw pr"></span>production code</div><div><span class="sw lo"></span>long touched symbol</div><div><span class="sw po"></span>hidden neighbor port</div><div><span class="sw line"></span>cross-module production call</div><div><span class="sw line tst"></span>test call</div><div><span class="sw line dash"></span>local call</div>
    </div></section>
    <section><h2>Disclosure</h2><label class="toggle"><input id="disclose-toggle" type="checkbox">show all reached neighbors</label><p class="hint">Focus mode keeps untouched neighbors behind ports. Click a port for a list, or flip this on to place every reached neighbor in the diagram.</p><div id="lane-state"></div></section>
    <section class="inspector" id="inspector"></section>
    ${warningsHtml(context.model.warnings)}
  </div>
  <div class="pane code" data-pane="code">
    <div class="head"><div class="t"><b></b><button class="close">close</button></div><div class="path"></div><div class="stat"></div></div>
    <pre class="diff"></pre>
    <div class="foot"><span class="key">identifier</span> hover links code to canvas. Click an identifier to select its symbol.</div>
  </div>
</aside>

<div class="tip"></div>
<div class="pop"></div>


${island("graph-data", graphData)}
${island("layout-data", layoutData)}
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}

function buildGraphData(context: RenderContext) {
  return {
    pr: context.model.pr,
    longThreshold: LONG_SYMBOL_LINES,
    modules: [...context.modulesInGraph].map((m) => ({ id: m.id, name: m.name, root: m.root })),
    files: context.files.map((f) => ({ id: f.id, path: f.path, rel: relPath(context, f), module: context.moduleOfFile(f).id, moduleName: context.moduleOfFile(f).name, touched: f.touched, status: f.status, role: f.role, changed: f.changedLines.length })),
    symbols: context.symbols.map((s) => ({
      id: s.id,
      file: s.fileId,
      name: s.parentId && context.symById.has(s.parentId) ? `${context.symById.get(s.parentId)!.name}.${s.name}` : s.name,
      short: s.name,
      kind: s.kind,
      start: s.line.start,
      end: s.line.end,
      lines: s.lineCount,
      touched: s.touched,
      sig: s.signatureTouched,
      hop: s.hop,
      change: context.changeOf(s),
      long: context.isLong(s),
      changed: s.changedLines,
      diff: s.diff ?? null,
      hand: false,
    })),
    edges: context.edges.map((e) => ({ from: e.from, to: e.to, hand: false })),
    ports: Object.fromEntries(context.touchedFiles.flatMap((f) => portsFor(context, f.id)).map((p) => [`${p.dir}:${p.fileId}`, p.ids])),
  };
}

function sceneSvg(scene: Scene) {
  const groups = scene.groups.map((g) => `<g class="${g.cls}" data-gid="${g.gid}"${g.sel ? ` data-sel="${esc(g.sel)}"` : ""}${g.un ? ` data-un="1"` : ""}>${g.body}</g>`).join("");
  const wires = scene.edges.map((e) => `<g class="wire" data-eid="${esc(e.eid)}"${e.un ? ` data-un="1"` : ""} data-pairs="${esc(JSON.stringify(e.pairs))}"><path class="${e.cls}" marker-end="url(#arrow)"/>${e.pairs.length > 1 ? `<g class="elabel"><rect rx="7" width="${12 + String(e.pairs.length).length * 7}" height="14" x="${-(12 + String(e.pairs.length).length * 7) / 2}" y="-7"/><text y="3.5" text-anchor="middle">${e.pairs.length}</text></g>` : ""}</g>`).join("");
  const cells = scene.cells.map((c) => `<g class="${c.cls}" data-cid="${esc(c.cid)}"${c.sel ? ` data-sel="${esc(c.sel)}"` : ""}${c.port ? ` data-port="${esc(c.port)}"` : ""}${c.un ? ` data-un="1"` : ""}>${c.body}</g>`).join("");
  return `<g class="scene" data-v="E1"><g class="vp"><rect class="grid" x="-6000" y="-6000" width="20000" height="20000"/><g class="layer-groups">${groups}</g><g class="layer-edges">${wires}</g><g class="layer-cells">${cells}</g><g class="layer-lane"></g></g></g>`;
}

function buildCounts(context: RenderContext) {
  const touchedModules = [...new Set(context.touchedFiles.map((f) => context.moduleOfFile(f).id))].sort(context.cmp);
  return {
    touchedFiles: context.touchedFiles.length,
    touchedSymbols: context.symbols.filter((s) => s.touched && !context.isTest(s)).length,
    touchedTests: context.symbols.filter((s) => s.touched && context.isTest(s)).length,
    neighbors: context.symbols.filter((s) => !s.touched).length,
    neighborFiles: context.files.filter((f) => !f.touched).length,
    modules: touchedModules.length,
    long: context.symbols.filter(context.isLong).length,
    added: context.symbols.filter((s) => s.touched && !context.isTest(s) && context.changeOf(s) === "added").length,
    modified: context.symbols.filter((s) => s.touched && !context.isTest(s) && context.changeOf(s) === "modified").length,
  };
}

function seamSentence(context: RenderContext) {
  const touchedFiles = context.touchedFiles;
  const touchedModules = [...new Set(touchedFiles.map((f) => context.moduleOfFile(f).id))].sort(context.cmp);
  const crossings: { from: string; to: string; role: "test" | "production"; edges: number; fromMod: string; toMod: string }[] = [];
  for (const edge of context.edges) {
    const from = context.symById.get(edge.from);
    const to = context.symById.get(edge.to);
    if (!from || !to || (!from.touched && !to.touched)) continue;
    const fromModule = context.moduleOfSym(from);
    const toModule = context.moduleOfSym(to);
    if (fromModule.id === toModule.id) continue;
    const role = context.fileById.get(from.fileId)?.role === "test" || context.fileById.get(to.fileId)?.role === "test" ? "test" : "production";
    const existing = crossings.find((crossing) => crossing.from === from.fileId && crossing.to === to.fileId);
    if (existing) existing.edges++;
    else crossings.push({ from: from.fileId, to: to.fileId, role, edges: 1, fromMod: fromModule.id, toMod: toModule.id });
  }
  const prodCrossings = crossings.filter((c) => c.role === "production");
  const testCrossings = crossings.filter((c) => c.role === "test");
  const prodTouchedModules = [...new Set(touchedFiles.filter((f) => f.role === "production").map((f) => context.moduleOfFile(f).name))].sort(context.cmp);
  const names = (list: string[]) => list.length ? list.map((module) => `<b>${esc(module)}</b>`).join(", ") : "<b>no production modules</b>";
  const count = (amount: number, word: string) => `<b>${amount}</b> ${word}${amount === 1 ? "" : "s"}`;
  const out: string[] = [];
  out.push(prodTouchedModules.length === 1 ? `Production changes stay inside ${names(prodTouchedModules)}.` : `Production changes touch ${count(prodTouchedModules.length, "module")}: ${names(prodTouchedModules)}.`);
  const prodCalls = prodCrossings.reduce((total, crossing) => total + crossing.edges, 0);
  if (prodCalls === 0) out.push("No production call crosses a module seam.");
  else out.push(`${count(prodCalls, "production call")} cross a seam into ${names([...new Set(prodCrossings.map((crossing) => context.modById.get(crossing.toMod)?.name ?? crossing.toMod))].sort(context.cmp))}.`);
  const testFiles = touchedFiles.filter((f) => f.role === "test");
  const testMods = [...new Set(testFiles.map((f) => context.moduleOfFile(f).name))].sort(context.cmp);
  out.push(`${count(testFiles.length, "test file")} changed in ${names(testMods)}.`);
  if (testCrossings.length) {
    const from = [...new Set(testCrossings.map((crossing) => context.modById.get(crossing.fromMod)?.name ?? crossing.fromMod))].sort(context.cmp);
    out.push(`${count(testCrossings.length, "test file")} in ${names(from)} reach${testCrossings.length === 1 ? "es" : ""} the change across a seam.`);
  }
  if (touchedModules.length === 0) out.push("No touched files were provided.");
  return out.join(" ");
}

function warningsHtml(warnings: string[]) {
  if (warnings.length === 0) return "";
  return `<section><h2>Warnings</h2>${warnings.map((warning) => `<p class="hint"><b>warning</b> ${esc(warning)}</p>`).join("")}</section>`;
}

function island(id: string, value: unknown) {
  return `<script type="application/json" id="${id}">${JSON.stringify(value).replaceAll("<", "\u003c")}</script>`;
}

function relPath(context: RenderContext, file: RenderFile) {
  const module = context.moduleOfFile(file);
  return module.root && file.path.startsWith(`${module.root}/`) ? file.path.slice(module.root.length + 1) : file.path;
}

function kindTag(symbol: RenderSymbol) {
  const tags: Record<RenderSymbol["kind"], string> = { function: "f", class: "c", method: "m", object: "o", describe: "d", test: "t", hook: "h" };
  return tags[symbol.kind];
}

function portW(context: RenderContext, port: Port) {
  return Math.round(monoW(portLabel(context, port), 10) + 26);
}

function r2(value: number) {
  return Math.round(value * 100) / 100;
}

function esc(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function monoW(text: string, size: number) {
  return text.length * size * 0.6;
}

function baseOf(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
