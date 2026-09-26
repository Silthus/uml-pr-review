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
  useFocus(scene, focus);
  return (
    <div className="canvas" aria-label="Architecture canvas" aria-busy={pending || loading}>
      <div className="canvas-mode">
        {lensPath ? (
          <>
            <span className="mode-label">Connections of <strong>{lensPath}</strong></span>
            <button type="button" onClick={onCloseLens}>Back to map <kbd>Esc</kbd></button>
          </>
        ) : scene?.graph.mode === "plan" ? (
          <span className="mode-label">Plan focus: planned modules, their seams, and their direct dependencies</span>
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

function useFocus(scene: Scene | null, focus: FocusRequest | null) {
  const { fitView } = useReactFlow();
  const handled = useRef(0);
  const fittedInitially = useRef(false);
  useEffect(() => {
    if (!scene) return;
    if (focus && focus.version !== handled.current) {
      const ids = focus.ids === "all" ? "all" : withLensNodes(scene, focus.ids);
      if (ids === "all" || ids.length > 0) {
        handled.current = focus.version;
        fittedInitially.current = true;
        void fitView({ nodes: ids === "all" ? undefined : ids.map((id) => ({ id })), duration: 360, padding: ids === "all" ? 0.04 : 0.08, maxZoom: 1.15 });
        return;
      }
    }
    if (!fittedInitially.current) {
      fittedInitially.current = true;
      void fitView({ padding: 0.04, duration: 0, maxZoom: 1.15 });
    }
  }, [scene, focus, fitView]);
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
