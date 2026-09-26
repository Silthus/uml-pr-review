import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";

export type Activity = {
  era: McpRequestContext["era"];
  method: string;
  userAgent: string | null;
  sessionHeader: string | null;
  clientFromInitialize: string | null;
  envelopeKeys: string[];
};

const modules = new Map<string, { kind: "folder" | "package"; files: number }>([
  ["src/web", { kind: "folder", files: 4 }],
  ["src", { kind: "package", files: 9 }],
]);

export function createMcpRoute(onActivity: (activity: Activity) => void) {
  const handler = createMcpHandler((context) => createServer(context, onActivity));
  const fetch = (request: Request) =>
    hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
    originValidationResponse(request, localhostAllowedOrigins()) ??
    handler.fetch(request);
  return { fetch, notify: handler.notify };
}

function createServer(context: McpRequestContext, onActivity: (activity: Activity) => void) {
  const server = new McpServer({ name: "uml-pr-review", version: "0.0.0" });

  server.registerTool(
    "describe_module",
    {
      title: "Describe module",
      description: "Returns the kind and file count of one module path.",
      inputSchema: z.object({ path: z.string().describe("Module path relative to the repository root") }),
      outputSchema: z.object({ path: z.string(), kind: z.enum(["folder", "package"]), files: z.number().int() }),
    },
    async ({ path }, ctx) => {
      onActivity({
        era: context.era,
        method: ctx.mcpReq.method,
        userAgent: context.requestInfo?.headers.get("user-agent") ?? null,
        sessionHeader: context.requestInfo?.headers.get("mcp-session-id") ?? null,
        clientFromInitialize: describeClient(server),
        envelopeKeys: Object.keys(ctx.mcpReq.envelope ?? {}),
      });
      const module = modules.get(path);
      if (!module) {
        return {
          isError: true,
          content: [{ type: "text", text: `No module at "${path}". Known modules: ${[...modules.keys()].join(", ")}.` }],
        };
      }
      const output = { path, ...module };
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    },
  );

  return server;
}

function describeClient(server: McpServer) {
  const client = server.server.getClientVersion();
  return client ? `${client.name}@${client.version}` : null;
}
