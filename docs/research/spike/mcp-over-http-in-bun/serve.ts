import { createMcpRoute } from "./mcp.ts";

const mcp = createMcpRoute((activity) => console.log("activity", JSON.stringify(activity)));

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4478),
  hostname: "127.0.0.1",
  routes: {
    "/mcp": async (request) => {
      const body = request.method === "POST" ? await request.clone().text() : "";
      const method = body ? (JSON.parse(body) as { method?: string }).method : undefined;
      const response = await mcp.fetch(request);
      console.log(
        request.method,
        method ?? "-",
        response.status,
        `ua=${request.headers.get("user-agent")}`,
        `protocol=${request.headers.get("mcp-protocol-version")}`,
      );
      if (method === "initialize") console.log("  initialize", body);
      return response;
    },
  },
});

console.log(`MCP at ${new URL("/mcp", server.url)}`);
