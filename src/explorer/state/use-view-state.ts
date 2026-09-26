import { useCallback, useState } from "react";
import { ancestorsOf } from "../graph/paths.ts";
import type { Selection } from "../graph/visible-graph.ts";

export type FocusRequest = { ids: string[]; version: number };

export type ViewControls = {
  selection: Selection | null;
  expanded: ReadonlySet<string>;
  showAll: ReadonlySet<string>;
  includeTests: boolean;
  planVisible: boolean;
  followAgent: boolean;
  focus: FocusRequest | null;
  selectModule(path: string): void;
  selectSeam(from: string, to: string): void;
  clearSelection(): void;
  toggleExpanded(path: string): void;
  showAllChildren(parent: string): void;
  setIncludeTests(value: boolean): void;
  setPlanVisible(value: boolean): void;
  setFollowAgent(value: boolean): void;
  resetFor(paths: string[]): void;
};

function initialFocusRequest(focus: string | null, expanded: string[]): FocusRequest | null {
  const deepest = [...expanded].sort((a, b) => b.split("/").length - a.split("/").length)[0];
  const target = focus ?? deepest;
  return target ? { ids: [target], version: 1 } : null;
}

export function useViewState(initialFocus: string | null, initialExpanded: string[]): ViewControls {
  const [selection, setSelection] = useState<Selection | null>(initialFocus ? { kind: "module", path: initialFocus } : null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([...initialExpanded, ...(initialFocus ? ancestorsOf(initialFocus) : [])]));
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(() => new Set());
  const [includeTests, setIncludeTests] = useState(false);
  const [planVisible, setPlanVisible] = useState(true);
  const [followAgent, setFollowAgent] = useState(true);
  const [focus, setFocus] = useState<FocusRequest | null>(() => initialFocusRequest(initialFocus, initialExpanded));

  const requestFocus = useCallback((ids: string[]) => setFocus((current) => ({ ids, version: (current?.version ?? 0) + 1 })), []);

  const selectModule = useCallback((path: string) => {
    setSelection({ kind: "module", path });
    setExpanded((current) => new Set([...current, ...ancestorsOf(path)]));
    requestFocus([path]);
  }, [requestFocus]);

  const selectSeam = useCallback((from: string, to: string) => {
    setSelection({ kind: "seam", from, to });
    setExpanded((current) => new Set([...current, ...ancestorsOf(from), ...ancestorsOf(to)]));
    requestFocus([from, to]);
  }, [requestFocus]);

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

  const resetFor = useCallback((paths: string[]) => {
    setExpanded((current) => new Set([...current, ...paths.flatMap(ancestorsOf)]));
    requestFocus(paths);
  }, [requestFocus]);

  return {
    selection,
    expanded,
    showAll,
    includeTests,
    planVisible,
    followAgent,
    focus,
    selectModule,
    selectSeam,
    clearSelection: useCallback(() => setSelection(null), []),
    toggleExpanded,
    showAllChildren,
    setIncludeTests,
    setPlanVisible,
    setFollowAgent,
    resetFor,
  };
}
