import { describe, expect, test } from "bun:test";
import { processMetrics } from "../lib/process-metrics.ts";
import { claudeTrace } from "../lib/trace.ts";

const start = Date.parse("2026-09-26T10:00:00Z");

function assistant(seconds: number, ...content: object[]) {
  return { type: "assistant", timestamp: new Date(start + seconds * 1000).toISOString(), message: { content } };
}

const tool = (name: string, input: object) => ({ type: "tool_use", name, input });
const text = (value: string) => ({ type: "text", text: value });

describe("process metrics from a Claude Code transcript", () => {
  test("measure the exploration and reasoning an agent does before its first edit", () => {
    const trace = claudeTrace([
      assistant(5, text("Let me look at how the repository is laid out.")),
      assistant(10, tool("mcp__uml-pr-review__get_architecture_overview", {})),
      assistant(20, tool("Read", { file_path: "products/architecture.md" }), tool("Bash", { command: 'grep -rn "def search() -> str" ee/' })),
      assistant(30, text("Other products may only import the workflows facade. The new seam goes from ee/hogai to products/workflows through backend/facade/api.py.")),
      assistant(42, tool("Edit", { file_path: "products/workflows/backend/facade/api.py" })),
      assistant(50, tool("Bash", { command: "cat > ee/hogai/search.py <<'EOF'\nprint()\nEOF" })),
    ]);

    expect(processMetrics(trace, start)).toEqual({
      toolCalls: 5,
      edits: 2,
      toolCallsBeforeFirstEdit: 3,
      secondsBeforeFirstEdit: 42,
      architectureToolCalls: 1,
      architectureExplorationBeforeEdit: 2,
      architectureReasoningBeforeEdit: 1,
      firstArchitectureThought: "Other products may only import the workflows facade.",
    });
  });

  test("count a shell redirect into a source file as the first edit", () => {
    const trace = claudeTrace([assistant(3, tool("Bash", { command: "printf 'x' >> products/workflows/backend/facade/api.py" }))]);

    expect(processMetrics(trace, start)).toMatchObject({ edits: 1, toolCallsBeforeFirstEdit: 0, secondsBeforeFirstEdit: 3, firstArchitectureThought: null });
  });
});
