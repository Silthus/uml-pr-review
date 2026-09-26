import type { CommentTarget, PlannedModule, Seam } from "../../architecture/contracts/index.ts";

export type MutationOutcome = { ok: true } | { ok: false; message: string };

export type PlanActions = {
  addComment(target: CommentTarget, body: string): Promise<MutationOutcome>;
  upsertModule(entry: Omit<PlannedModule, "origin">): Promise<MutationOutcome>;
  dropModule(path: string): Promise<MutationOutcome>;
  upsertSeam(seam: Omit<Seam, "origin">): Promise<MutationOutcome>;
  dropSeam(from: string, to: string): Promise<MutationOutcome>;
  setLocked(locked: boolean): Promise<MutationOutcome>;
  check(final: boolean): Promise<MutationOutcome>;
};

export function closingOnSuccess<T>(save: (value: T) => Promise<MutationOutcome>, close: () => void): (value: T) => Promise<MutationOutcome> {
  return async (value) => {
    const outcome = await save(value);
    if (outcome.ok) close();
    return outcome;
  };
}
