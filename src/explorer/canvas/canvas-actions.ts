import { createContext, useContext } from "react";

export type CanvasActions = {
  selectModule(path: string): void;
  selectSeam(from: string, to: string): void;
  toggleExpanded(path: string): void;
  showAllChildren(parent: string): void;
};

export const CanvasActionsContext = createContext<CanvasActions>({
  selectModule: () => {},
  selectSeam: () => {},
  toggleExpanded: () => {},
  showAllChildren: () => {},
});

export function useCanvasActions(): CanvasActions {
  return useContext(CanvasActionsContext);
}
