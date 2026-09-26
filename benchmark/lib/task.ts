import { z } from "zod";

const AttachmentSchema = z.union([z.string(), z.object({ path: z.string() }).loose()]);

const SessionSchema = z
  .object({
    source: z.string(),
    id: z.string().optional(),
    threadId: z.string().optional(),
    transcript: z.string().optional(),
    title: z.string().optional(),
    model: z.string().optional(),
    originalModel: z.string().optional(),
  })
  .loose();

export const TaskSchema = z
  .object({
    pr: z.union([z.number().int(), z.string()]),
    title: z.string(),
    url: z.string().optional(),
    session: SessionSchema,
    baseCommit: z.string().min(7),
    finalHead: z.string().min(7),
    firstPushHead: z.string().optional(),
    taskStatement: z.string().min(1),
    taskStatementNotes: z.string().optional(),
    attachments: z.array(AttachmentSchema).default([]),
    diffStat: z.unknown().optional(),
    whyChosen: z.string().optional(),
  })
  .loose();

export type Task = z.infer<typeof TaskSchema>;
export type Session = z.infer<typeof SessionSchema>;

export function sessionId(session: Session): string | undefined {
  return session.id ?? session.threadId;
}

export function sessionModel(session: Session): string | undefined {
  return session.model ?? session.originalModel;
}

export async function loadTask(path: string): Promise<Task> {
  return TaskSchema.parse(await Bun.file(path).json());
}

export function attachmentPaths(task: Task): string[] {
  return task.attachments.map((attachment) => (typeof attachment === "string" ? attachment : attachment.path));
}
