import { describe, expect, test } from "bun:test";
import { initProblem, invocationFor } from "../lib/invocation.ts";
import { TaskSchema } from "../lib/task.ts";

const task = TaskSchema.parse({
  pr: 1,
  title: "Search workflows",
  session: { source: "t3", id: "thread" },
  baseCommit: "8872766beaada4ca",
  finalHead: "45ea0221e13233e8",
  taskStatement: "Let the agent search workflows.",
  attachments: ["/tmp/screenshot.png"],
});

const environment = { PATH: "/usr/bin", ANTHROPIC_BASE_URL: "http://gateway", ANTHROPIC_MODEL: "gpt-5.5", CLAUDE_CODE_SUBAGENT_MODEL: "gpt-5.5", GITHUB_TOKEN: "secret", AI_GATEWAY_API_KEY: "secret", HOME: "/Users/me" };

function flagValue(command: string[], flag: string): string | undefined {
  const index = command.indexOf(flag);
  return index === -1 ? undefined : command[index + 1];
}

describe("replay invocations", () => {
  test("arm B sees no MCP server, no skill, no memory, no secrets, and only the task with the implement instruction", () => {
    const { command, prompt, env } = invocationFor(task, "B", "SKILL", environment);

    expect(command).toContain("--strict-mcp-config");
    expect(JSON.parse(flagValue(command, "--mcp-config")!)).toEqual({ mcpServers: {} });
    expect(command).not.toContain("--append-system-prompt");
    expect(flagValue(command, "--model")).toBe("claude-opus-5-5");
    expect(prompt).toBe("Let the agent search workflows.\n\nAttachments:\n- /tmp/screenshot.png\n\nImplement this in the working directory. Do not commit, push, or open a pull request.");
    expect(env).toMatchObject({ PATH: "/usr/bin", HOME: "/Users/me", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
    expect(Object.keys(env)).not.toContainAnyValues(["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL", "GITHUB_TOKEN", "AI_GATEWAY_API_KEY"]);
  });

  test("a replay can neither push nor write to GitHub, whatever its task statement asks", () => {
    for (const arm of ["B", "C"] as const) {
      const { command, env } = invocationFor(task, arm, "SKILL", environment);

      expect(env).toMatchObject({ GH_TOKEN: "blocked-by-benchmark", GIT_SSH_COMMAND: "false", GIT_CONFIG_KEY_0: "remote.origin.pushurl" });
      expect(env.GIT_CONFIG_VALUE_0).toStartWith("file:///dev/null/");
      expect(command).toContain("Bash(git push:*)");
      expect(command).toContain("Bash(gh:*)");
    }
  });

  test("arm C adds the architecture server, the skill, and standing approval to lock the plan", () => {
    const { command, prompt } = invocationFor(task, "C", "SKILL", environment);

    expect(JSON.parse(flagValue(command, "--mcp-config")!)).toEqual({ mcpServers: { "uml-pr-review": { type: "http", url: "http://127.0.0.1:4477/mcp" } } });
    expect(flagValue(command, "--append-system-prompt")).toBe("SKILL");
    expect(prompt.endsWith("Use the planning-architecture skill. You have standing approval to lock your plan once it is drafted.")).toBe(true);
  });

  test("a session on another model, with auto-memory, or with the wrong servers for its arm, is rejected at init", () => {
    const architecture = { tools: ["mcp__uml-pr-review__create_plan"], mcp_servers: [{ name: "uml-pr-review", status: "connected" }] };

    expect(initProblem({ model: "gpt-5.5" }, "B")).toBe("the session runs gpt-5.5, not claude-opus-5-5");
    expect(initProblem({ model: "claude-opus-5-5", tools: [], mcp_servers: [] }, "B")).toBeUndefined();
    expect(initProblem({ model: "claude-opus-5-5", memory_paths: { auto: "/Users/me/.claude/projects/posthog/memory/" } }, "B")).toBe("the session loads auto-memory from earlier sessions");
    expect(initProblem({ model: "claude-opus-5-5", ...architecture }, "B")).toBe("arm B can see an MCP server");
    expect(initProblem({ model: "claude-opus-5-5", ...architecture }, "C")).toBeUndefined();
    expect(initProblem({ model: "claude-opus-5-5", tools: [], mcp_servers: [{ name: "uml-pr-review", status: "failed" }] }, "C")).toBe("arm C has no connected uml-pr-review MCP server");
  });
});
