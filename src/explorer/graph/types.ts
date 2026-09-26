import type { ArchitecturePlan, ConformanceResult, ElementStatus, ModuleKind, PlannedModule, Seam } from "../../architecture/contracts/index.ts";

export type Selection = { kind: "module"; path: string } | { kind: "seam"; from: string; to: string };
export type Tone = "neutral" | "selected" | "incoming" | "outgoing" | "both" | "dimmed" | "quiet";
export type GraphMode = "map" | "lens" | "plan";
export type Layer = "first" | "last";

export type ViewState = {
  mode: "map" | "lens";
  expanded: ReadonlySet<string>;
  showAll: ReadonlySet<string>;
  selection: Selection | null;
  includeTests: boolean;
  allEdges: boolean;
  plan: ArchitecturePlan | null;
  conformance: ConformanceResult | null;
};

export type PackageNodeData = {
  path: string;
  label: string;
  context: string | null;
  kind: ModuleKind;
  directFiles: number;
  totalFiles: number;
  childCount: number;
  hiddenChildren: number;
  expanded: boolean;
  expandable: boolean;
  container: boolean;
  ghost: boolean;
  tone: Tone;
  planAction: PlannedModule["action"] | null;
  status: ElementStatus | null;
  comments: number;
};

export type MoreNodeData = { parent: string | null; hidden: number; label: string; detail: string; expandable: boolean; tone: Tone };

export type GraphNode = { id: string; parentId: string | null; width: number; height: number; layer?: Layer } & ({ type: "package"; data: PackageNodeData } | { type: "more"; data: MoreNodeData });

export type SeamOverlay = { action: Seam["action"]; status: ElementStatus | null; interfaceFile: string | null; comments: number };

export type DependencyEdgeData = { imports: number; tone: Tone; seam: SeamOverlay | null; selected: boolean };

export type GraphEdge = { id: string; source: string; target: string; label: string; data: DependencyEdgeData };

export type VisibleGraph = { mode: GraphMode; nodes: GraphNode[]; edges: GraphEdge[] };
