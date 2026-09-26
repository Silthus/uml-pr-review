import { afterAll, describe, expect, test } from "bun:test";
import { ArchitectureModel } from "../../src/architecture/model/index.ts";
import type { ViewState } from "../../src/explorer/graph/types.ts";
import { buildVisibleGraph } from "../../src/explorer/graph/visible-graph.ts";
import { lensFarEndCap } from "../../src/explorer/graph/lens-graph.ts";
import { createLayoutEngine, type LaidOutNode } from "../../src/explorer/layout/layout-engine.ts";
import { architectureOf, type ArchitectureSource } from "../support/architecture.ts";

const source = (await Bun.file(new URL("./fixtures/posthog-products-expanded.json", import.meta.url)).json()) as ArchitectureSource;
const model = new ArchitectureModel(architectureOf(source));
const engine = createLayoutEngine();
const mapView: ViewState = { mode: "map", expanded: new Set(), showAll: new Set(), selection: null, includeTests: false, allEdges: false, plan: null, conformance: null };

afterAll(() => engine.dispose());

describe("PostHog layout through the app's layout path", () => {
  test("the overview lays out the 16 top-level packages with one backbone edge per package and no overlap", async () => {
    const graph = buildVisibleGraph(model, mapView);

    const laidOut = await engine.layout(graph);

    expect(laidOut.nodes.map((node) => node.id).sort()).toEqual(model.children(".").map((module) => module.path).sort());
    expect(graph.edges.length).toBeLessThanOrEqual(16);
    expect(new Set(graph.edges.map((edge) => edge.source)).size).toBe(graph.edges.length);
    expect(overlappingPairs(laidOut.nodes)).toEqual([]);
    for (const edge of laidOut.edges) expect(edge.points.length).toBeGreaterThanOrEqual(2);
  });

  test("selecting a top-level package draws only its own dependencies, in and out", () => {
    const graph = buildVisibleGraph(model, { ...mapView, selection: { kind: "module", path: "products" } });

    expect(graph.edges.length).toBeGreaterThan(2);
    expect(graph.edges.every((edge) => (edge.source === "products" && edge.data.tone === "outgoing") || (edge.target === "products" && edge.data.tone === "incoming"))).toBe(true);
    expect(graph.nodes.find((node) => node.id === "products")?.data.tone).toBe("selected");
    expect(graph.nodes.some((node) => node.data.tone === "dimmed")).toBe(true);
  });

  test("all dependencies brings back every top-level dependency", () => {
    const graph = buildVisibleGraph(model, { ...mapView, allEdges: true });

    expect(graph.edges.length).toBe(model.lift(new Set()).dependencies.filter((dependency) => dependency.from !== "." && dependency.to !== ".").length);
  });

  test("expanding products packs its largest children in a grid inside the products frame and folds the rest", async () => {
    const graph = buildVisibleGraph(model, { ...mapView, expanded: new Set(["products"]) });

    const laidOut = await engine.layout(graph);

    const children = laidOut.nodes.filter((node) => node.parentId === "products");
    expect(children).toHaveLength(13);
    expect(children.map((node) => node.id)).toContain("more:products");
    expect(new Set(children.map((node) => node.y)).size).toBeGreaterThan(1);
    expect(parentsBeforeChildren(graph.nodes.map((node) => [node.id, node.parentId]))).toBe(true);
    expect(overlappingPairs(laidOut.nodes)).toEqual([]);
    expect(childrenOutsideParents(laidOut.nodes)).toEqual([]);
  });

  test("the connection lens puts dependents left, the selected package expanded in the middle, and dependencies right", async () => {
    const selection = { kind: "module", path: "products/error_tracking" } as const;
    const graph = buildVisibleGraph(model, { ...mapView, mode: "lens", selection });

    const laidOut = await engine.layout(graph);

    expect(graph.mode).toBe("lens");
    const strongestDependency = model.dependencies(selection.path, "out")[0]!.module;
    const strongestDependent = model.dependencies(selection.path, "in")[0]!.module;
    const positions = new Map(laidOut.nodes.map((node) => [node.id, node]));
    expect(positions.get(strongestDependent)!.x).toBeLessThan(positions.get(selection.path)!.x);
    expect(positions.get(selection.path)!.x).toBeLessThan(positions.get(strongestDependency)!.x);
    expect(graph.edges.every((edge) => edge.data.tone === "incoming" || edge.data.tone === "outgoing")).toBe(true);
    expect(graph.edges.some((edge) => edge.target === strongestDependency && edge.data.tone === "outgoing")).toBe(true);
    expect(graph.nodes.filter((node) => node.parentId === null).length).toBeLessThanOrEqual(1 + 2 * lensFarEndCap + 2);
    expect(overlappingPairs(laidOut.nodes)).toEqual([]);
  });

  test("the plan focus shows only planned modules, seam ends, and their direct dependencies, flat with context", async () => {
    const plan = planOf(["products/error_tracking", "products/feature_flags"], [["products/error_tracking", "products/feature_flags"]]);
    const graph = buildVisibleGraph(model, { ...mapView, plan });

    const laidOut = await engine.layout(graph);

    expect(graph.mode).toBe("plan");
    const ids = graph.nodes.map((node) => node.id);
    expect(ids).toContain("products/error_tracking");
    expect(ids).toContain("products/feature_flags");
    expect(ids.length).toBeLessThanOrEqual(2 + 2 * 2 * 2);
    expect(graph.nodes.every((node) => node.parentId === null)).toBe(true);
    const errorTracking = graph.nodes.find((node) => node.id === "products/error_tracking");
    expect(errorTracking?.type === "package" ? errorTracking.data.context : null).toBe("products");
    expect(graph.edges.find((edge) => edge.id === "products/error_tracking->products/feature_flags")?.data.seam?.action).toBe("add");
    const plannedImports = graph.edges.filter((edge) => edge.source === "products/error_tracking" && edge.data.seam === null).reduce((total, edge) => total + edge.data.imports, 0);
    const modelImports = model.dependencies("products/error_tracking", "out").filter((far) => ids.includes(far.module)).reduce((total, far) => total + far.imports, 0);
    expect(plannedImports).toBe(modelImports);
    expect(overlappingPairs(laidOut.nodes)).toEqual([]);
  });
});

function planOf(modules: string[], seams: [string, string][]): NonNullable<ViewState["plan"]> {
  const at = "2026-09-26T10:15:00.000Z";
  return {
    version: 1,
    id: "plan",
    title: "Plan",
    goal: "Goal",
    baseCommit: "3f2a9c01d4e5b6a7980c1d2e3f4a5b6c7d8e9f00",
    status: "draft",
    revision: 1,
    modules: modules.map((path) => ({ path, action: "modify", responsibility: "r", origin: "agent" })),
    seams: seams.map(([from, to]) => ({ from, to, action: "add", origin: "agent" })),
    comments: [],
    revisions: [],
    createdAt: at,
    updatedAt: at,
  };
}

function parentsBeforeChildren(order: [string, string | null][]): boolean {
  const seen = new Set<string>();
  return order.every(([id, parentId]) => {
    seen.add(id);
    return parentId === null || seen.has(parentId);
  });
}

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
