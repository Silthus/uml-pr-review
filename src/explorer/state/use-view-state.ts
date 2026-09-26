import { useCallback, useState } from "react";
import { ancestorsOf } from "../graph/paths.ts";
import type { Selection } from "../graph/types.ts";

export type FocusRequest = { ids: string[] | "all"; version: number };
export type CanvasMode = "map" | "lens";

export type ViewControls = {
  mode: CanvasMode;
  selection: Selection | null;
  expanded: ReadonlySet<string>;
  showAll: ReadonlySet<string>;
  includeTests: boolean;
  allEdges: boolean;
  planVisible: boolean;
  followAgent: boolean;
  focus: FocusRequest | null;
  selectModule(path: string): void;
  selectSeam(from: string, to: string): void;
  clearSelection(): void;
  focusConnections(path: string): void;
  closeLens(): void;
  toggleExpanded(path: string): void;
  showAllChildren(parent: string): void;
  setIncludeTests(value: boolean): void;
  setAllEdges(value: boolean): void;
  setPlanVisible(value: boolean): void;
  setFollowAgent(value: boolean): void;
  focusAll(): void;
};

export function useViewState(initialFocus: string | null, initialExpanded: string[], initialMode: CanvasMode = "map"): ViewControls {
  const [mode, setMode] = useState<CanvasMode>(initialFocus ? initialMode : "map");
  const [selection, setSelection] = useState<Selection | null>(initialFocus ? { kind: "module", path: initialFocus } : null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([...initialExpanded, ...(initialFocus ? ancestorsOf(initialFocus) : [])]));
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(() => new Set());
  const [includeTests, setIncludeTests] = useState(false);
  const [allEdges, setAllEdges] = useState(false);
  const [planVisible, setPlanVisible] = useState(true);
  const [followAgent, setFollowAgent] = useState(true);
  const [focus, setFocus] = useState<FocusRequest | null>(() => initialFocusRequest(initialFocus, initialExpanded));

  const requestFocus = useCallback((ids: string[] | "all") => setFocus((current) => ({ ids, version: (current?.version ?? 0) + 1 })), []);

  const selectModule = useCallback((path: string) => {
    setSelection({ kind: "module", path });
    setExpanded((current) => new Set([...current, ...ancestorsOf(path)]));
    requestFocus(mode === "lens" ? "all" : [path]);
  }, [mode, requestFocus]);

  const selectSeam = useCallback((from: string, to: string) => {
    setSelection({ kind: "seam", from, to });
    setExpanded((current) => new Set([...current, ...ancestorsOf(from), ...ancestorsOf(to)]));
    setMode("map");
    requestFocus([from, to]);
  }, [requestFocus]);

  const focusConnections = useCallback((path: string) => {
    setSelection({ kind: "module", path });
    setExpanded((current) => new Set([...current, ...ancestorsOf(path)]));
    setMode("lens");
    requestFocus("all");
  }, [requestFocus]);

  const closeLens = useCallback(() => {
    setMode("map");
    requestFocus(selection?.kind === "module" ? [selection.path] : "all");
  }, [selection, requestFocus]);

  const toggleExpanded = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    requestFocus([path]);
  }, [requestFocus]);

  const showAllChildren = useCallback((parent: string) => {
    setShowAll((current) => new Set([...current, parent]));
    requestFocus([parent]);
  }, [requestFocus]);

  return {
    mode,
    selection,
    expanded,
    showAll,
    includeTests,
    allEdges,
    planVisible,
    followAgent,
    focus,
    selectModule,
    selectSeam,
    clearSelection: useCallback(() => setSelection(null), []),
    focusConnections,
    closeLens,
    toggleExpanded,
    showAllChildren,
    setIncludeTests,
    setAllEdges,
    setPlanVisible: useCallback((value: boolean) => {
      setPlanVisible(value);
      requestFocus("all");
    }, [requestFocus]),
    setFollowAgent,
    focusAll: useCallback(() => requestFocus("all"), [requestFocus]),
  };
}

function initialFocusRequest(focus: string | null, expanded: string[]): FocusRequest | null {
  const deepest = [...expanded].sort((a, b) => b.split("/").length - a.split("/").length)[0];
  const target = focus ?? deepest;
  return target ? { ids: [target], version: 1 } : null;
}
