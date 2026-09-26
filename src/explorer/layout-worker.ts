import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { LayoutEdgeInput, LayoutNodeInput, LayoutResult } from "./types.ts";

type LayoutRequest = {
  id: number;
  nodes: LayoutNodeInput[];
  edges: LayoutEdgeInput[];
};

const elk = new ELK();

self.addEventListener("message", async (event: MessageEvent<LayoutRequest>) => {
  const started = performance.now();
  const { id, nodes, edges } = event.data;
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "88",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[top=48,left=36,bottom=36,right=36]",
    },
    children: hierarchy(nodes),
    edges: edges.map((edge): ElkExtendedEdge => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };
  const result = await elk.layout(graph);
  const response: LayoutResult & { id: number } = {
    id,
    nodes: flatten(result).map((node) => ({ id: node.id, x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 0, height: node.height ?? 0 })),
    edges: result.edges?.map((edge) => ({ id: edge.id, sections: edge.sections })) ?? [],
    milliseconds: performance.now() - started,
  };
  self.postMessage(response);
});

function hierarchy(nodes: LayoutNodeInput[]): ElkNode[] {
  const byId = new Map(nodes.map((node) => [node.id, { id: node.id, width: node.width, height: node.height, children: [] as ElkNode[] } satisfies ElkNode]));
  const roots: ElkNode[] = [];
  for (const node of nodes) {
    const elkNode = byId.get(node.id)!;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children = [...(parent.children ?? []), elkNode];
    else roots.push(elkNode);
  }
  return roots;
}

function flatten(node: ElkNode): ElkNode[] {
  return [node, ...(node.children ?? []).flatMap(flatten)].filter((entry) => entry.id !== "root");
}
