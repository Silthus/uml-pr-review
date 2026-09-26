import { describe, expect, test } from "bun:test";
import { correctionCandidates } from "../lib/corrections.ts";
import { DropLedger } from "../lib/items.ts";
import type { UserTurn } from "../lib/sessions.ts";

const terms = ["workflows", "hogflow"];

function turn(text: string, overrides: Partial<UserTurn> = {}): UserTurn {
  return { source: "t3", sessionId: "thread-1", turnId: "message-1", at: "2026-09-20T10:00:00Z", context: "Fix wait node /Users/me/.t3/worktrees/posthog/t3code-1", text, ...overrides };
}

describe("correctionCandidates", () => {
  test("keeps a scoped correction with injected agent context removed", () => {
    const text = "<system-reminder>You have skills.</system-reminder>\nDon't import the HogFlow model in the workflows API, go through the facade.";

    const items = correctionCandidates([turn(text)], terms, "Silthus", new DropLedger());

    expect(items).toEqual([
      {
        id: "session:t3/thread-1#message-1",
        source: "session",
        origin: "session:t3/thread-1",
        url: "local:t3/thread-1#message-1",
        author: "Silthus",
        isBot: false,
        path: null,
        line: null,
        body: "Don't import the HogFlow model in the workflows API, go through the facade.",
        at: "2026-09-20T10:00:00Z",
      },
    ]);
  });

  test("keeps the arguments of a slash command and drops its wrapper", () => {
    const text = "<command-message>unslop</command-message>\n<command-name>/unslop</command-name>\n<command-args>Put the hogflow retry logic in the executor, not in the consumer.</command-args>";

    const [item] = correctionCandidates([turn(text)], terms, "Silthus", new DropLedger());

    expect(item?.body).toBe("Put the hogflow retry logic in the executor, not in the consumer.");
  });

  test("uses the thread context to decide scope when the message does not name it", () => {
    const inWorkflowsThread = turn("Use the existing duration helper instead of parsing it again.", { context: "workflows: delay node" });
    const elsewhere = turn("Use the existing duration helper instead of parsing it again.", { sessionId: "thread-2", context: "error tracking: stack frames" });
    const drops = new DropLedger();

    expect(correctionCandidates([inWorkflowsThread], terms, "Silthus", new DropLedger())).toHaveLength(1);
    expect(correctionCandidates([elsewhere], terms, "Silthus", drops)).toEqual([]);
    expect(drops.entries()).toEqual([{ source: "session", reason: "neither the turn nor its thread mentions the scope", count: 1 }]);
  });

  test("drops process chatter, pure injected context, and the same turn seen in two session stores", () => {
    const correction = "Never call the Django ORM from the workflows executor.";
    const turns = [
      turn(correction),
      turn(correction, { source: "claude-code", sessionId: "session-9" }),
      turn("Great, workflows PR looks good, merge it when CI is green."),
      turn("<task-notification>Agent finished.</task-notification>"),
    ];
    const drops = new DropLedger();

    const items = correctionCandidates(turns, terms, "Silthus", drops);

    expect(items.map(({ body }) => body)).toEqual([correction]);
    expect(drops.entries()).toEqual([
      { source: "session", reason: "empty after removing injected context (skills, reminders, notifications)", count: 1 },
      { source: "session", reason: "duplicate of a turn seen in another session store", count: 1 },
      { source: "session", reason: "no correcting or constraining language", count: 1 },
    ]);
  });
});
