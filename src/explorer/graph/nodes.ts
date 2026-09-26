import type { ArchitecturePlan, ConformanceResult, ModuleView } from "../../architecture/contracts/index.ts";
import { moduleLabel, parentOf } from "./paths.ts";
import type { GraphEdge, GraphNode, Layer, MoreNodeData, Tone } from "./types.ts";

export const leafHeight = 76;
export const containerMinHeight = 120;
export const headerHeight = 62;
const moreNodeSize = { width: 150, height: 56 };
const maxNodeWidth = 300;
const labelCharWidth = 8.4;
const tabLineHeight = 19;
const contextCharWidth = 6.4;
export const contextLineHeight = 15;
const chipRowHeight = 20;

export type PlanMarks = { actions: Map<string, "create" | "modify" | "remove">; statuses: Map<string, "conforming" | "pending" | "violating">; comments: Map<string, number> };

export type PackageOptions = { container: boolean; expanded: boolean; expandable?: boolean; hiddenChildren: number; context?: string | null; ghost?: boolean; layer?: Layer; parentId: string | null };

export function packageNode(module: ModuleView, options: PackageOptions, marks: PlanMarks, id = module.path): GraphNode {
  return {
    id,
    type: "package",
    parentId: options.parentId,
    layer: options.layer,
    ...packageSize(module, options, marks),
    data: {
      path: module.path,
      label: module.label,
      context: options.context ?? null,
      kind: module.kind,
      directFiles: module.directFiles,
      totalFiles: module.totalFiles,
      childCount: module.childCount,
      hiddenChildren: options.hiddenChildren,
      expanded: options.expanded && options.container,
      expandable: options.expandable ?? false,
      container: options.container,
      ghost: options.ghost ?? false,
      tone: "neutral",
      planAction: marks.actions.get(module.path) ?? null,
      status: marks.statuses.get(module.path) ?? null,
      comments: marks.comments.get(`module:${module.path}`) ?? 0,
    },
  };
}

export function ghostModule(path: string, parent: string | null): ModuleView {
  return { path, label: moduleLabel(path), kind: "package", parent, childCount: 0, directFiles: 0, totalFiles: 0 };
}

export function moreNode(id: string, parentId: string | null, data: Omit<MoreNodeData, "tone">, layer?: Layer): GraphNode {
  return { id, type: "more", parentId, layer, ...moreNodeSize, data: { ...data, tone: "neutral" } };
}

export function packageSize(module: ModuleView, options: Pick<PackageOptions, "container" | "context" | "ghost">, marks: PlanMarks): { width: number; height: number } {
  const lines = labelLines(module.label);
  const longest = Math.max(...lines.map((line) => line.length));
  const context = options.context ?? null;
  const width = Math.max(200, Math.min(maxNodeWidth, longest * labelCharWidth + 72));
  const contextLines = context ? contextLinesOf(context, width) : 0;
  const chips = marks.actions.has(module.path) || marks.statuses.has(module.path) ? chipRowHeight : 0;
  const extra = (lines.length - 1) * tabLineHeight + contextLines * contextLineHeight + chips;
  return { width, height: (options.container ? containerMinHeight : leafHeight) + extra };
}

export function headerHeightOf(node: GraphNode): number {
  if (node.type !== "package") return headerHeight;
  return headerHeight + (node.data.context ? contextLineHeight * contextLinesOf(node.data.context, node.width) : 0) + (node.data.planAction || node.data.status ? chipRowHeight : 0) + (labelLines(node.data.label).length - 1) * tabLineHeight;
}

function contextLinesOf(context: string, width: number): number {
  return Math.ceil(((context.length + 3) * contextCharWidth) / (width - 24));
}

export function describeContents(module: Pick<ModuleView, "totalFiles" | "childCount">, ghost: boolean): string {
  if (ghost) return "planned, does not exist yet";
  const files = `${module.totalFiles.toLocaleString()} ${module.totalFiles === 1 ? "file" : "files"}`;
  if (module.childCount === 0) return files;
  return `${files} · ${module.childCount} ${module.childCount === 1 ? "module" : "modules"}`;
}

export function labelLines(label: string): string[] {
  const roomPerLine = Math.floor((maxNodeWidth - 72) / labelCharWidth);
  if (label.length <= roomPerLine) return [label];
  const lines: string[] = [];
  let current = "";
  for (const segment of label.split("/")) {
    const candidate = current ? `${current}/${segment}` : segment;
    if (current && candidate.length > roomPerLine) {
      lines.push(`${current}/`);
      current = segment;
    } else current = candidate;
  }
  return [...lines, current];
}

export function planMarks(plan: ArchitecturePlan | null, conformance: ConformanceResult | null): PlanMarks {
  const comments = new Map<string, number>();
  for (const comment of plan?.comments ?? []) {
    const key = comment.target.kind === "module" ? `module:${comment.target.path}` : comment.target.kind === "seam" ? `seam:${edgeId(comment.target.from, comment.target.to)}` : "plan";
    comments.set(key, (comments.get(key) ?? 0) + 1);
  }
  return {
    actions: new Map(plan?.modules.map((module) => [module.path, module.action]) ?? []),
    statuses: new Map(conformance?.modules.map((module) => [module.path, module.status]) ?? []),
    comments,
  };
}

export function sortParentsFirst(nodes: GraphNode[]): GraphNode[] {
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
  const depthOf = (id: string): number => {
    const parent = parents.get(id);
    return parent ? depthOf(parent) + 1 : 0;
  };
  return [...nodes].sort((a, b) => depthOf(a.id) - depthOf(b.id) || a.id.localeCompare(b.id));
}

export function withTone(node: GraphNode, tone: Tone): GraphNode {
  return node.type === "package" ? { ...node, data: { ...node.data, tone } } : { ...node, data: { ...node.data, tone } };
}

export function withTones(nodes: GraphNode[], tones: Map<string, Tone>): GraphNode[] {
  return sortParentsFirst(nodes).map((node) => withTone(node, tones.get(node.id) ?? "neutral"));
}

export function aggregateEdges(entries: { source: string; target: string; imports: number }[]): Map<string, { source: string; target: string; imports: number }> {
  const merged = new Map<string, { source: string; target: string; imports: number }>();
  for (const entry of entries) {
    if (entry.source === entry.target) continue;
    const key = edgeId(entry.source, entry.target);
    merged.set(key, { source: entry.source, target: entry.target, imports: (merged.get(key)?.imports ?? 0) + entry.imports });
  }
  return merged;
}

export function dependencyEdge(edge: { source: string; target: string; imports: number }, tone: Tone = "neutral"): GraphEdge {
  return { id: edgeId(edge.source, edge.target), source: edge.source, target: edge.target, label: compactNumber(edge.imports), data: { imports: edge.imports, tone, seam: null, selected: false } };
}

export function bySizeDescending(a: ModuleView, b: ModuleView): number {
  return b.totalFiles - a.totalFiles || a.path.localeCompare(b.path);
}

export function contextOf(path: string): string | null {
  const parent = parentOf(path);
  return parent && parent !== "." ? parent : null;
}

export function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

export function moreNodeId(parent: string): string {
  return `more:${parent}`;
}

export function isProminent(edge: GraphEdge): boolean {
  return edge.data.seam !== null || edge.data.selected || edge.data.tone === "incoming" || edge.data.tone === "outgoing";
}

export function compactNumber(value: number): string {
  if (value >= 10000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
