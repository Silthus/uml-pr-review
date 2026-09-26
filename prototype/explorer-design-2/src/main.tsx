import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import architectureData from "../data/posthog-architecture.json";

type RawModule = [path: string, label: string, parent: number | null, kind: string, directFiles: number, totalFiles: number];
type RawFile = [path: string, module: number, language: string];
type RawEdge = [fromFile: number, toFile: number, kind: number];

type ArchitecturePayload = {
  repository: string;
  commit: string;
  legend: { edgeKinds: string[] };
  modules: RawModule[];
  files: RawFile[];
  edges: RawEdge[];
};

type ModuleRecord = {
  id: number;
  path: string;
  label: string;
  parent: number | null;
  kind: string;
  directFiles: number;
  totalFiles: number;
  children: number[];
};

type FileRecord = {
  id: number;
  path: string;
  module: number;
  language: string;
};

type ModuleEdge = {
  id: string;
  source: number;
  target: number;
  weight: number;
  kinds: Map<number, number>;
  samples: Evidence[];
  plan?: PlanSeam;
};

type Evidence = {
  fromFile: string;
  toFile: string;
  line: number;
  kind: string;
};

type ViewMode = "overview" | "products" | "connections" | "plan" | "live";
type Theme = "light" | "dark";
type SelectionKind = "neutral" | "selected" | "incoming" | "outgoing" | "plan" | "neighbor" | "dim" | "hidden";

type PackageNodeData = {
  module: ModuleRecord;
  pathLabel: string;
  stereotype: string;
  countLabel: string;
  childrenLabel: string;
  selection: SelectionKind;
  isExpanded: boolean;
  planRole?: "modify" | "create" | "interface" | "neighbor";
  conformance?: "conforming" | "pending" | "violating";
  commentCount?: number;
  moreCount?: number;
  isContainer?: boolean;
  onSelectPath: (path: string) => void;
  onToggleExpand: (path: string) => void;
};

type DependencyEdgeData = {
  weight: number;
  relation: SelectionKind;
  samples: Evidence[];
  sourcePath: string;
  targetPath: string;
  plan?: PlanSeam;
};

type PlanSeam = {
  id: string;
  sourcePath: string;
  targetPath: string;
  interfacePath: string;
  status: "conforming" | "pending" | "violating";
  action: "add" | "keep" | "remove";
  label: string;
};

type GraphBuild = {
  nodes: Node<PackageNodeData>[];
  edges: Edge<DependencyEdgeData>[];
  stats: { aggregateMs: number; layoutMs: number; visibleModules: number; visibleEdges: number; rawEdges: number };
  visibleIds: Set<number>;
  aggregatedEdges: ModuleEdge[];
};

const TOP_N_PRODUCTS = 18;
const TOP_N_WIDE = 12;
const SAMPLE_LIMIT = 6;
const ERROR_TRACKING = "products/error_tracking";
const ERROR_TRACKING_BACKEND = "products/error_tracking/backend";
const ERROR_TRACKING_LOGIC = "products/error_tracking/backend/logic";
const ERROR_TRACKING_FACADE = "products/error_tracking/backend/facade";
const ERROR_TRACKING_FRONTEND = "products/error_tracking/frontend";
const FEATURE_FLAGS = "products/feature_flags";
const FEATURE_FLAGS_BACKEND = "products/feature_flags/backend";
const FEATURE_FLAGS_FACADE = "products/feature_flags/backend/facade";
const FEATURE_FLAGS_MODELS = "products/feature_flags/backend/models";
const FEATURE_FLAGS_API = "products/feature_flags/backend/api";

const planSeams: PlanSeam[] = [
  {
    id: "planned-facade-seam",
    sourcePath: ERROR_TRACKING_LOGIC,
    targetPath: FEATURE_FLAGS_FACADE,
    interfacePath: `${FEATURE_FLAGS_API}/feature_flag_usage.py`,
    status: "conforming",
    action: "add",
    label: "use feature flag facade API",
  },
  {
    id: "violating-model-bypass",
    sourcePath: ERROR_TRACKING_FACADE,
    targetPath: FEATURE_FLAGS_MODELS,
    interfacePath: "bypasses facade; should route through facade/api.py",
    status: "violating",
    action: "add",
    label: "violating direct model dependency",
  },
];

const planModuleRoles = new Map<string, PackageNodeData["planRole"]>([
  [ERROR_TRACKING_FACADE, "modify"],
  [ERROR_TRACKING_FRONTEND, "modify"],
  [ERROR_TRACKING_LOGIC, "modify"],
  [FEATURE_FLAGS_FACADE, "interface"],
  [FEATURE_FLAGS_API, "interface"],
  [FEATURE_FLAGS_MODELS, "neighbor"],
]);

const conformanceByPath = new Map<string, PackageNodeData["conformance"]>([
  [ERROR_TRACKING_FACADE, "pending"],
  [ERROR_TRACKING_FRONTEND, "pending"],
  [ERROR_TRACKING_LOGIC, "conforming"],
  [FEATURE_FLAGS_FACADE, "conforming"],
  [FEATURE_FLAGS_MODELS, "violating"],
]);

const kindOrder = new Map<string, number>([
  ["product", 0],
  ["layer", 1],
  ["django-app", 2],
  ["package", 3],
  ["python-package", 4],
  ["scene", 5],
  ["tests", 98],
  ["migrations", 99],
]);

function buildModel(data: ArchitecturePayload) {
  const modules: ModuleRecord[] = data.modules.map((m, id) => ({
    id,
    path: m[0],
    label: m[1],
    parent: m[2],
    kind: m[3],
    directFiles: m[4],
    totalFiles: m[5],
    children: [],
  }));
  for (const module of modules) {
    if (module.parent !== null) modules[module.parent]?.children.push(module.id);
  }
  for (const module of modules) {
    module.children.sort((a, b) => sortModules(modules[a]!, modules[b]!));
  }
  const files = data.files.map((f, id) => ({ id, path: f[0], module: f[1], language: f[2] }));
  const byPath = new Map(modules.map((m) => [m.path, m]));
  return { modules, files, byPath, rawEdges: data.edges, edgeKinds: data.legend.edgeKinds };
}

function sortModules(a: ModuleRecord, b: ModuleRecord) {
  const ak = kindOrder.get(a.kind) ?? 50;
  const bk = kindOrder.get(b.kind) ?? 50;
  if (ak !== bk) return ak - bk;
  return b.totalFiles - a.totalFiles || a.path.localeCompare(b.path);
}

function isTestPath(module: ModuleRecord) {
  return module.kind === "tests" || /(^|\/)(test|tests|__tests__)(\/|$)/.test(module.path);
}

function packageColor(kind: string) {
  if (kind === "product") return "var(--pkg-product)";
  if (kind === "layer") return "var(--pkg-layer)";
  if (kind === "django-app") return "var(--pkg-django)";
  if (kind === "tests") return "var(--pkg-tests)";
  if (kind === "migrations" || kind === "generated") return "var(--pkg-generated)";
  if (kind.includes("package")) return "var(--pkg-package)";
  return "var(--pkg-directory)";
}

function stereo(kind: string) {
  if (kind === "python-package") return "«package»";
  if (kind === "django-app") return "«django-app»";
  return `«${kind}»`;
}

function compactNumber(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(value);
}

function parentPath(path: string) {
  const i = path.lastIndexOf("/");
  return i < 0 ? "." : path.slice(0, i);
}

function childPathChain(path: string) {
  if (path === ".") return ["."];
  const parts = path.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function topVisibleChildren(model: ReturnType<typeof buildModel>, parentPathValue: string, limit: number, includeTests: boolean) {
  const parent = model.byPath.get(parentPathValue);
  if (!parent) return [];
  return parent.children
    .map((id) => model.modules[id]!)
    .filter((m) => includeTests || !isTestPath(m))
    .slice(0, limit);
}

function selectVisibleModules(
  model: ReturnType<typeof buildModel>,
  mode: ViewMode,
  selectedPath: string,
  expanded: Set<string>,
  includeTests: boolean,
) {
  const visible = new Set<number>();
  const addPath = (path: string) => {
    const m = model.byPath.get(path);
    if (m && (includeTests || !isTestPath(m))) visible.add(m.id);
  };
  const addAncestors = (path: string) => childPathChain(path).forEach(addPath);
  const addChildren = (path: string, limit: number) => topVisibleChildren(model, path, limit, includeTests).forEach((m) => visible.add(m.id));

  if (mode === "overview") {
    addChildren(".", 16);
    if (expanded.has("products")) addChildren("products", 8);
    return visible;
  }

  if (mode === "products") {
    addPath(".");
    addPath("products");
    addChildren("products", TOP_N_PRODUCTS);
    addAncestors(ERROR_TRACKING_BACKEND);
    addChildren(ERROR_TRACKING, 8);
    addChildren(ERROR_TRACKING_BACKEND, 12);
    return visible;
  }

  if (mode === "connections") {
    addAncestors(selectedPath);
    addChildren(parentPath(selectedPath), TOP_N_WIDE);
    addChildren(selectedPath, TOP_N_WIDE);
    for (const path of [ERROR_TRACKING, ERROR_TRACKING_BACKEND, ERROR_TRACKING_FRONTEND, FEATURE_FLAGS, FEATURE_FLAGS_BACKEND, "frontend", "posthog"]) addPath(path);
    return visible;
  }

  for (const seam of planSeams) {
    addAncestors(seam.sourcePath);
    addAncestors(seam.targetPath);
    addChildren(parentPath(seam.sourcePath), TOP_N_WIDE);
    addChildren(parentPath(seam.targetPath), TOP_N_WIDE);
  }
  for (const path of [ERROR_TRACKING, ERROR_TRACKING_BACKEND, ERROR_TRACKING_FRONTEND, FEATURE_FLAGS, FEATURE_FLAGS_BACKEND]) addPath(path);
  if (mode === "live") addPath(FEATURE_FLAGS_API);
  return visible;
}

function visibleAncestor(model: ReturnType<typeof buildModel>, moduleId: number, visible: Set<number>) {
  let current: number | null = moduleId;
  while (current !== null) {
    if (visible.has(current)) return current;
    current = model.modules[current]?.parent ?? null;
  }
  return 0;
}

function aggregateEdges(model: ReturnType<typeof buildModel>, visible: Set<number>, includeTests: boolean) {
  const started = performance.now();
  const map = new Map<string, ModuleEdge>();
  for (const edge of model.rawEdges) {
    const fromFile = model.files[edge[0]];
    const toFile = model.files[edge[1]];
    if (!fromFile || !toFile) continue;
    const fromModule = model.modules[fromFile.module];
    const toModule = model.modules[toFile.module];
    if (!fromModule || !toModule) continue;
    if (!includeTests && (isTestPath(fromModule) || isTestPath(toModule))) continue;
    const source = visibleAncestor(model, fromFile.module, visible);
    const target = visibleAncestor(model, toFile.module, visible);
    if (source === target) continue;
    const id = `${source}->${target}`;
    let bundle = map.get(id);
    if (!bundle) {
      bundle = { id, source, target, weight: 0, kinds: new Map(), samples: [] };
      map.set(id, bundle);
    }
    bundle.weight += 1;
    bundle.kinds.set(edge[2], (bundle.kinds.get(edge[2]) ?? 0) + 1);
    if (bundle.samples.length < SAMPLE_LIMIT) {
      bundle.samples.push({
        fromFile: fromFile.path,
        toFile: toFile.path,
        line: deterministicLine(fromFile.path, toFile.path),
        kind: model.edgeKinds[edge[2]] ?? "static",
      });
    }
  }
  const result = [...map.values()].sort((a, b) => b.weight - a.weight);
  return { edges: result, ms: performance.now() - started };
}

function deterministicLine(a: string, b: string) {
  let h = 17;
  for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) % 997;
  for (let i = 0; i < b.length; i++) h = (h * 17 + b.charCodeAt(i)) % 997;
  return (h % 240) + 1;
}

function createManualPlanEdges(model: ReturnType<typeof buildModel>, visible: Set<number>) {
  return planSeams.flatMap((seam) => {
    const source = model.byPath.get(seam.sourcePath);
    const target = model.byPath.get(seam.targetPath);
    if (!source || !target) return [];
    return [{
      id: seam.id,
      source: visibleAncestor(model, source.id, visible),
      target: visibleAncestor(model, target.id, visible),
      weight: seam.status === "violating" ? 7 : 19,
      kinds: new Map([[0, 1]]),
      samples: [{
        fromFile: `${seam.sourcePath}/usage.py`,
        toFile: `${seam.targetPath}/${seam.status === "violating" ? "models.py" : "api.py"}`,
        line: seam.status === "violating" ? 44 : 27,
        kind: "planned",
      }],
      plan: seam,
    } satisfies ModuleEdge];
  });
}

function relationForNode(module: ModuleRecord, selected: ModuleRecord | undefined, aggregates: ModuleEdge[], mode: ViewMode): SelectionKind {
  const role = planModuleRoles.get(module.path);
  if (mode === "plan" || mode === "live") {
    if (role) return "plan";
    if ([ERROR_TRACKING, ERROR_TRACKING_BACKEND, FEATURE_FLAGS, FEATURE_FLAGS_BACKEND, "products"].includes(module.path)) return "neighbor";
    return "dim";
  }
  if (!selected) return "neutral";
  if (module.id === selected.id) return "selected";
  const incoming = aggregates.some((e) => e.target === selected.id && e.source === module.id);
  const outgoing = aggregates.some((e) => e.source === selected.id && e.target === module.id);
  if (incoming) return "incoming";
  if (outgoing) return "outgoing";
  return mode === "connections" ? "dim" : "neutral";
}

function pathLabel(module: ModuleRecord) {
  if (module.path === ".") return "posthog";
  if (module.path.length <= 36) return module.path;
  const parts = module.path.split("/");
  if (parts.length <= 3) return module.path;
  return `${parts[0]}/${parts[1]}/…/${parts.at(-1)}`;
}

function countHiddenChildren(model: ReturnType<typeof buildModel>, module: ModuleRecord, visible: Set<number>, includeTests: boolean) {
  return module.children.filter((id) => !visible.has(id) && (includeTests || !isTestPath(model.modules[id]!))).length;
}


function updateNode(node: Node<PackageNodeData>, x: number, y: number, width = 230, height = 128, zIndex = 10): Node<PackageNodeData> {
  return { ...node, position: { x, y }, width, height, zIndex, style: { ...node.style, width, height } };
}

function manualOverviewLayout(nodes: Node<PackageNodeData>[]) {
  const started = performance.now();
  const ordered = [...nodes].sort((a, b) => {
    const ap = a.data.module.path;
    const bp = b.data.module.path;
    if (ap === ".") return -1;
    if (bp === ".") return 1;
    if (ap === "products") return -1;
    if (bp === "products") return 1;
    return b.data.module.totalFiles - a.data.module.totalFiles;
  });
  const laid = ordered.map((node, index) => {
    if (node.data.module.path === ".") return updateNode(node, -360, 240, 280, 150, 1);
    const i = node.data.module.path === "products" ? 0 : Math.max(1, index);
    const col = i % 4;
    const row = Math.floor(i / 4);
    const w = node.data.module.path === "products" ? 300 : 270;
    return updateNode(node, 70 + col * 250, 42 + row * 158, w, 134, 10);
  });
  return { nodes: laid, layoutMs: performance.now() - started };
}

function manualProductsLayout(nodes: Node<PackageNodeData>[]) {
  const started = performance.now();
  const byPath = new Map(nodes.map((node) => [node.data.module.path, node]));
  const used = new Set<string>();
  const laid: Node<PackageNodeData>[] = [];
  const place = (path: string, x: number, y: number, w: number, h: number, z = 10) => {
    const node = byPath.get(path);
    if (node) { used.add(path); laid.push(updateNode(node, x, y, w, h, z)); }
  };
  place(".", 20, 20, 260, 120, 1);
  place("products", 320, 20, 980, 710, 1);
  place(ERROR_TRACKING, 360, 110, 440, 545, 2);
  place(ERROR_TRACKING_BACKEND, 392, 270, 380, 330, 3);
  place(ERROR_TRACKING_FRONTEND, 410, 164, 160, 96, 8);
  place("products/error_tracking/dags", 586, 164, 150, 96, 8);
  const backendChildren = [
    ERROR_TRACKING_FACADE,
    "products/error_tracking/backend/hogql_queries",
    ERROR_TRACKING_LOGIC,
    "products/error_tracking/backend/presentation",
    "products/error_tracking/backend/temporal",
    "products/error_tracking/backend/tasks",
  ];
  backendChildren.forEach((path, i) => place(path, 416 + (i % 2) * 170, 338 + Math.floor(i / 2) * 96, 154, 82, 9));
  const products = nodes.filter((node) => node.data.module.parent === 1734 && !used.has(node.data.module.path)).slice(0, 12);
  products.forEach((node, i) => {
    used.add(node.data.module.path);
    laid.push(updateNode(node, 830 + (i % 2) * 220, 110 + Math.floor(i / 2) * 96, 198, 82, 8));
  });
  for (const node of nodes) if (!used.has(node.data.module.path)) laid.push(updateNode(node, 52 + laid.length * 6, 620 + laid.length * 4, 190, 80, 6));
  return { nodes: laid, layoutMs: performance.now() - started };
}

function manualConnectionLayout(nodes: Node<PackageNodeData>[]) {
  const started = performance.now();
  const selected = nodes.find((node) => node.data.selection === "selected") ?? nodes.find((node) => node.data.module.path === ERROR_TRACKING_BACKEND);
  const incoming = nodes.filter((node) => node.data.selection === "incoming");
  const outgoing = nodes.filter((node) => node.data.selection === "outgoing");
  const neutral = nodes.filter((node) => node !== selected && node.data.selection !== "incoming" && node.data.selection !== "outgoing");
  const laid: Node<PackageNodeData>[] = [];
  incoming.slice(0, 6).forEach((node, i) => laid.push(updateNode(node, 58, 108 + i * 76, 248, 70, 10)));
  if (selected) laid.push(updateNode(selected, 390, 284, 320, 176, 20));
  outgoing.slice(0, 6).forEach((node, i) => laid.push(updateNode(node, 790, 108 + i * 76, 248, 70, 10)));
  neutral.slice(0, 4).forEach((node, i) => laid.push(updateNode(node, 398 + i * 78, 68, 154, 58, 5)));
  return { nodes: laid, layoutMs: performance.now() - started };
}

function manualPlanLayout(nodes: Node<PackageNodeData>[], mode: ViewMode) {
  const started = performance.now();
  const byPath = new Map(nodes.map((node) => [node.data.module.path, node]));
  const used = new Set<string>();
  const laid: Node<PackageNodeData>[] = [];
  const place = (path: string, x: number, y: number, w: number, h: number, z = 10) => {
    const node = byPath.get(path);
    if (node) { used.add(path); laid.push(updateNode(node, x, y, w, h, z)); }
  };
  place("products", 35, 30, 960, 660, 1);
  place(ERROR_TRACKING, 75, 110, 410, 500, 2);
  place(FEATURE_FLAGS, 535, 110, 400, 500, 2);
  place(ERROR_TRACKING_BACKEND, 102, 260, 355, 280, 3);
  place(ERROR_TRACKING_FRONTEND, 110, 165, 240, 82, 8);
  place(FEATURE_FLAGS_BACKEND, 562, 248, 345, 288, 3);
  place(ERROR_TRACKING_FACADE, 128, 340, 148, 80, 10);
  place(ERROR_TRACKING_LOGIC, 292, 340, 140, 80, 10);
  place("products/error_tracking/backend/presentation", 128, 438, 148, 72, 9);
  place(FEATURE_FLAGS_FACADE, 588, 320, 148, 82, 10);
  place(FEATURE_FLAGS_API, 750, 320, 132, 82, mode === "live" ? 12 : 8);
  place(FEATURE_FLAGS_MODELS, 666, 430, 148, 82, 10);
  for (const node of nodes) if (!used.has(node.data.module.path)) laid.push(updateNode(node, 70 + (laid.length % 4) * 210, 625 + Math.floor(laid.length / 4) * 72, 178, 62, 5));
  return { nodes: laid, layoutMs: performance.now() - started };
}

async function layoutNodes(nodes: Node<PackageNodeData>[], edges: Edge<DependencyEdgeData>[], mode: ViewMode) {
  if (mode === "overview") return manualOverviewLayout(nodes);
  if (mode === "products") return manualProductsLayout(nodes);
  if (mode === "connections") return manualConnectionLayout(nodes);
  if (mode === "plan" || mode === "live") return manualPlanLayout(nodes, mode);
  const started = performance.now();
  const elk = new ELK();
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "44",
      "elk.layered.spacing.nodeNodeBetweenLayers": "92",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: nodes.map((n) => ({ id: n.id, width: n.width ?? 250, height: n.height ?? 128 })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const laidOut = await elk.layout(graph);
  const positions = new Map((laidOut.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]));
  return {
    nodes: nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
    layoutMs: performance.now() - started,
  };
}

function buildGraphSync(
  model: ReturnType<typeof buildModel>,
  mode: ViewMode,
  selectedPath: string,
  expanded: Set<string>,
  includeTests: boolean,
  onSelectPath: (path: string) => void,
  onToggleExpand: (path: string) => void,
): Omit<GraphBuild, "nodes"> & { nodes: Node<PackageNodeData>[] } {
  const visibleIds = selectVisibleModules(model, mode, selectedPath, expanded, includeTests);
  const { edges: aggregatedEdges, ms: aggregateMs } = aggregateEdges(model, visibleIds, includeTests);
  const selected = model.byPath.get(selectedPath);
  const selectedVisible = selected ? visibleAncestor(model, selected.id, visibleIds) : undefined;
  const relationEdges = selectedVisible === undefined ? aggregatedEdges : aggregatedEdges.filter((e) => e.source === selectedVisible || e.target === selectedVisible);
  const primaryEdges = mode === "connections" ? relationEdges : aggregatedEdges.slice(0, mode === "overview" ? 24 : 70);
  const planEdges = mode === "plan" || mode === "live" ? createManualPlanEdges(model, visibleIds) : [];
  const allModuleEdges = [...primaryEdges, ...planEdges];
  const nodes = [...visibleIds].map((id): Node<PackageNodeData> => {
    const module = model.modules[id]!;
    const relation = relationForNode(module, selectedVisible === undefined ? undefined : model.modules[selectedVisible], relationEdges, mode);
    const hidden = countHiddenChildren(model, module, visibleIds, includeTests);
    const childNames = module.children
      .map((childId) => model.modules[childId]!)
      .filter((child) => includeTests || !isTestPath(child))
      .slice(0, 4)
      .map((child) => child.label)
      .join(" · ");
    const width = module.path === "." ? 290 : module.kind === "product" ? 250 : 230;
    const height = Math.max(112, module.kind === "product" ? 128 : 116);
    return {
      id: String(id),
      type: "package",
      position: { x: 0, y: 0 },
      width,
      height,
      data: {
        module,
        pathLabel: pathLabel(module),
        stereotype: stereo(module.kind),
        countLabel: `${compactNumber(module.totalFiles)} files`,
        childrenLabel: childNames || "leaf package",
        selection: relation,
        isExpanded: expanded.has(module.path),
        planRole: planModuleRoles.get(module.path),
        conformance: conformanceByPath.get(module.path),
        commentCount: mode === "live" && module.path === FEATURE_FLAGS_MODELS ? 1 : undefined,
        moreCount: hidden || undefined,
        isContainer: module.children.some((childId) => visibleIds.has(childId)),
        onSelectPath,
        onToggleExpand,
      },
      style: { width, height },
    };
  });
  const edges: Edge<DependencyEdgeData>[] = allModuleEdges.map((edge): Edge<DependencyEdgeData> => {
    const relation: SelectionKind = edge.plan ? "plan" : selectedVisible === edge.source ? "outgoing" : selectedVisible === edge.target ? "incoming" : mode === "connections" ? "dim" : "neutral";
    const source = model.modules[edge.source]!;
    const target = model.modules[edge.target]!;
    return {
      id: edge.plan ? edge.id : edge.id,
      source: String(edge.source),
      target: String(edge.target),
      type: "dependency",
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      data: { weight: edge.weight, relation, samples: edge.samples, sourcePath: source.path, targetPath: target.path, plan: edge.plan },
      zIndex: edge.plan || relation === "incoming" || relation === "outgoing" ? 30 : 1,
    };
  });
  return {
    nodes,
    edges,
    aggregatedEdges,
    visibleIds,
    stats: { aggregateMs, layoutMs: 0, visibleModules: visibleIds.size, visibleEdges: edges.length, rawEdges: model.rawEdges.length },
  };
}

function PackageNode({ data }: NodeProps<Node<PackageNodeData>>) {
  const color = packageColor(data.module.kind);
  return (
    <div className={`package-node ${data.selection} ${data.planRole ? "has-plan" : ""} ${data.conformance ?? ""}`} onDoubleClick={() => data.onToggleExpand(data.module.path)}>
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="package-tab" style={{ borderColor: color }}>
        <span>{data.module.label}</span>
      </div>
      <button className="package-body" onClick={() => data.onSelectPath(data.module.path)} style={{ borderColor: color }}>
        <span className="kind-rail" style={{ background: color }} />
        <span className="package-stereo">{data.stereotype}</span>
        <span className="package-title">{data.pathLabel}</span>
        <span className="package-meta">{data.countLabel} · {data.module.children.length} child modules</span>
        <span className="package-children">{data.childrenLabel}</span>
        <span className="package-badges">
          {data.planRole ? <span className="badge plan">{data.planRole}</span> : null}
          {data.conformance ? <span className={`badge ${data.conformance}`}>{data.conformance}</span> : null}
          {data.moreCount ? <span className="badge more">+{data.moreCount} more</span> : null}
          {data.commentCount ? <span className="badge comment">{data.commentCount} comment</span> : null}
        </span>
      </button>
      <button className="expand-button" onClick={() => data.onToggleExpand(data.module.path)} aria-label={`Toggle ${data.module.path}`}>
        {data.isExpanded ? "collapse" : "expand"}
      </button>
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
}

function DependencyEdge(props: EdgeProps<Edge<DependencyEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath(props);
  const data = props.data;
  const weight = data?.weight ?? 1;
  const relation = data?.relation ?? "neutral";
  const plan = data?.plan;
  const strokeWidth = plan ? (plan.status === "violating" ? 4 : 3.2) : Math.min(5, 1.2 + Math.log10(weight + 1) * 1.8);
  const label = plan ? plan.label : compactNumber(weight);
  return (
    <>
      <path id={props.id} className={`dependency-edge ${relation} ${plan ? `plan ${plan.status}` : ""}`} d={edgePath} markerEnd={props.markerEnd} style={{ strokeWidth }} />
      <EdgeLabelRenderer>
        <div className={`edge-label ${relation} ${plan ? `plan ${plan.status}` : ""}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          <span>{label}</span>
          {plan ? <small>{plan.interfacePath}</small> : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function Inspector({ model, selectedPath, graph, mode, includeTests, setSelectedPath }: {
  model: ReturnType<typeof buildModel>;
  selectedPath: string;
  graph: GraphBuild | null;
  mode: ViewMode;
  includeTests: boolean;
  setSelectedPath: (path: string) => void;
}) {
  const selected = model.byPath.get(selectedPath) ?? model.byPath.get(ERROR_TRACKING_BACKEND)!;
  const selectedVisible = graph ? visibleAncestor(model, selected.id, graph.visibleIds) : selected.id;
  const incoming = (graph?.aggregatedEdges ?? []).filter((e) => e.target === selectedVisible).slice(0, 8);
  const outgoing = (graph?.aggregatedEdges ?? []).filter((e) => e.source === selectedVisible).slice(0, 8);
  return (
    <aside className="inspector-panel">
      <section className="summary-card">
        <div className="eyebrow">Selected UML package</div>
        <h2>{selected.path === "." ? "posthog" : selected.path}</h2>
        <div className="meta-grid">
          <span>{stereo(selected.kind)}</span>
          <span>{compactNumber(selected.totalFiles)} files</span>
          <span>{selected.children.length} children</span>
          <span>{includeTests ? "tests visible" : "tests hidden"}</span>
        </div>
        <p>Incoming dependencies are blue. Outgoing dependencies are green. Collapsed far ends are lifted to the deepest visible ancestor while preserving file-level evidence below.</p>
      </section>
      <section className="lens-card">
        <h3>Depends on</h3>
        <DependencyList edges={outgoing} model={model} direction="out" setSelectedPath={setSelectedPath} />
      </section>
      <section className="lens-card">
        <h3>Depended on by</h3>
        <DependencyList edges={incoming} model={model} direction="in" setSelectedPath={setSelectedPath} />
      </section>
      <section className="lens-card plan-card">
        <h3>Plan overlay</h3>
        <PlanSummary mode={mode} setSelectedPath={setSelectedPath} />
      </section>
    </aside>
  );
}

function DependencyList({ edges, model, direction, setSelectedPath }: { edges: ModuleEdge[]; model: ReturnType<typeof buildModel>; direction: "in" | "out"; setSelectedPath: (path: string) => void }) {
  if (!edges.length) return <p className="empty">No visible dependencies in this disclosure state.</p>;
  return (
    <div className="dependency-list">
      {edges.map((edge) => {
        const other = model.modules[direction === "out" ? edge.target : edge.source]!;
        return (
          <details key={edge.id} open={edge.weight > 1000}>
            <summary>
              <button onClick={(event) => { event.preventDefault(); setSelectedPath(other.path); }}>{other.path}</button>
              <strong>{compactNumber(edge.weight)}</strong>
            </summary>
            <div className="evidence-list">
              {edge.samples.map((sample, index) => (
                <button key={`${edge.id}-${index}`} onClick={() => setSelectedPath(other.path)}>
                  <span>{sample.fromFile}:{sample.line}</span>
                  <small>{sample.kind} → {sample.toFile}</small>
                </button>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function PlanSummary({ mode, setSelectedPath }: { mode: ViewMode; setSelectedPath: (path: string) => void }) {
  return (
    <div className="plan-summary">
      <p>Scenario: show feature flag usage on error tracking issues.</p>
      <div className="plan-row"><span className="dot pending" />Modify error tracking facade and frontend.</div>
      <button onClick={() => setSelectedPath(ERROR_TRACKING_FACADE)}>Open {ERROR_TRACKING_FACADE}</button>
      <div className="plan-row"><span className="dot conforming" />Add seam through feature flag facade API.</div>
      <button onClick={() => setSelectedPath(FEATURE_FLAGS_FACADE)}>Open {FEATURE_FLAGS_FACADE}</button>
      <div className="plan-row"><span className="dot violating" />Violation: direct dependency on feature flag models.</div>
      <button onClick={() => setSelectedPath(FEATURE_FLAGS_MODELS)}>Open {FEATURE_FLAGS_MODELS}</button>
      {mode === "live" ? <p className="human-comment">Human comment on seam: “keep model access behind facade; agent should rewrite this before lock.”</p> : null}
    </div>
  );
}

const nodeTypes = { package: PackageNode };
const edgeTypes = { dependency: DependencyEdge };

function ExplorerApp() {
  const [data, setData] = useState<ArchitecturePayload | null>(null);
  const [mode, setMode] = useState<ViewMode>((new URLSearchParams(location.search).get("state") as ViewMode) || "overview");
  const [theme, setTheme] = useState<Theme>((new URLSearchParams(location.search).get("theme") as Theme) || "light");
  const [selectedPath, setSelectedPath] = useState(ERROR_TRACKING_BACKEND);
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [includeTests, setIncludeTests] = useState(false);
  const [followAgent, setFollowAgent] = useState(false);
  const [graph, setGraph] = useState<GraphBuild | null>(null);
  const [activity, setActivity] = useState<string[]>([
    "mcp.index_snapshot read PostHog tree f637db96",
    "agent_activity inspected products/error_tracking/backend",
  ]);
  const flow = useReactFlow();

  useEffect(() => {
    setData(architectureData as unknown as ArchitecturePayload);
  }, []);

  const model = useMemo(() => data ? buildModel(data) : null, [data]);

  const onSelectPath = useCallback((path: string) => setSelectedPath(path), []);
  const onToggleExpand = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    const base = buildGraphSync(model, mode, selectedPath, expanded, includeTests, onSelectPath, onToggleExpand);
    layoutNodes(base.nodes, base.edges, mode).then((layout) => {
      if (cancelled) return;
      setGraph({ ...base, nodes: layout.nodes, stats: { ...base.stats, layoutMs: layout.layoutMs } });
      requestAnimationFrame(() => flow.fitView({ padding: 0.18, duration: 240 }));
    });
    return () => { cancelled = true; };
  }, [model, mode, selectedPath, expanded, includeTests, onSelectPath, onToggleExpand, flow]);

  useEffect(() => {
    if (mode !== "live") return;
    const steps = [
      { text: "plan_patch add seam error_tracking.logic → feature_flags.facade", path: ERROR_TRACKING_LOGIC },
      { text: "selection_hint follow agent to products/feature_flags/backend/facade", path: FEATURE_FLAGS_FACADE },
      { text: "human_comment attached to violating model seam", path: FEATURE_FLAGS_MODELS },
      { text: "human_created plan element: require facade/api.py evidence", path: FEATURE_FLAGS_API },
    ];
    let index = 0;
    const timer = setInterval(() => {
      const step = steps[index % steps.length]!;
      setActivity((rows) => [step.text, ...rows].slice(0, 8));
      if (followAgent) setSelectedPath(step.path);
      index += 1;
    }, 1800);
    return () => clearInterval(timer);
  }, [mode, followAgent]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!model) return;
      const current = model.byPath.get(selectedPath);
      if (!current) return;
      if (event.key === "Enter") onToggleExpand(current.path);
      if (event.key === "Backspace") {
        event.preventDefault();
        const parent = current.parent === null ? current : model.modules[current.parent];
        if (parent) setSelectedPath(parent.path);
      }
      if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const siblings = current.parent === null ? [current.id] : (model.modules[current.parent]?.children ?? []);
        const index = siblings.indexOf(current.id);
        const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
        const nextId = siblings[(index + delta + siblings.length) % siblings.length];
        if (nextId !== undefined) setSelectedPath(model.modules[nextId]!.path);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [model, selectedPath, onToggleExpand]);

  const modes: { id: ViewMode; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "products", label: "Nested products" },
    { id: "connections", label: "Connection lens" },
    { id: "plan", label: "Plan overlay" },
    { id: "live", label: "Live collaboration" },
  ];

  if (!data || !model || !graph) return <div className="loading">Loading PostHog architecture index…</div>;

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Throwaway prototype · real PostHog index · UML package diagram</div>
          <h1>Architecture explorer round 2</h1>
          <p>{data.modules.length.toLocaleString()} modules · {data.files.length.toLocaleString()} files · {data.edges.length.toLocaleString()} file import edges · commit {data.commit.slice(0, 8)}</p>
        </div>
        <div className="top-actions">
          <label><input type="checkbox" checked={includeTests} onChange={(e) => setIncludeTests(e.target.checked)} /> Show tests</label>
          <label><input type="checkbox" checked={followAgent} onChange={(e) => setFollowAgent(e.target.checked)} /> Follow agent</label>
          <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "Dark" : "Light"}</button>
        </div>
      </header>
      <main className="main-grid">
        <section className="canvas-card">
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
            minZoom={0.16}
            maxZoom={1.6}
            onNodeClick={(_, node) => setSelectedPath((node.data as PackageNodeData).module.path)}
          >
            <Background gap={22} size={1.3} color="var(--dot)" />
            <MiniMap pannable zoomable nodeColor={(node) => packageColor((node.data as PackageNodeData).module.kind)} maskColor="var(--minimap-mask)" />
            <Controls position="bottom-left" fitViewOptions={{ padding: 0.18 }} />
            <Panel position="top-left" className="mode-panel">
              {modes.map((item) => <button key={item.id} className={mode === item.id ? "on" : ""} onClick={() => setMode(item.id)}>{item.label}</button>)}
            </Panel>
            <Panel position="top-right" className="stats-panel">
              aggregate {graph.stats.aggregateMs.toFixed(2)}ms · layout {graph.stats.layoutMs.toFixed(1)}ms · {graph.stats.visibleModules} packages · {graph.stats.visibleEdges} edges
            </Panel>
            {mode === "live" ? <Panel position="bottom-right" className="activity-panel">{activity.map((row, index) => <div key={`${row}-${index}`} className={index === 0 ? "latest" : ""}>{row}</div>)}</Panel> : null}
          </ReactFlow>
        </section>
        <Inspector model={model} selectedPath={selectedPath} graph={graph} mode={mode} includeTests={includeTests} setSelectedPath={setSelectedPath} />
      </main>
    </div>
  );
}

function Root() {
  return <ReactFlowProvider><ExplorerApp /></ReactFlowProvider>;
}

createRoot(document.getElementById("root")!).render(<Root />);
