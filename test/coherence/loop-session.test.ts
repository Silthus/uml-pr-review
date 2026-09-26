import { describe, expect, test } from "bun:test";
import { sessionInvocation, sessionRequest, type SessionOptions } from "../../coherence/loop/session.ts";
import { defaultRunsDirectory } from "../../coherence/loop/state.ts";

const options: SessionOptions = {
  repository: "/repos/posthog",
  scope: "products/workflows",
  budget: 1,
  draft: false,
  fetch: false,
  signals: "/runs/ci.json",
  model: "claude-opus-5-5",
  runs: "/runs",
  activeDays: 14,
  maxQuestions: 2,
};
const environment = { PATH: "/usr/bin", HOME: "/home/michael", ANTHROPIC_BASE_URL: "https://gateway.example", ANTHROPIC_AUTH_TOKEN: "secret", GH_TOKEN: "token" };

function flag(command: string[], name: string): string | undefined {
  return command[command.indexOf(name) + 1];
}

function rewrittenPushPrefixes(env: Record<string, string>): string[] {
  return Object.keys(env)
    .filter((key) => key.startsWith("GIT_CONFIG_KEY_") && env[key]!.endsWith(".pushInsteadOf"))
    .map((key) => env[key.replace("KEY", "VALUE")]!);
}

describe("the headless loop session", () => {
  test("a dry run rewrites every GitHub push URL and keeps git push and gh away from the agent", () => {
    const { command, prompt, env } = sessionInvocation(options, "SKILL", environment);

    expect(rewrittenPushPrefixes(env)).toEqual(["git@github.com:", "ssh://git@github.com/", "https://github.com/"]);
    expect(command.slice(command.indexOf("--disallowedTools") + 1)).toEqual(["Bash(git push:*)", "Bash(gh:*)", "Bash(curl:*github.com*)"]);
    expect(prompt).toContain("- Mode: dry run. Propose without --draft.");
  });

  test("runs Opus on Anthropic directly, with only local settings, no MCP servers, and the skill appended", () => {
    const { command, env } = sessionInvocation(options, "SKILL", environment);

    expect(flag(command, "--model")).toBe("claude-opus-5-5");
    expect(flag(command, "--setting-sources")).toBe("local");
    expect(flag(command, "--mcp-config")).toBe('{"mcpServers":{}}');
    expect(flag(command, "--append-system-prompt")).toBe("SKILL");
    expect(Object.keys(env)).not.toContain("ANTHROPIC_BASE_URL");
    expect(Object.keys(env)).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(env.HOME).toBe("/home/michael");
  });

  test("passes --runs, --active-days, and --max-questions through to sense, and lets the agent write to the runs directory", () => {
    const { options: parsed } = sessionRequest(["--repo", "/repos/posthog", "--scope", "products/workflows", "--runs", "/tmp/fresh-runs", "--active-days", "3", "--max-questions", "0"]);

    const { command, prompt } = sessionInvocation(parsed, "SKILL", environment);

    expect(prompt).toContain("- Sense: pass --runs /tmp/fresh-runs --active-days 3 --max-questions 0 to sense.");
    expect(command.filter((_, index) => command[index - 1] === "--add-dir")).toContain("/tmp/fresh-runs");
  });

  test("defaults to the committed runs directory, 14 active days, and 2 questions", () => {
    const { prompt } = sessionInvocation(sessionRequest(["--repo", "/repos/posthog", "--scope", "products/workflows"]).options, "SKILL", environment);

    expect(prompt).toContain(`- Sense: pass --runs ${defaultRunsDirectory} --active-days 14 --max-questions 2 to sense.`);
  });

  test("a draft session leaves pushes to the runner's propose --draft", () => {
    const { prompt, env } = sessionInvocation({ ...options, draft: true }, "SKILL", environment);

    expect(rewrittenPushPrefixes(env)).toEqual([]);
    expect(prompt).toContain("- Mode: draft. Propose with --draft.");
  });
});
