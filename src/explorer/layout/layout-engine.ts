import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js" with { type: "file" };
import type { GraphEdge, GraphNode, VisibleGraph } from "../graph/types.ts";
import { packGrid, type Placement } from "./grid.ts";

export type Point = { x: number; y: number };
export type LaidOutNode = { id: string; parentId: string | null; x: number; y: number; width: number; height: number };
export type LaidOutEdge = { id: string; points: Point[]; labelAt: Point | null };
export type LayoutResult = { nodes: LaidOutNode[]; edges: LaidOutEdge[]; milliseconds: number };
export type LayoutEngine = { layout(graph: VisibleGraph): Promise<LayoutResult>; dispose(): void };

const containerPadding = "[top=64,left=20,bottom=20,right=20]";
const edgeLabelHeight = 20;
const layerConstraints = { first: "FIRST", last: "LAST" } as const;
const directions = { map: "DOWN", lens: "RIGHT", plan: "RIGHT" } as const;
const spacing = {
  map: { nodeNode: "20", betweenLayers: "44" },
  lens: { nodeNode: "12", betweenLayers: "64" },
  plan: { nodeNode: "16", betweenLayers: "44" },
} as const;

type ElkSession = { elk: InstanceType<typeof ELK>; failure: Promise<never> };

export function createLayoutEngine(): LayoutEngine {
  let session: ElkSession | null = null;
  return {
    async layout(graph) {
      session ??= startElk();
      const started = performance.now();
      const result = graph.mode === "map" ? await layoutMap(session, graph) : await layoutHierarchy(session, graph);
      return { ...result, milliseconds: performance.now() - started };
    },
    dispose() {
      session?.elk.terminateWorker();
      session = null;
    },
  };
}

export function edgeLabelWidth(label: string): number {
  return label.length * 7 + 14;
}

function startElk(): ElkSession {
  let fail: (error: Error) => void = () => {};
  const failure = new Promise<never>((_, reject) => {
    fail = reject;
  });
  const elk = new ELK({
    workerUrl: elkWorkerUrl,
    workerFactory: (url) => {
      const worker = new Worker(url!);
      worker.addEventListener("error", (event) => fail(new Error(event.message || "the layout worker crashed")));
      worker.addEventListener("messageerror", () => fail(new Error("the layout worker sent an unreadable message")));
      return worker;
    },
  });
  return { elk, failure };
}

async function layoutHierarchy(session: ElkSession, graph: VisibleGraph): Promise<Omit<LayoutResult, "milliseconds">> {
  const laidOut = await Promise.race([session.elk.layout(toElkGraph(graph, elkChildren(graph.nodes, null))), session.failure]);
  return fromElkGraph(laidOut, graph.nodes);
}

async function layoutMap(session: ElkSession, graph: VisibleGraph): Promise<Omit<LayoutResult, "milliseconds">> {
  const placements = new Map<string, Placement>();
  const roots = graph.nodes.filter((node) => node.parentId === null).map((node): ElkNode => ({ id: node.id, ...measure(node, graph.nodes, placements) }));
  const laidOut = await Promise.race([session.elk.layout(toElkGraph(graph, roots)), session.failure]);
  const result = fromElkGraph(laidOut, graph.nodes.filter((node) => node.parentId === null));
  const nested = graph.nodes.filter((node) => node.parentId !== null).map((node): LaidOutNode => ({ id: node.id, parentId: node.parentId, ...placements.get(node.id)! }));
  return { nodes: [...result.nodes, ...nested], edges: result.edges };
}

function measure(node: GraphNode, nodes: GraphNode[], placements: Map<string, Placement>): { width: number; height: number } {
  const children = nodes.filter((candidate) => candidate.parentId === node.id).sort((a, b) => Number(a.type === "more") - Number(b.type === "more"));
  if (children.length === 0) return { width: node.width, height: node.height };
  const packed = packGrid(children.map((child) => ({ id: child.id, ...measure(child, nodes, placements) })), { minWidth: node.width });
  for (const [id, placement] of packed.placements) placements.set(id, placement);
  return { width: packed.width, height: packed.height };
}

function toElkGraph(graph: VisibleGraph, children: ElkNode[]): ElkNode {
  const dense = graph.edges.length > 48;
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": directions[graph.mode],
      "elk.hierarchyHandling": graph.nodes.some((node) => node.parentId !== null) ? "INCLUDE_CHILDREN" : "SEPARATE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.edgeLabels.inline": "true",
      "elk.spacing.nodeNode": spacing[graph.mode].nodeNode,
      "elk.spacing.edgeNode": dense ? "12" : "18",
      "elk.spacing.edgeEdge": dense ? "6" : "10",
      "elk.spacing.edgeLabel": "6",
      "elk.spacing.componentComponent": "36",
      "elk.layered.spacing.nodeNodeBetweenLayers": spacing[graph.mode].betweenLayers,
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.crossingMinimization.thoroughness": "7",
      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
      "elk.aspectRatio": "1.6",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children,
    edges: graph.edges.map(toElkEdge),
  };
}

function elkChildren(nodes: GraphNode[], parentId: string | null): ElkNode[] {
  return nodes.filter((node) => node.parentId === parentId).map((node) => toElkNode(node, nodes));
}

function toElkNode(node: GraphNode, nodes: GraphNode[]): ElkNode {
  const children = elkChildren(nodes, node.id);
  const layer: Record<string, string> = node.layer ? { "elk.layered.layering.layerConstraint": layerConstraints[node.layer] } : {};
  if (children.length === 0) return { id: node.id, width: node.width, height: node.height, layoutOptions: layer };
  return {
    id: node.id,
    children,
    layoutOptions: { ...layer, "elk.padding": containerPadding, "elk.nodeSize.constraints": "MINIMUM_SIZE", "elk.nodeSize.minimum": `(${node.width}, ${node.height})` },
  };
}

function toElkEdge(edge: GraphEdge): ElkExtendedEdge {
  return {
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
    labels: edge.label ? [{ text: edge.label, width: edgeLabelWidth(edge.label), height: edgeLabelHeight }] : [],
  };
}

function fromElkGraph(root: ElkNode, nodes: GraphNode[]): Omit<LayoutResult, "milliseconds"> {
  const laidOut: LaidOutNode[] = [];
  const absolute = new Map<string, Point>([["root", { x: 0, y: 0 }]]);
  collectNodes(root, null, { x: 0, y: 0 });
  const edges = (root.edges ?? []).map((edge): LaidOutEdge => {
    const offset = absolute.get(edge.container ?? "root") ?? { x: 0, y: 0 };
    const label = edge.labels?.[0];
    return {
      id: edge.id,
      points: (edge.sections ?? []).flatMap((section) => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]).map((point) => shift(point, offset)),
      labelAt: label && label.x !== undefined && label.y !== undefined ? shift({ x: label.x + (label.width ?? 0) / 2, y: label.y + (label.height ?? 0) / 2 }, offset) : null,
    };
  });
  return { nodes: nodes.map((node) => laidOut.find((entry) => entry.id === node.id) ?? missing(node)), edges };

  function collectNodes(node: ElkNode, parentId: string | null, parentAbsolute: Point) {
    const position = { x: node.x ?? 0, y: node.y ?? 0 };
    const here = node.id === "root" ? parentAbsolute : shift(position, parentAbsolute);
    absolute.set(node.id, here);
    if (node.id !== "root") laidOut.push({ id: node.id, parentId, x: position.x, y: position.y, width: node.width ?? 0, height: node.height ?? 0 });
    for (const child of node.children ?? []) collectNodes(child, node.id === "root" ? null : node.id, here);
  }
}

function missing(node: GraphNode): never {
  throw new Error(`ELK returned no position for ${node.id}`);
}

function shift(point: Point, offset: Point): Point {
  return { x: point.x + offset.x, y: point.y + offset.y };
}
