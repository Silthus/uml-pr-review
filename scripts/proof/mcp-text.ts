import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const [mcpUrl, tool, argumentsJson = "{}"] = process.argv.slice(2);
if (!mcpUrl || !tool) throw new Error("Usage: bun scripts/proof/mcp-text.ts <mcp url> <tool> '<arguments JSON>'");

const client = new Client({ name: "uml-pr-review-proof", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
const result = await client.callTool({ name: tool, arguments: JSON.parse(argumentsJson) });
await client.close();

const text = result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
if (result.isError) {
  console.error(text);
  process.exit(1);
}
console.log(text);
