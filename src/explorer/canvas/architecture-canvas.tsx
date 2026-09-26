import { useEffect, useMemo, useRef } from "react";
import { Background, BackgroundVariant, Controls, MiniMap, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type Node } from "@xyflow/react";
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
  onClearSelection(): void;
};

export function ArchitectureCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ scene, fresh, focus, pending, error, loading, theme, onClearSelection }: CanvasProps) {
  const nodes = useMemo(() => (scene ? toFlowNodes(scene, fresh) : []), [scene, fresh]);
  const edges = useMemo(() => (scene ? toFlowEdges(scene, fresh) : []), [scene, fresh]);
  useFocus(scene, focus);
  return (
    <div className="canvas" aria-label="Architecture canvas" aria-busy={pending || loading}>
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
        onPaneClick={onClearSelection}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} className="canvas-paper" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={(node) => minimapColor(node, theme)} nodeStrokeWidth={0} className="minimap" />
        <Panel position="top-right" className="canvas-status">
          {loading ? "Indexing repository…" : pending ? "Laying out…" : scene ? `${scene.graph.nodes.length} packages · ${scene.graph.edges.length} dependencies · layout ${Math.round(scene.layout.milliseconds)} ms` : ""}
        </Panel>
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
      handled.current = focus.version;
      const ids = withLensNodes(scene, focus.ids);
      if (ids.length > 0) {
        void fitView({ nodes: ids.map((id) => ({ id })), duration: 360, padding: 0.35, maxZoom: 1 });
        return;
      }
    }
    if (!fittedInitially.current) {
      fittedInitially.current = true;
      void fitView({ padding: 0.08, duration: 0 });
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
