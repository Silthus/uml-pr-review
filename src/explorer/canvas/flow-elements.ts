import type { Edge, Node } from "@xyflow/react";
import { isProminent, type DependencyEdgeData, type MoreNodeData, type PackageNodeData } from "../graph/visible-graph.ts";
import type { Point } from "../layout/layout-engine.ts";
import type { Scene } from "../state/use-layout.ts";

export type PackageFlowNode = Node<PackageNodeData & { fresh: boolean }, "package">;
export type MoreFlowNode = Node<MoreNodeData, "more">;
export type FlowNode = PackageFlowNode | MoreFlowNode;
export type DependencyFlowEdge = Edge<DependencyEdgeData & { points: Point[]; labelAt: Point | null; label: string; fresh: boolean }, "dependency">;

export function toFlowNodes(scene: Scene, fresh: ReadonlySet<string>): FlowNode[] {
  const positions = new Map(scene.layout.nodes.map((node) => [node.id, node]));
  return scene.graph.nodes.map((node): FlowNode => {
    const laidOut = positions.get(node.id)!;
    const shared = { id: node.id, parentId: node.parentId ?? undefined, position: { x: laidOut.x, y: laidOut.y }, width: laidOut.width, height: laidOut.height, draggable: false, connectable: false, deletable: false, selectable: false };
    if (node.type === "more") return { ...shared, type: "more", data: node.data };
    return { ...shared, type: "package", data: { ...node.data, fresh: fresh.has(node.id) }, className: node.data.container ? "is-container" : "is-leaf", zIndex: node.data.container ? 0 : 1 };
  });
}

export function toFlowEdges(scene: Scene, fresh: ReadonlySet<string>): DependencyFlowEdge[] {
  const routes = new Map(scene.layout.edges.map((edge) => [edge.id, edge]));
  return scene.graph.edges.map((edge): DependencyFlowEdge => {
    const route = routes.get(edge.id);
    const prominent = isProminent(edge);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "dependency",
      selectable: false,
      deletable: false,
      zIndex: prominent ? 1000 : 2,
      data: { ...edge.data, points: route?.points ?? [], labelAt: route?.labelAt ?? null, label: edge.label, fresh: fresh.has(edge.id) },
    };
  });
}
