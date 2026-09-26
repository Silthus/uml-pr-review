import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as LegacyTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpRoute } from "./mcp.ts";

const mcp = createMcpRoute((activity) => console.log("  activity", JSON.stringify(activity)));
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  routes: {
    "/api/health": () => Response.json({ ok: true }),
    "/mcp": mcp.fetch,
  },
});
const endpoint = new URL("/mcp", server.url);
console.log(`Bun ${Bun.version} serving MCP at ${endpoint}`);

type ToolClient = {
  listTools(): Promise<{ tools: { name: string; inputSchema: unknown; outputSchema?: unknown }[] }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
};

async function roundTrip(label: string, client: ToolClient) {
  console.log(`\n== ${label}`);
  const { tools } = await client.listTools();
  console.log("tools/list", JSON.stringify(tools.map(({ name, inputSchema, outputSchema }) => ({ name, inputSchema, outputSchema }))));
  console.log("tools/call ok", JSON.stringify(await client.callTool({ name: "describe_module", arguments: { path: "src/web" } })));
  console.log("tools/call miss", JSON.stringify(await client.callTool({ name: "describe_module", arguments: { path: "nope" } })));
  console.log("tools/call bad args", JSON.stringify(await client.callTool({ name: "describe_module", arguments: { path: 42 } })));
  await client.close();
}

const toolsChanged = Promise.withResolvers<string[]>();
const modern = new Client(
  { name: "spike-modern", version: "2.1.0" },
  {
    versionNegotiation: { mode: "auto" },
    listChanged: { tools: { onChanged: (error, tools) => (error ? toolsChanged.reject(error) : toolsChanged.resolve((tools ?? []).map((tool) => tool.name))) } },
  },
);
await modern.connect(new StreamableHTTPClientTransport(endpoint));
console.log(`\nmodern negotiated protocol ${modern.getNegotiatedProtocolVersion()}`);
await Bun.sleep(100);
mcp.notify.toolsChanged();
console.log("notifications/tools/list_changed via subscriptions/listen ->", await Promise.race([toolsChanged.promise, Bun.sleep(2000).then(() => "not delivered")]));
await roundTrip("v2 client (@modelcontextprotocol/client 2.1.0, versionNegotiation auto -> 2026-07-28 wire)", modern as unknown as ToolClient);

const legacy = new LegacyClient({ name: "spike-legacy", version: "1.30.1" });
await legacy.connect(new LegacyTransport(endpoint));
console.log(`\nlegacy negotiated protocol ${legacy.transport && (legacy.transport as LegacyTransport).protocolVersion}`);
await roundTrip("v1 client (@modelcontextprotocol/sdk 1.30.1, 2025-era wire, as Codex 0.157 speaks)", legacy as unknown as ToolClient);

const foreignHost = await fetch(endpoint, { method: "POST", headers: { host: "evil.example", "content-type": "application/json" }, body: "{}" });
console.log(`\nDNS-rebinding guard: Host evil.example -> ${foreignHost.status}`);
const getStream = await fetch(endpoint, { headers: { accept: "text/event-stream" } });
console.log(`Standalone GET SSE stream (legacy stateless) -> ${getStream.status}`);

await server.stop(true);
