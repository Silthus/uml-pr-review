import { useEffect, useMemo, useRef, useState } from "react";
import type { VisibleGraph } from "../graph/visible-graph.ts";
import { createLayoutEngine, type LayoutResult } from "../layout/layout-engine.ts";

export type Scene = { graph: VisibleGraph; layout: LayoutResult };

export type LayoutState = { scene: Scene | null; pending: boolean; error: string | null };

export function useLayout(graph: VisibleGraph): LayoutState {
  const engine = useMemo(createLayoutEngine, []);
  const [scene, setScene] = useState<Scene | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => () => engine.dispose(), [engine]);

  useEffect(() => {
    if (graph.nodes.length === 0) {
      setScene(null);
      return;
    }
    const request = ++latest.current;
    setPending(true);
    engine
      .layout(graph)
      .then((layout) => {
        if (request !== latest.current) return;
        setScene({ graph, layout });
        setError(null);
      })
      .catch((caught: unknown) => {
        if (request !== latest.current) return;
        setError(`Layout failed: ${caught instanceof Error ? caught.message : String(caught)}`);
      })
      .finally(() => {
        if (request === latest.current) setPending(false);
      });
  }, [engine, graph]);

  return { scene, pending, error };
}
