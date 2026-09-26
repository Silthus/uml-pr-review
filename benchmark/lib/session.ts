import { Glob } from "bun";
import { homedir } from "node:os";
import { join } from "node:path";
import { sessionId, type Session } from "./task.ts";
import { claudeTrace, codexTrace, parseJsonLines, t3Trace, type TraceEvent } from "./trace.ts";

const home = homedir();

export async function sessionTrace(session: Session): Promise<TraceEvent[] | undefined> {
  const transcript = session.transcript ?? (await searchedTranscript(session));
  if (transcript) return transcriptTrace(transcript);
  const id = sessionId(session);
  if (!session.source.startsWith("t3") || !id) return undefined;
  const trace = t3Trace(join(home, ".t3", "userdata", "state.sqlite"), id);
  return trace.length > 0 ? trace : undefined;
}

async function transcriptTrace(path: string): Promise<TraceEvent[] | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  const records = parseJsonLines(await file.text());
  return path.includes("/.codex/") ? codexTrace(records) : claudeTrace(records);
}

async function searchedTranscript(session: Session): Promise<string | undefined> {
  const id = sessionId(session);
  if (!id) return undefined;
  if (session.source === "claude") return firstMatch(join(home, ".claude", "projects"), `*/${id}.jsonl`);
  if (session.source === "codex") return firstMatch(join(home, ".codex", "sessions"), `**/*${id}*.jsonl`);
  return undefined;
}

async function firstMatch(directory: string, pattern: string): Promise<string | undefined> {
  for await (const path of new Glob(pattern).scan({ cwd: directory, absolute: true })) return path;
  return undefined;
}
