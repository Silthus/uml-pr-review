import { attachmentPaths, type Task } from "./task.ts";

export type ReplayArm = "B" | "C";

export const replayModel = "claude-opus-5-5";
export const architectureServer = { name: "uml-pr-review", url: "http://127.0.0.1:4477/mcp" };

const implementInstruction = "Implement this in the working directory. Do not commit, push, or open a pull request.";
const planningInstruction = "Use the planning-architecture skill. You have standing approval to lock your plan once it is drafted.";
const strippedEnvironment = /^(ANTHROPIC_|CLAUDE_CODE_)/;

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
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify({ mcpServers: servers }),
      ...(arm === "C" ? ["--append-system-prompt", skill] : []),
    ],
    prompt: promptFor(task, arm),
    env: Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined && !strippedEnvironment.test(entry[0]))),
  };
}

export type InitEvent = { model?: string; tools?: string[]; mcp_servers?: { name: string; status: string }[] };

export function initProblem(init: InitEvent, arm: ReplayArm): string | undefined {
  if (init.model !== replayModel) return `the session runs ${init.model ?? "an unknown model"}, not ${replayModel}`;
  const architectureTools = (init.tools ?? []).filter((tool) => tool.startsWith(`mcp__${architectureServer.name}__`));
  const connected = (init.mcp_servers ?? []).some(({ name, status }) => name === architectureServer.name && status === "connected");
  if (arm === "B" && (architectureTools.length > 0 || (init.mcp_servers ?? []).length > 0)) return "arm B can see an MCP server";
  if (arm === "C" && (!connected || architectureTools.length === 0)) return `arm C has no connected ${architectureServer.name} MCP server`;
  return undefined;
}
