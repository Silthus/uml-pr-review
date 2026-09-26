import type { Client } from "@modelcontextprotocol/client";

export type ToolResult = { isError: boolean; text: string; structured: any };

export function agentTools(client: Client, worktree: string) {
  return async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const result = await client.callTool({ name, arguments: { worktree, ...args } });
    const text = result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
    return { isError: result.isError === true, text, structured: result.structuredContent };
  };
}
