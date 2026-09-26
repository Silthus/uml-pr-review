import { useEffect, useMemo, useState } from "react";
import type { VisibleGraph } from "../graph/visible-graph.ts";
import { createLayoutEngine, type LayoutResult } from "../layout/layout-engine.ts";

export type Scene = { graph: VisibleGraph; layout: LayoutResult };

export type LayoutState = { scene: Scene | null; pending: boolean; error: string | null };

type Failure = { graph: VisibleGraph; message: string };

export function useLayout(graph: VisibleGraph): LayoutState {
  const engine = useMemo(createLayoutEngine, []);
  const [scene, setScene] = useState<Scene | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => () => engine.dispose(), [engine]);

  useEffect(() => {
    if (graph.nodes.length === 0) {
      setScene(null);
      return;
    }
    let current = true;
    engine
      .layout(graph)
      .then((layout) => {
        if (!current) return;
        setScene({ graph, layout });
        setFailure(null);
      })
      .catch((caught: unknown) => {
        if (current) setFailure({ graph, message: `Layout failed: ${caught instanceof Error ? caught.message : String(caught)}` });
      });
    return () => {
      current = false;
    };
  }, [engine, graph]);

  const settled = scene?.graph === graph || failure?.graph === graph;
  return { scene, pending: graph.nodes.length > 0 && !settled, error: failure?.graph === graph ? failure.message : null };
}
