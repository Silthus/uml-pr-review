import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js" with { type: "file" };
import type { GraphEdge, GraphNode, VisibleGraph } from "../graph/visible-graph.ts";

export type Point = { x: number; y: number };
export type LaidOutNode = { id: string; parentId: string | null; x: number; y: number; width: number; height: number };
export type LaidOutEdge = { id: string; points: Point[]; labelAt: Point | null };
export type LayoutResult = { nodes: LaidOutNode[]; edges: LaidOutEdge[]; milliseconds: number };
export type LayoutEngine = { layout(graph: VisibleGraph): Promise<LayoutResult>; dispose(): void };

const containerPadding = "[top=64,left=20,bottom=20,right=20]";
const edgeLabelHeight = 20;
const denseEdgeCount = 48;

export function createLayoutEngine(): LayoutEngine {
  let elk: InstanceType<typeof ELK> | null = null;
  return {
    async layout(graph) {
      elk ??= new ELK({ workerUrl: elkWorkerUrl });
      const started = performance.now();
      const laidOut = await elk.layout(toElkGraph(graph));
      return { ...fromElkGraph(laidOut, graph), milliseconds: performance.now() - started };
    },
    dispose() {
      elk?.terminateWorker();
      elk = null;
    },
  };
}

export function edgeLabelWidth(label: string): number {
  return label.length * 7 + 14;
}

function toElkGraph(graph: VisibleGraph): ElkNode {
  const dense = graph.edges.length > denseEdgeCount;
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.edgeLabels.inline": "true",
      "elk.spacing.nodeNode": "28",
      "elk.spacing.edgeNode": dense ? "12" : "18",
      "elk.spacing.edgeEdge": dense ? "6" : "10",
      "elk.spacing.edgeLabel": "6",
      "elk.spacing.componentComponent": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
      "elk.aspectRatio": "1.7",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.crossingMinimization.thoroughness": "7",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children: elkChildren(graph.nodes, null),
    edges: graph.edges.map(toElkEdge),
  };
}

function elkChildren(nodes: GraphNode[], parentId: string | null): ElkNode[] {
  return nodes.filter((node) => node.parentId === parentId).map((node) => toElkNode(node, nodes));
}

function toElkNode(node: GraphNode, nodes: GraphNode[]): ElkNode {
  const children = elkChildren(nodes, node.id);
  if (children.length === 0) return { id: node.id, width: node.width, height: node.height };
  return {
    id: node.id,
    children,
    layoutOptions: {
      "elk.padding": containerPadding,
      "elk.nodeSize.constraints": "MINIMUM_SIZE",
      "elk.nodeSize.minimum": `(${node.width}, ${node.height})`,
    },
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

function fromElkGraph(root: ElkNode, graph: VisibleGraph): Omit<LayoutResult, "milliseconds"> {
  const nodes: LaidOutNode[] = [];
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
  return { nodes: graph.nodes.map((node) => nodes.find((laidOut) => laidOut.id === node.id) ?? missing(node)), edges };

  function collectNodes(node: ElkNode, parentId: string | null, parentAbsolute: Point) {
    const position = { x: node.x ?? 0, y: node.y ?? 0 };
    const here = node.id === "root" ? parentAbsolute : shift(position, parentAbsolute);
    absolute.set(node.id, here);
    if (node.id !== "root") nodes.push({ id: node.id, parentId, x: position.x, y: position.y, width: node.width ?? 0, height: node.height ?? 0 });
    for (const child of node.children ?? []) collectNodes(child, node.id === "root" ? null : node.id, here);
  }
}

function missing(node: GraphNode): never {
  throw new Error(`ELK returned no position for ${node.id}`);
}

function shift(point: Point, offset: Point): Point {
  return { x: point.x + offset.x, y: point.y + offset.y };
}
