import { describe, expect, test } from "bun:test";
import type { Edge, Node } from "@xyflow/react";
import { layoutGraph } from "../../src/explorer/layout.ts";
import type { DependencyEdgeData, PackageNodeData } from "../../src/explorer/types.ts";
import type { ModuleView } from "../../src/architecture/contracts/index.ts";

const emptyNodeData = (index: number): PackageNodeData => {
  const module: ModuleView = { path: `products/module_${index}`, label: `module_${index}`, kind: "directory", parent: null, childCount: 0, directFiles: 4, totalFiles: 4 };
  return {
    module,
    label: module.label,
    fullPath: module.path,
    stereotype: "«directory»",
    fileLabel: "4 files",
    childLabel: "0 child modules",
    role: "neutral",
    status: null,
    action: null,
    commentCount: 0,
    moreCount: 0,
    expanded: false,
    container: false,
    onSelect: () => {},
    onToggle: () => {},
  };
};

describe("Explorer layout", () => {
  test("keeps a PostHog-sized 300 package disclosure free of sibling overlaps", async () => {
    const nodes: Node<PackageNodeData>[] = Array.from({ length: 300 }, (_, index) => ({
      id: `module:products/module_${index}`,
      type: "package",
      position: { x: 0, y: 0 },
      width: 270,
      height: 142,
      data: emptyNodeData(index),
    }));
    const edges: Edge<DependencyEdgeData>[] = nodes.slice(1).map((node, index) => ({
      id: `${nodes[index]!.id}->${node.id}`,
      source: nodes[index]!.id,
      target: node.id,
      type: "dependency",
      data: { imports: 1, role: "neutral", evidence: [], label: "1", interfaceLabel: null },
    }));

    const laidOut = await layoutGraph(nodes, edges);
    expect(laidOut.nodes).toHaveLength(300);
    const overlaps = overlappingPairs(laidOut.nodes);
    expect(overlaps).toEqual([]);
  });
});

function overlappingPairs(nodes: Node<PackageNodeData>[]): string[] {
  const pairs: string[] = [];
  for (let left = 0; left < nodes.length; left++) {
    for (let right = left + 1; right < nodes.length; right++) {
      if (overlaps(nodes[left]!, nodes[right]!)) pairs.push(`${nodes[left]!.id} overlaps ${nodes[right]!.id}`);
    }
  }
  return pairs.slice(0, 10);
}

function overlaps(left: Node<PackageNodeData>, right: Node<PackageNodeData>): boolean {
  const leftRight = left.position.x + (left.width ?? 0);
  const rightRight = right.position.x + (right.width ?? 0);
  const leftBottom = left.position.y + (left.height ?? 0);
  const rightBottom = right.position.y + (right.height ?? 0);
  return left.position.x < rightRight && leftRight > right.position.x && left.position.y < rightBottom && leftBottom > right.position.y;
}
