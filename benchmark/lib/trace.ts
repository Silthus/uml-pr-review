import { Database } from "bun:sqlite";

export type TraceEvent = { at?: number } & ({ kind: "tool"; name: string; input: unknown; edit: boolean } | { kind: "text"; text: string } | { kind: "prompt" });

type Json = Record<string, unknown>;

const editTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"]);
const shellWrite = /apply_patch|\bsed\s+-i\b|\bperl\s+-p?i\b|\btee\s+(?!\/tmp|\/dev)["']?[\w.]|(?:^|[^>&\d=-])>>?\s*(?!\/tmp|\/dev|&)["']?[\w.][\w./-]*/;

export function parseJsonLines(text: string): Json[] {
  return text.split("\n").flatMap((line) => {
    if (!line.trim().startsWith("{")) return [];
    try {
      return [JSON.parse(line) as Json];
    } catch {
      return [];
    }
  });
}

export function claudeTrace(records: Json[]): TraceEvent[] {
  return records.flatMap((record) => {
    const at = timeOf(record.timestamp);
    const content = (record.message as Json | undefined)?.content;
    if (record.type === "user") return typeof content === "string" ? [{ at, kind: "prompt" as const }] : [];
    if (record.type !== "assistant" || !Array.isArray(content)) return [];
    return (content as Json[]).flatMap((block): TraceEvent[] => {
      if (block.type === "tool_use") return [toolEvent(at, String(block.name), block.input)];
      const text = block.type === "text" ? block.text : block.type === "thinking" ? block.thinking : undefined;
      return typeof text === "string" && text.trim() ? [{ at, kind: "text", text }] : [];
    });
  });
}

export function codexTrace(records: Json[]): TraceEvent[] {
  return records.flatMap((record): TraceEvent[] => {
    const at = timeOf(record.timestamp);
    const payload = record.payload as Json | undefined;
    if (record.type !== "response_item" || !payload) return [];
    if (payload.type === "function_call") return [toolEvent(at, String(payload.name), payload.arguments)];
    if (payload.type === "custom_tool_call") return [toolEvent(at, String(payload.name), payload.input)];
    if (payload.type === "message" && payload.role === "user") return [{ at, kind: "prompt" }];
    if (payload.type === "message" && payload.role === "assistant") return textEvents(at, payload.content, "text");
    if (payload.type === "reasoning") return textEvents(at, payload.summary, "text");
    return [];
  });
}

export function t3Trace(databasePath: string, threadId: string): TraceEvent[] {
  const database = new Database(databasePath, { readonly: true });
  try {
    const activities = database
      .query<{ payload: string; created_at: string }, [string]>("select payload_json as payload, created_at from projection_thread_activities where thread_id = ? and kind = 'tool.completed'")
      .all(threadId);
    const messages = database.query<{ role: string; text: string; created_at: string }, [string]>("select role, text, created_at from projection_thread_messages where thread_id = ?").all(threadId);
    const events: TraceEvent[] = [...activities.map(t3ToolEvent), ...messages.map(t3MessageEvent)];
    return events.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  } finally {
    database.close();
  }
}

function t3ToolEvent({ payload, created_at }: { payload: string; created_at: string }): TraceEvent {
  const parsed = JSON.parse(payload) as { itemType?: string; detail?: string; data?: { toolName?: string; input?: unknown } };
  const name = parsed.data?.toolName || parsed.itemType || "tool";
  const fileChange = parsed.itemType === "file_change" && !name.startsWith("Cron");
  return toolEvent(Date.parse(created_at), name, parsed.data?.input ?? parsed.detail ?? null, fileChange);
}

function t3MessageEvent({ role, text, created_at }: { role: string; text: string; created_at: string }): TraceEvent {
  const at = Date.parse(created_at);
  return role === "user" ? { at, kind: "prompt" } : { at, kind: "text", text };
}

function toolEvent(at: number | undefined, name: string, input: unknown, fileChange = false): TraceEvent {
  return { at, kind: "tool", name, input, edit: fileChange || editTools.has(name) || shellWrite.test(commandOf(input)) };
}

function commandOf(input: unknown): string {
  if (typeof input === "string") return input;
  const command = (input as Json | null)?.command;
  return Array.isArray(command) ? command.join(" ") : typeof command === "string" ? command : "";
}

function textEvents(at: number | undefined, parts: unknown, kind: "text"): TraceEvent[] {
  if (!Array.isArray(parts)) return [];
  return (parts as Json[]).flatMap((part) => (typeof part.text === "string" && part.text.trim() ? [{ at, kind, text: part.text }] : []));
}

function timeOf(value: unknown): number | undefined {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? undefined : time;
}
