# Spike: MCP over Streamable HTTP inside `Bun.serve({ routes })`

Findings: [`../../mcp-over-http-in-bun.md`](../../mcp-over-http-in-bun.md).

```sh
bun install
bun run spike.ts   # SDK clients (2026-07-28 and 2025 wire) against an in-process server
bun run serve.ts   # long-running server on 127.0.0.1:4478/mcp for driving with claude or codex
```

- `mcp.ts`: the server factory and the `/mcp` route handler.
- `spike.ts`: `tools/list`, `tools/call` (success, tool error, invalid arguments) and `tools/list_changed`.
- `serve.ts`: the same route with a request log, used to point real Claude Code and Codex at it.
