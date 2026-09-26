import { afterAll, describe, expect, test } from "bun:test";
import { ArchitectureModel } from "../../src/architecture/model/index.ts";
import { buildVisibleGraph } from "../../src/explorer/graph/visible-graph.ts";
import { createLayoutEngine, type LaidOutNode } from "../../src/explorer/layout/layout-engine.ts";
import { architectureOf, type ArchitectureSource } from "../support/architecture.ts";

const source = (await Bun.file(new URL("./fixtures/posthog-products-expanded.json", import.meta.url)).json()) as ArchitectureSource;
const model = new ArchitectureModel(architectureOf(source));
const engine = createLayoutEngine();

afterAll(() => engine.dispose());

describe("PostHog layout through the app's layout path", () => {
  test("the overview lays out the 16 top-level packages without overlap", async () => {
    const graph = buildVisibleGraph(model, { expanded: new Set(), showAll: new Set(), selection: null, includeTests: false, plan: null, conformance: null });

    const laidOut = await engine.layout(graph);

    expect(laidOut.nodes.map((node) => node.id).sort()).toEqual(model.children(".").map((module) => module.path).sort());
    expect(laidOut.nodes).toHaveLength(16);
    expect(overlappingPairs(laidOut.nodes)).toEqual([]);
    expect(laidOut.edges.length).toBeGreaterThan(20);
    for (const edge of laidOut.edges) expect(edge.points.length).toBeGreaterThanOrEqual(2);
  });

  test("expanding products nests its largest children inside the products frame with the rest folded into one node", async () => {
    const graph = buildVisibleGraph(model, { expanded: new Set(["products"]), showAll: new Set(), selection: null, includeTests: false, plan: null, conformance: null });

    const laidOut = await engine.layout(graph);

    const children = laidOut.nodes.filter((node) => node.parentId === "products");
    expect(children).toHaveLength(13);
    expect(children.map((node) => node.id)).toContain("more:products");
    expect(laidOut.nodes.find((node) => node.id === "products")!.width).toBeGreaterThan(600);
    expect(overlappingPairs(laidOut.nodes)).toEqual([]);
    expect(childrenOutsideParents(laidOut.nodes)).toEqual([]);
  });

  test("selecting a product pins its strongest far ends into view and dims the rest", async () => {
    const selection = { kind: "module", path: "products/error_tracking" } as const;
    const graph = buildVisibleGraph(model, { expanded: new Set(["products"]), showAll: new Set(), selection, includeTests: false, plan: null, conformance: null });

    const laidOut = await engine.layout(graph);

    const strongestFarEnd = model.dependencies(selection.path, "out")[0]!.module;
    const outgoing = graph.edges.filter((edge) => edge.data.tone === "outgoing");
    expect(outgoing.map((edge) => edge.target)).toContain(strongestFarEnd);
    expect(graph.nodes.find((node) => node.id === strongestFarEnd)!.data.tone).toBe("outgoing");
    expect(graph.nodes.find((node) => node.id === selection.path)!.data.tone).toBe("selected");
    expect(graph.nodes.filter((node) => node.data.tone === "dimmed").length).toBeGreaterThan(0);
    expect(overlappingPairs(laidOut.nodes)).toEqual([]);
  });
});

type Rect = { id: string; left: number; top: number; right: number; bottom: number; ancestors: Set<string> };

function absoluteRects(nodes: LaidOutNode[]): Rect[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    let left = node.x;
    let top = node.y;
    const ancestors = new Set<string>();
    for (let parent = node.parentId; parent; parent = byId.get(parent)?.parentId ?? null) {
      const container = byId.get(parent)!;
      left += container.x;
      top += container.y;
      ancestors.add(parent);
    }
    return { id: node.id, left, top, right: left + node.width, bottom: top + node.height, ancestors };
  });
}

function overlappingPairs(nodes: LaidOutNode[]): string[] {
  const rects = absoluteRects(nodes);
  const pairs: string[] = [];
  for (const left of rects) {
    for (const right of rects) {
      if (left.id >= right.id || left.ancestors.has(right.id) || right.ancestors.has(left.id)) continue;
      if (left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top) pairs.push(`${left.id} overlaps ${right.id}`);
    }
  }
  return pairs;
}

function childrenOutsideParents(nodes: LaidOutNode[]): string[] {
  const rects = new Map(absoluteRects(nodes).map((rect) => [rect.id, rect]));
  return nodes.flatMap((node) => {
    if (!node.parentId) return [];
    const child = rects.get(node.id)!;
    const parent = rects.get(node.parentId)!;
    const inside = child.left >= parent.left && child.top >= parent.top && child.right <= parent.right && child.bottom <= parent.bottom;
    return inside ? [] : [`${node.id} leaves ${node.parentId}`];
  });
}
