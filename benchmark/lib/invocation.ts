import { attachmentPaths, type Task } from "./task.ts";

export type ReplayArm = "B" | "C";

export const replayModel = "claude-opus-5-5";
export const architectureServer = { name: "uml-pr-review", url: "http://127.0.0.1:4477/mcp" };

const implementInstruction = "Implement this in the working directory. Do not commit, push, or open a pull request.";
const planningInstruction = "Use the planning-architecture skill. You have standing approval to lock your plan once it is drafted.";
const inheritedEnvironment = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR"];
const blockedPushTarget = "file:///dev/null/pushes-are-blocked-in-benchmark-replays/";
const githubPushPrefixes = ["git@github.com:", "ssh://git@github.com/", "https://github.com/"];
export const githubPushGuard = gitConfigEnvironment(githubPushPrefixes.map((prefix) => [`url.${blockedPushTarget}.pushInsteadOf`, prefix]));
const isolatedEnvironment = {
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  GH_TOKEN: "blocked-by-benchmark",
  GIT_SSH_COMMAND: "false",
  GIT_TERMINAL_PROMPT: "0",
  ...githubPushGuard,
};
const githubSandbox = {
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    network: { deniedDomains: ["github.com", "*.github.com", "api.github.com", "*.githubusercontent.com"] },
  },
};
const outwardTools = ["Bash(git push:*)", "Bash(gh:*)", "Bash(curl:*api.github.com*)"];

function gitConfigEnvironment(entries: [string, string][]): Record<string, string> {
  return Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(entries.length)],
    ...entries.flatMap(([key, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, key],
      [`GIT_CONFIG_VALUE_${index}`, value],
    ]),
  ]);
}

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
      "--settings",
      JSON.stringify(githubSandbox),
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
