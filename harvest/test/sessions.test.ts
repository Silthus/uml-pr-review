import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionLocations, userTurns } from "../lib/sessions.ts";

let root: string;
let locations: SessionLocations;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "harvest-sessions-"));
  locations = { t3Database: join(root, "state.sqlite"), claudeProjects: join(root, "claude"), codexSessions: join(root, "codex") };
  seedT3(locations.t3Database);
  await seedClaude(locations.claudeProjects);
  await seedCodex(locations.codexSessions);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("userTurns", () => {
  test("reads the human turns of sessions in the repository from all three stores", async () => {
    const turns = await userTurns(locations, "PostHog");

    expect(turns.map(({ source, sessionId, text, context }) => ({ source, sessionId, text, context }))).toEqual([
      { source: "t3", sessionId: "thread-1", text: "Keep the executor free of Django.", context: "Workflows wait node workflows/wait /work/posthog-wt" },
      { source: "claude-code", sessionId: "claude-1", text: "Use the facade instead.", context: "/work/posthog feat/workflows" },
      { source: "codex", sessionId: "codex-1", text: "Put it in the hogflow executor.", context: "/work/posthog-wt" },
    ]);
  });
});

function seedT3(path: string) {
  const database = new Database(path, { create: true });
  database.run("create table projection_projects (project_id text, workspace_root text)");
  database.run("create table projection_threads (thread_id text, project_id text, title text, branch text, worktree_path text)");
  database.run("create table projection_thread_messages (message_id text, thread_id text, role text, text text, created_at text)");
  database.run("insert into projection_projects values ('p1', '/work/posthog'), ('p2', '/work/fleet')");
  database.run("insert into projection_threads values ('thread-1', 'p1', 'Workflows wait node', 'workflows/wait', '/work/posthog-wt'), ('thread-2', 'p2', 'Fleet', null, null)");
  database.run(
    "insert into projection_thread_messages values ('m1', 'thread-1', 'user', 'Keep the executor free of Django.', '2026-09-01'), ('m2', 'thread-1', 'assistant', 'Done.', '2026-09-01'), ('m3', 'thread-2', 'user', 'Not PostHog.', '2026-09-01')",
  );
  database.close();
}

async function seedClaude(directory: string) {
  const project = join(directory, "-work-posthog");
  await mkdir(project, { recursive: true });
  const entries = [
    { type: "user", uuid: "u1", sessionId: "claude-1", timestamp: "2026-09-02", cwd: "/work/posthog", gitBranch: "feat/workflows", message: { content: "Use the facade instead." } },
    { type: "user", uuid: "u2", sessionId: "claude-1", isSidechain: true, message: { content: "Subagent prompt from the orchestrator." } },
    { type: "user", uuid: "u3", sessionId: "claude-1", message: { content: [{ type: "tool_result" }] } },
    { type: "assistant", uuid: "a1", sessionId: "claude-1", message: { content: "Sure." } },
  ];
  await Bun.write(join(project, "claude-1.jsonl"), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\nnot json\n`);
}

async function seedCodex(directory: string) {
  const day = join(directory, "2026", "09", "03");
  await mkdir(day, { recursive: true });
  const userMessage = (text: string) => ({ timestamp: "2026-09-03", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
  const session = (id: string, threadSource: unknown, text: string) =>
    [{ type: "session_meta", payload: { id, cwd: "/work/posthog-wt", thread_source: threadSource } }, userMessage(text)].map((entry) => JSON.stringify(entry)).join("\n");
  await Bun.write(join(day, "rollout-1.jsonl"), session("codex-1", "user", "Put it in the hogflow executor."));
  await Bun.write(join(day, "rollout-2.jsonl"), session("codex-2", { subagent: "worker" }, "Orchestrator instructions."));
}
