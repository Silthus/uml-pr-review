import type {
  ArchitectureEvent,
  ArchitecturePayload,
  ArchitecturePlan,
  ConformanceResult,
  Dependency,
  ImportEvidence,
  ModuleView,
  PlanSummary,
} from "../architecture/contracts/index.ts";

export type Theme = "light" | "dark";
export type ExplorerMode = "overview" | "connections" | "plan";
export type ConnectionRole = "neutral" | "selected" | "incoming" | "outgoing" | "dim" | "plan" | "violation";
export type PlanElementStatus = "conforming" | "pending" | "violating";
export type EventStatus = "connecting" | "live" | "offline";

export type RepositoryState = {
  path: string;
  payload: ArchitecturePayload;
  plans: PlanSummary[];
  plan: ArchitecturePlan | null;
  conformance: ConformanceResult | null;
};

export type ExplorerApi = {
  load(path: string, planId: string | null): Promise<RepositoryState>;
  applyOperations(planId: string, expectedRevision: number, operations: unknown[], note?: string): Promise<ArchitecturePlan>;
  setLock(planId: string, expectedRevision: number, locked: boolean): Promise<ArchitecturePlan>;
  check(planId: string, final: boolean): Promise<ConformanceResult>;
  events(onEvent: (event: ArchitectureEvent) => void, onStatus: (status: EventStatus) => void): () => void;
};

export type VisibleGraph = {
  modules: ModuleView[];
  dependencies: Dependency[];
  evidence: EvidenceMap;
  expanded: Set<string>;
};

export type EvidenceMap = Map<string, ImportEvidence[]>;

export type PackageNodeData = {
  module: ModuleView;
  label: string;
  fullPath: string;
  stereotype: string;
  fileLabel: string;
  childLabel: string;
  role: ConnectionRole;
  status: PlanElementStatus | null;
  action: string | null;
  commentCount: number;
  moreCount: number;
  expanded: boolean;
  container: boolean;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
};

export type DependencyEdgeData = {
  imports: number;
  role: ConnectionRole;
  evidence: ImportEvidence[];
  label: string;
  interfaceLabel: string | null;
};

export type LayoutNodeInput = {
  id: string;
  parentId: string | null;
  width: number;
  height: number;
};

export type LayoutEdgeInput = {
  id: string;
  source: string;
  target: string;
};

export type LayoutResult = {
  nodes: { id: string; x: number; y: number; width: number; height: number }[];
  edges: { id: string; sections?: unknown[] }[];
  milliseconds: number;
};
