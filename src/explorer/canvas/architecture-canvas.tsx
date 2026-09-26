import { useEffect, useMemo, useRef } from "react";
import { Switch } from "../shell/switch.tsx";
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Node } from "@xyflow/react";
import type { Scene } from "../state/use-layout.ts";
import type { Theme } from "../state/theme.ts";
import type { FocusRequest } from "../state/use-view-state.ts";
import { DependencyEdge } from "./dependency-edge.tsx";
import { toFlowEdges, toFlowNodes, type FlowNode } from "./flow-elements.ts";
import { MoreNode } from "./more-node.tsx";
import { PackageNode } from "./package-node.tsx";

const nodeTypes = { package: PackageNode, more: MoreNode };
const edgeTypes = { dependency: DependencyEdge };

export type CanvasProps = {
  scene: Scene | null;
  fresh: ReadonlySet<string>;
  focus: FocusRequest | null;
  pending: boolean;
  error: string | null;
  loading: boolean;
  theme: Theme;
  lensPath: string | null;
  allEdges: boolean;
  onAllEdges(value: boolean): void;
  onCloseLens(): void;
  onClearSelection(): void;
};

export function ArchitectureCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ scene, fresh, focus, pending, error, loading, theme, lensPath, allEdges, onAllEdges, onCloseLens, onClearSelection }: CanvasProps) {
  const nodes = useMemo(() => (scene ? toFlowNodes(scene, fresh) : []), [scene, fresh]);
  const edges = useMemo(() => (scene ? toFlowEdges(scene, fresh) : []), [scene, fresh]);
  useFocus(scene, focus, pending);
  return (
    <div className="canvas" aria-label="Architecture canvas" aria-busy={pending || loading}>
      <div className="canvas-mode">
        {lensPath ? (
          <>
            <span className="mode-label">Connections of <strong>{lensPath}</strong></span>
            <button type="button" onClick={onCloseLens}>Back to map <kbd>Esc</kbd></button>
          </>
        ) : scene?.graph.mode === "plan" ? (
          <span className="mode-label">Plan focus: planned modules and their seams. Select a module to see its dependencies.</span>
        ) : (
          <>
            <span className="mode-label">{allEdges ? "All top-level dependencies" : "Backbone: each package's heaviest dependency"}</span>
            <Switch label="All dependencies" checked={allEdges} onChange={onAllEdges} />
          </>
        )}
        <span className="canvas-status">{loading ? "Indexing repository…" : pending ? "Laying out…" : scene ? `${scene.graph.nodes.length} packages · ${scene.graph.edges.length} dependencies drawn · layout ${Math.round(scene.layout.milliseconds)} ms` : ""}</span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.08}
        maxZoom={1.8}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnDoubleClick={false}
        onPaneClick={lensPath ? undefined : onClearSelection}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} className="canvas-paper" />
        <Controls showInteractive={false} position="bottom-left" />
        {scene?.graph.mode === "map" ? <MiniMap pannable zoomable position="bottom-right" nodeColor={(node) => minimapColor(node, theme)} nodeStrokeWidth={0} className="minimap" /> : null}
      </ReactFlow>
      {error ? (
        <div role="alert" className="canvas-error">
          <strong>Layout failed</strong>
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

function useFocus(scene: Scene | null, focus: FocusRequest | null, pending: boolean) {
  const { fitView, fitBounds } = useReactFlow();
  const handled = useRef(0);
  const fittedInitially = useRef(false);
  useEffect(() => {
    if (!scene || pending) return;
    if (focus && focus.version !== handled.current) {
      const ids = focus.ids === "all" ? "all" : withLensNodes(scene, focus.ids);
      if (ids === "all" || ids.length > 0) {
        handled.current = focus.version;
        fittedInitially.current = true;
        if (ids === "all") void fitBounds(sceneBounds(scene), { duration: 360, padding: 0.03 });
        else void fitView({ nodes: ids.map((id) => ({ id })), duration: 360, padding: 0.08, maxZoom: 1.15 });
        return;
      }
    }
    if (!fittedInitially.current) {
      fittedInitially.current = true;
      void fitBounds(sceneBounds(scene), { duration: 0, padding: 0.03 });
    }
  }, [scene, focus, pending, fitView, fitBounds]);
}

function sceneBounds(scene: Scene): { x: number; y: number; width: number; height: number } {
  const positions = new Map(scene.layout.nodes.map((node) => [node.id, node]));
  const absolute = (id: string): { x: number; y: number } => {
    const node = positions.get(id)!;
    const parent = node.parentId ? absolute(node.parentId) : { x: 0, y: 0 };
    return { x: parent.x + node.x, y: parent.y + node.y };
  };
  const points = [
    ...scene.layout.nodes.flatMap((node) => {
      const at = absolute(node.id);
      return [at, { x: at.x + node.width, y: at.y + node.height }];
    }),
    ...scene.layout.edges.flatMap((edge) => edge.points),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function withLensNodes(scene: Scene, ids: string[]): string[] {
  const present = ids.filter((id) => scene.graph.nodes.some((node) => node.id === id));
  const selected = scene.graph.nodes.some((node) => present.includes(node.id) && node.data.tone === "selected");
  if (!selected) return present;
  const lens = scene.graph.nodes.filter((node) => node.data.tone === "incoming" || node.data.tone === "outgoing" || node.data.tone === "both").map((node) => node.id);
  return [...present, ...lens];
}

const minimapPalette = {
  light: { selected: "#1a2233", incoming: "#4c66d1", outgoing: "#1d8f7d", both: "#8060c4", dimmed: "#e4e0d6", quiet: "#c9c3b5", neutral: "#c9c3b5" },
  dark: { selected: "#ecf0f6", incoming: "#7b8fe6", outgoing: "#35b39c", both: "#a48ae0", dimmed: "#262d3a", quiet: "#3d465a", neutral: "#3d465a" },
} as const;

function minimapColor(node: Node, theme: Theme): string {
  return minimapPalette[theme][(node as FlowNode).data.tone];
}
