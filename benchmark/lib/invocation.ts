import { attachmentPaths, type Task } from "./task.ts";

export type ReplayArm = "B" | "C";

export const replayModel = "claude-opus-5-5";
export const architectureServer = { name: "uml-pr-review", url: "http://127.0.0.1:4477/mcp" };

const implementInstruction = "Implement this in the working directory. Do not commit, push, or open a pull request.";
const planningInstruction = "Use the planning-architecture skill. You have standing approval to lock your plan once it is drafted.";
const inheritedEnvironment = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR"];
const isolatedEnvironment = {
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  GH_TOKEN: "blocked-by-benchmark",
  GH_CONFIG_DIR: "/tmp/bench-gh-config-empty",
  GIT_SSH_COMMAND: "false",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "remote.origin.pushurl",
  GIT_CONFIG_VALUE_0: "file:///dev/null/pushes-are-blocked-in-benchmark-replays",
};
const outwardTools = ["Bash(git push:*)", "Bash(gh:*)", "Bash(curl:*api.github.com*)"];

export type Invocation = { command: string[]; prompt: string; env: Record<string, string> };

export function promptFor(task: Task, arm: ReplayArm): string {
  const attachments = attachmentPaths(task);
  return [
    task.taskStatement.trim(),
    attachments.length > 0 ? `Attachments:\n${attachments.map((path) => `- ${path}`).join("\n")}` : undefined,
    implementInstruction,
    arm === "C" ? planningInstruction : undefined,
  ]
    .filter((part) => part !== undefined)
    .join("\n\n");
}

export function invocationFor(task: Task, arm: ReplayArm, skill: string, environment: Record<string, string | undefined>): Invocation {
  const servers = arm === "C" ? { [architectureServer.name]: { type: "http", url: architectureServer.url } } : {};
  return {
    command: [
      "claude",
      "-p",
      "--model",
      replayModel,
      "--setting-sources",
      "local",
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "stream-json",
      "--verbose",
      "--disallowedTools",
      ...outwardTools,
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify({ mcpServers: servers }),
      ...(arm === "C" ? ["--append-system-prompt", skill] : []),
    ],
    prompt: promptFor(task, arm),
    env: { ...Object.fromEntries(inheritedEnvironment.flatMap((name) => (environment[name] === undefined ? [] : [[name, environment[name]]]))), ...isolatedEnvironment },
  };
}

export type InitEvent = { model?: string; tools?: string[]; mcp_servers?: { name: string; status: string }[]; memory_paths?: Record<string, string> };

export function initProblem(init: InitEvent, arm: ReplayArm): string | undefined {
  if (init.model !== replayModel) return `the session runs ${init.model ?? "an unknown model"}, not ${replayModel}`;
  if (Object.keys(init.memory_paths ?? {}).length > 0) return "the session loads auto-memory from earlier sessions";
  const architectureTools = (init.tools ?? []).filter((tool) => tool.startsWith(`mcp__${architectureServer.name}__`));
  const connected = (init.mcp_servers ?? []).some(({ name, status }) => name === architectureServer.name && status === "connected");
  if (arm === "B" && (architectureTools.length > 0 || (init.mcp_servers ?? []).length > 0)) return "arm B can see an MCP server";
  if (arm === "C" && (!connected || architectureTools.length === 0)) return `arm C has no connected ${architectureServer.name} MCP server`;
  return undefined;
}
