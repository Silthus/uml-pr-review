import { initProblem, type InitEvent, type Invocation, type ReplayArm } from "./invocation.ts";
import type { ExitReason } from "./meta.ts";

export type ResultEvent = { num_turns?: number; total_cost_usd?: number; duration_ms?: number; is_error?: boolean; session_id?: string };

export type AgentOutcome = {
  reason: ExitReason;
  code: number | null;
  detail?: string;
  model: string | null;
  sessionId: string | null;
  result: ResultEvent | null;
};

export type AgentRunRequest = { invocation: Invocation; arm: ReplayArm; cwd: string; transcriptPath: string; stderrPath: string; timeoutMs: number };

const killGraceMs = 10_000;

export async function runAgent({ invocation, arm, cwd, transcriptPath, stderrPath, timeoutMs }: AgentRunRequest): Promise<AgentOutcome> {
  const child = Bun.spawn(invocation.command, {
    cwd,
    env: invocation.env,
    stdin: new TextEncoder().encode(invocation.prompt),
    stdout: "pipe",
    stderr: Bun.file(stderrPath),
  });
  let stopped: { reason: ExitReason; detail: string } | undefined;
  const stop = (reason: ExitReason, detail: string) => {
    stopped ??= { reason, detail };
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), killGraceMs).unref();
  };
  const timer = setTimeout(() => stop("timed-out", `killed after ${timeoutMs / 60_000} minutes`), timeoutMs);
  const events = { init: null as InitEvent | null, sessionId: null as string | null, result: null as ResultEvent | null };
  const transcript = Bun.file(transcriptPath).writer();
  try {
    for await (const line of lines(child.stdout)) {
      transcript.write(`${line}\n`);
      const event = parsed(line);
      if (event?.type === "system" && event.subtype === "init") {
        events.init = event as InitEvent;
        events.sessionId = typeof event.session_id === "string" ? event.session_id : null;
        const problem = initProblem(events.init, arm);
        if (problem) stop("invalid-setup", problem);
      }
      if (event?.type === "result") events.result = event as ResultEvent;
    }
    const code = await child.exited;
    return {
      reason: stopped?.reason ?? (code === 0 && !events.result?.is_error ? "completed" : "failed"),
      code,
      detail: stopped?.detail,
      model: events.init?.model ?? null,
      sessionId: events.sessionId,
      result: events.result,
    };
  } finally {
    clearTimeout(timer);
    await transcript.end();
  }
}

async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffered = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    buffered += decoder.decode(chunk.value, { stream: true });
    const complete = buffered.split("\n");
    buffered = complete.pop()!;
    yield* complete.filter((line) => line.length > 0);
  }
  if (buffered.length > 0) yield buffered;
}

function parsed(line: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
