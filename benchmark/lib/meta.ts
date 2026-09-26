export type ExitReason = "completed" | "failed" | "timed-out" | "invalid-setup" | "historical";

export type RunMeta = {
  pr: number | string;
  arm: string;
  model: string | null;
  sessionId: string | null;
  sessionSource?: string;
  turns: number | null;
  costUsd: number | null;
  wallSeconds: number | null;
  startedAt: string | null;
  exit: { reason: ExitReason; code: number | null; detail?: string };
  baseCommit: string;
  diffFrom?: string;
  planIds?: string[];
};
