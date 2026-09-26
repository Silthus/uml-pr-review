import type { CommentTarget, PlannedModule, Seam } from "../../architecture/contracts/index.ts";

export type PlanActions = {
  addComment(target: CommentTarget, body: string): Promise<void>;
  upsertModule(entry: Omit<PlannedModule, "origin">): Promise<void>;
  dropModule(path: string): Promise<void>;
  upsertSeam(seam: Omit<Seam, "origin">): Promise<void>;
  dropSeam(from: string, to: string): Promise<void>;
  setLocked(locked: boolean): Promise<void>;
  check(final: boolean): Promise<void>;
};
