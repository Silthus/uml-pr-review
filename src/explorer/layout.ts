import type { Edge, Node } from "@xyflow/react";
import type { DependencyEdgeData, LayoutEdgeInput, LayoutNodeInput, LayoutResult, PackageNodeData } from "./types.ts";

let nextLayoutId = 1;
let worker: Worker | null = null;
const pending = new Map<number, (result: LayoutResult) => void>();

export async function layoutGraph(nodes: Node<PackageNodeData>[], edges: Edge<DependencyEdgeData>[]): Promise<{ nodes: Node<PackageNodeData>[]; milliseconds: number }> {
  const inputs = nodes.map((node): LayoutNodeInput => ({ id: node.id, parentId: parentNodeId(node, nodes), width: node.width ?? 260, height: node.height ?? 132 }));
  const edgeInputs = edges.map((edge): LayoutEdgeInput => ({ id: edge.id, source: edge.source, target: edge.target }));
  const result = await computeLayout(inputs, edgeInputs);
  const completeResult = result.nodes.length === inputs.length ? result : fallbackLayout(inputs);
  const positions = new Map(completeResult.nodes.map((node) => [node.id, node]));
  return {
    nodes: nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, position: { x: position.x, y: position.y }, width: position.width, height: position.height } : node;
    }),
    milliseconds: completeResult.milliseconds,
  };
}

function parentNodeId(node: Node<PackageNodeData>, nodes: Node<PackageNodeData>[]): string | null {
  const parent = node.data.module.parent;
  if (!parent) return null;
  const parentNode = nodes.find((candidate) => candidate.data.module.path === parent);
  return parentNode?.id ?? null;
}

async function computeLayout(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[]): Promise<LayoutResult> {
  if (typeof Worker === "undefined") return fallbackLayout(nodes);
  const current = worker ?? createWorker();
  if (!current) return fallbackLayout(nodes);
  const id = nextLayoutId++;
  const promise = new Promise<LayoutResult>((resolve) => pending.set(id, resolve));
  current.postMessage({ id, nodes, edges });
  return promise;
}

function createWorker(): Worker | null {
  try {
    worker = new Worker(new URL("./layout-worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<LayoutResult & { id: number }>) => {
      const resolve = pending.get(event.data.id);
      if (!resolve) return;
      pending.delete(event.data.id);
      resolve(event.data);
    });
    worker.addEventListener("error", () => {
      worker?.terminate();
      worker = null;
      for (const [id, resolve] of pending) {
        pending.delete(id);
        resolve({ nodes: [], edges: [], milliseconds: 0 });
      }
    });
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

function fallbackLayout(nodes: LayoutNodeInput[]): LayoutResult {
  const started = performance.now();
  const byParent = new Map<string | null, LayoutNodeInput[]>();
  for (const node of nodes) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  const output: LayoutResult["nodes"] = [];
  place(null, 24, 24, 0);
  return { nodes: output, edges: [], milliseconds: performance.now() - started };

  function place(parentId: string | null, x: number, y: number, depth: number): number {
    let cursor = y;
    for (const node of byParent.get(parentId) ?? []) {
      const children = byParent.get(node.id) ?? [];
      const height = children.length ? Math.max(node.height, children.length * 150 + 86) : node.height;
      const width = children.length ? Math.max(node.width, 520) : node.width;
      output.push({ id: node.id, x, y: cursor, width, height });
      if (children.length) place(node.id, x + 44, cursor + 74, depth + 1);
      cursor += height + (depth === 0 ? 44 : 22);
    }
    return cursor;
  }
}
