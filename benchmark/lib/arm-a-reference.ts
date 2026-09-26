import { z } from "zod";
import type { Task } from "./task.ts";

const CommitRangeSchema = z.object({ base: z.string().min(7), head: z.string().min(7) }).loose();

export type ArmAReference = { kind: "session-answer" | "rebased-pr" | "pull-request"; base: string; head: string };

export function armAReference(task: Task): ArmAReference {
  const answer = CommitRangeSchema.safeParse(task.sessionAnswerDiff);
  if (answer.success) return { kind: "session-answer", base: answer.data.base, head: answer.data.head };
  const final = CommitRangeSchema.safeParse(task.diffStat);
  if (final.success && final.data.head === task.finalHead && final.data.base !== task.baseCommit) return { kind: "rebased-pr", base: final.data.base, head: final.data.head };
  return { kind: "pull-request", base: task.baseCommit, head: task.finalHead };
}
