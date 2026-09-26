import { Database } from "bun:sqlite";
import { Glob } from "bun";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";

export type SessionSource = "t3" | "claude-code" | "codex";

export type UserTurn = { source: SessionSource; sessionId: string; turnId: string; at: string; context: string; text: string };

export type SessionLocations = { t3Database: string; claudeProjects: string; codexSessions: string };

export function defaultSessionLocations(home = homedir()): SessionLocations {
  return { t3Database: join(home, ".t3", "userdata", "state.sqlite"), claudeProjects: join(home, ".claude", "projects"), codexSessions: join(home, ".codex", "sessions") };
}

export async function userTurns(locations: SessionLocations, repositoryHint: string): Promise<UserTurn[]> {
  return [...(await t3Turns(locations.t3Database, repositoryHint)), ...(await claudeTurns(locations.claudeProjects, repositoryHint)), ...(await codexTurns(locations.codexSessions, repositoryHint))];
}

const t3RowSchema = z.object({ message_id: z.string(), thread_id: z.string(), created_at: z.string(), text: z.string(), title: z.string(), branch: z.string().nullable(), root: z.string() });

async function t3Turns(databasePath: string, hint: string): Promise<UserTurn[]> {
  if (!(await Bun.file(databasePath).exists())) return [];
  const database = new Database(databasePath, { readonly: true });
  try {
    const rows = database
      .query(
        `select m.message_id, m.thread_id, m.created_at, m.text, t.title, t.branch, coalesce(t.worktree_path, p.workspace_root) as root
         from projection_thread_messages m join projection_threads t on t.thread_id = m.thread_id join projection_projects p on p.project_id = t.project_id
         where m.role = 'user' and (p.workspace_root like ?1 or t.worktree_path like ?1)`,
      )
      .all(`%${hint}%`);
    return z.array(t3RowSchema).parse(rows).map((row) => ({ source: "t3", sessionId: row.thread_id, turnId: row.message_id, at: row.created_at, context: [row.title, row.branch ?? "", row.root].join(" "), text: row.text }));
  } finally {
    database.close();
  }
}

const claudeEntrySchema = z.object({
  type: z.string(),
  uuid: z.string().optional(),
  sessionId: z.string().optional(),
  timestamp: z.string().optional(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  isSidechain: z.boolean().optional(),
  isMeta: z.boolean().optional(),
  message: z.object({ content: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string().optional() }))]) }).optional(),
});

async function claudeTurns(projectsDirectory: string, hint: string): Promise<UserTurn[]> {
  const turns: UserTurn[] = [];
  for (const path of new Glob(`*${hint}*/*.jsonl`).scanSync({ cwd: projectsDirectory, absolute: true, onlyFiles: true })) {
    for (const entry of await jsonLines(path, claudeEntrySchema)) {
      if (entry.type !== "user" || entry.isSidechain || entry.isMeta || !entry.message) continue;
      const text = typeof entry.message.content === "string" ? entry.message.content : entry.message.content.flatMap(({ type, text }) => (type === "text" && text ? [text] : [])).join("\n");
      if (text.length === 0) continue;
      turns.push({ source: "claude-code", sessionId: entry.sessionId ?? basename(path, ".jsonl"), turnId: entry.uuid ?? "", at: entry.timestamp ?? "", context: [entry.cwd ?? "", entry.gitBranch ?? ""].join(" "), text });
    }
  }
  return turns;
}

const codexEntrySchema = z.object({
  timestamp: z.string().optional(),
  type: z.string(),
  payload: z.object({ type: z.string().optional(), role: z.string().optional(), id: z.string().optional(), cwd: z.string().optional(), thread_source: z.unknown().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() }).passthrough(),
});

async function codexTurns(sessionsDirectory: string, hint: string): Promise<UserTurn[]> {
  const turns: UserTurn[] = [];
  for (const path of new Glob("**/*.jsonl").scanSync({ cwd: sessionsDirectory, absolute: true, onlyFiles: true })) {
    const entries = await jsonLines(path, codexEntrySchema);
    const meta = entries.find(({ type }) => type === "session_meta")?.payload;
    if (!meta?.cwd?.includes(hint) || meta.thread_source !== "user") continue;
    entries.forEach((entry, index) => {
      if (entry.type !== "response_item" || entry.payload.type !== "message" || entry.payload.role !== "user") return;
      const text = (entry.payload.content ?? []).flatMap(({ type, text }) => (type === "input_text" && text ? [text] : [])).join("\n");
      turns.push({ source: "codex", sessionId: meta.id ?? basename(path, ".jsonl"), turnId: String(index), at: entry.timestamp ?? "", context: meta.cwd ?? "", text });
    });
  }
  return turns;
}

async function jsonLines<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const lines = (await Bun.file(path).text()).split("\n");
  return lines.flatMap((line) => {
    if (line.trim().length === 0) return [];
    const parsed = schema.safeParse(safeJson(line));
    return parsed.success ? [parsed.data] : [];
  });
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
