# MCP over Streamable HTTP inside the Bun server

Research for [#16](https://github.com/Silthus/uml-pr-review/issues/16), part of [#15](https://github.com/Silthus/uml-pr-review/issues/15). Researched 2026-09-26 against Bun 1.4.2, Claude Code 2.1.282, and Codex CLI 0.157.0.

## Answer

Use the v2 TypeScript SDK: `@modelcontextprotocol/server@2.1.0` with `createMcpHandler(factory)`. It returns a web-standard `{ fetch, notify, bus, close }` object whose `fetch(request: Request): Promise<Response>` drops straight into `Bun.serve({ routes: { "/mcp": ... } })`. No Node `req`/`res` shim, no session map, no transport bookkeeping. Put the SDK's Host and Origin guards in front of it, because the handler validates neither.

One handler serves both protocol eras from one factory:

- **2026-07-28 (modern, stateless by design).** Claude Code 2.1.282 speaks it. Every request carries the client identity in its `_meta` envelope, and the client holds a `subscriptions/listen` stream open, so `handler.notify.toolsChanged()` reaches it.
- **2025 (legacy).** Codex 0.157.0 speaks `2025-06-18`. The handler answers it statelessly (a fresh server per request). Tools work. The server cannot push anything outside a request, and a `tools/call` does not know which client sent it except through the `User-Agent` header.

Both real clients were pointed at the spike and completed `tools/list` plus `tools/call` (success and tool error). Registration needs nothing special for `127.0.0.1` without auth, except that Codex blocks MCP tool calls until they are approved (`default_tools_approval_mode = "approve"`).

## SDK: which package and which class

| | v1 | v2 (use this) |
| --- | --- | --- |
| Package | `@modelcontextprotocol/sdk@1.30.1` | `@modelcontextprotocol/server@2.1.0`, `@modelcontextprotocol/client@2.1.0` (plus `@modelcontextprotocol/core`) |
| Status | previous line | "v2 is the stable release line, implementing the 2026-07-28 MCP spec" (package README) |
| Web-standard entry | `WebStandardStreamableHTTPServerTransport` | `createMcpHandler(factory, options)`; the transport class `WebStandardStreamableHTTPServerTransport` is still exported for hand-wired sessionful legacy serving |
| Schemas | zod 3 / `zod/v4` | Standard Schema; `zod: ^4.2.0` is a dependency of the server package, zod 4 `z.object(...)` passes directly |

Sources: package READMEs and `.d.mts` typings of `@modelcontextprotocol/server@2.1.0` and `@modelcontextprotocol/client@2.1.0` (published 2026-09-23); [repository README](https://github.com/modelcontextprotocol/typescript-sdk#readme) ("v1.x continues to receive bug fixes and security updates for at least 6 months after v2's release"); [Serving guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http); [`docs/serving/legacy-clients.md`](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md); [migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md).

v2 drops zod 3. zod 4.2 or later converts itself to JSON Schema; on 4.0 and 4.1 the SDK falls back to its own converter and drops `.describe()` text (migration guide, "Standard Schema objects"). The repo is on zod 4.6.5, so this does not bite.

If v1 were ever needed: `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js` exports `WebStandardStreamableHTTPServerTransport` with `handleRequest(req: Request): Promise<Response>`, and in stateless mode it throws "Stateless transport cannot be reused across requests" unless a new server and transport are built per request. `createMcpHandler` does exactly that for us.

What `createMcpHandler` does (from its typings, `createMcpHandler-*.d.mts`):

- Calls the factory **once per HTTP request** with `{ era: "legacy" | "modern", authInfo?, requestInfo?: Request }`. The factory builds a fresh `McpServer`; tools are defined once and served to both eras.
- `legacy: "stateless"` (default) answers 2025-era traffic with a fresh instance over a transport built with `sessionIdGenerator: undefined`. GET and DELETE (2025 session operations) get `405`. `legacy: "reject"` turns 2025 traffic away.
- `responseMode: "auto"` (default) answers with one JSON body, upgrading to SSE only if the handler emits a related message (progress, logging) before its result. `"json"` drops those mid-call notifications.
- `notify` publishes `toolsChanged()`, `promptsChanged()`, `resourcesChanged()`, `resourceUpdated(uri)` to every open `subscriptions/listen` stream. The default bus is in-process (`InMemoryServerEventBus`), which matches our one-process design.
- It "performs no token verification" and is "deliberately validation-free": put `hostHeaderValidationResponse(request, localhostAllowedHostnames()) ?? originValidationResponse(request, localhostAllowedOrigins())` in front. The Serving guide: "the `Host` check is what stops DNS rebinding".

## Minimal wiring

The whole route, as proven in [`spike/mcp-over-http-in-bun/mcp.ts`](spike/mcp-over-http-in-bun/mcp.ts):

```ts
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { z } from "zod";

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "uml-pr-review", version: "0.0.0" });
  server.registerTool(
    "describe_module",
    {
      title: "Describe module",
      description: "Returns the kind and file count of one module path.",
      inputSchema: z.object({ path: z.string().describe("Module path relative to the repository root") }),
      outputSchema: z.object({ path: z.string(), kind: z.enum(["folder", "package"]), files: z.number().int() }),
    },
    async ({ path }) => {
      const module = modules.get(path);
      if (!module) {
        return { isError: true, content: [{ type: "text", text: `No module at "${path}". Known modules: ${[...modules.keys()].join(", ")}.` }] };
      }
      const output = { path, ...module };
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    },
  );
  return server;
});

Bun.serve({
  hostname: "127.0.0.1",
  port: 4477,
  routes: {
    "/mcp": (request) =>
      hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
      originValidationResponse(request, localhostAllowedOrigins()) ??
      handler.fetch(request),
  },
});
```

A route with a bare function answers every method, which is what the handler needs (POST for messages, GET/DELETE for the 405s).

Keep `idleTimeout: 255` in `Bun.serve` (already set in `src/server.ts`). Bun's default is 10 seconds and closes a quiet response mid-stream ([Bun HTTP server docs](https://bun.com/docs/runtime/http/server)), while the handler's SSE keepalive (`keepAliveMs`) defaults to 15 seconds. With the default, Claude Code's `subscriptions/listen` stream would be cut every 10 seconds.

Because the factory runs per request, anything shared (the architecture index, the plan store, the event bus for the explorer) lives outside the factory and is closed over. That fits the "one process, one in-memory state" decision in #15.

## Tools, schemas, and errors

- `registerTool(name, { title, description, inputSchema, outputSchema, annotations }, callback)`. With zod 4 pass `z.object(...)`; the raw-shape form (`{ path: z.string() }`) still works but is `@deprecated`.
- zod 4 schemas are emitted as JSON Schema draft 2020-12 in `tools/list` (see the spike output). `z.number().int()` emits `minimum`/`maximum` of ±2^53−1; harmless.
- Return `structuredContent` plus a text mirror in `content`. The v2 client validates `structuredContent` against `outputSchema`.
- **Errors the model can act on: return `{ isError: true, content: [...] }`** with a message that names the fix (the spike lists the valid module paths). Both Claude Code and Codex relayed that text to the model verbatim.
- Invalid arguments never reach the callback: the SDK answers `isError: true` with `Input validation error: Invalid arguments for tool describe_module: path: Invalid input: expected string, received number`. That is also a tool result, not a protocol error, so the model sees it and can retry.
- A throw inside a tool handler is also caught and turned into an `isError: true` result, including a thrown `ProtocolError`; only resource, prompt, and completion callbacks turn `ProtocolError` into a JSON-RPC error ([`docs/servers/errors.md`](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/errors.md)). Still return domain failures explicitly, so the message is written for the model and not a stack trace.
- `outputSchema` validation is skipped on `isError` results.

## Who is calling (activity feed)

| Signal | Claude Code 2.1.282 (modern) | Codex 0.157.0 (legacy stateless) |
| --- | --- | --- |
| `ctx.mcpReq.envelope["io.modelcontextprotocol/clientInfo"]` on every request | yes | no envelope |
| `server.server.getClientVersion()` inside the tool | `claude-code@2.1.282` (filled from the envelope) | `null`: the per-request instance never saw `initialize` |
| `User-Agent` (via factory `requestInfo` or `ctx.http.req`) | `claude-code/2.1.282 (sdk-ts, agent-sdk/0.3.276)` | `codex-mcp-client/0.157.0` |
| `Mcp-Session-Id` | none (the 2026-07-28 wire has no sessions) | none (stateless fallback issues no session id) |
| `initialize.params.clientInfo` | not sent (uses `server/discover`) | `{"name":"codex-mcp-client","title":"Codex","version":"0.157.0"}`, but on a separate request |

The 2026-07-28 spec says clients "SHOULD include `io.modelcontextprotocol/clientInfo` on every request" and that it is self-reported, for "display, logging, and debugging" only ([spec `basic/index`](https://modelcontextprotocol.io/specification/2026-07-28/basic)). That is exactly the activity-feed use. In v2, `getClientVersion()` is deprecated in favour of reading `ctx.mcpReq.envelope`, but it still works and is filled per request.

Recommendation: label activity with the envelope's `clientInfo` and fall back to parsing the `User-Agent`. There is no per-conversation identity in either era. If the explorer needs to tell two concurrent agents apart, make it explicit in the tools (for example a plan id argument), not in the transport. A sessionful legacy wiring (`isLegacyRequest` routing to a `WebStandardStreamableHTTPServerTransport` with `sessionIdGenerator`) would give Codex a session id, but it adds a session map for a cosmetic gain; not worth it now.

## Notifications

- **Modern era (2026-07-28):** the revision removes protocol sessions and the GET stream. Long-lived change notifications travel only on the response of a client-opened `subscriptions/listen` POST; request-scoped ones (progress, log messages) "flow only on the response stream of the request they relate to" ([spec: Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports), [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). Claude Code opens `subscriptions/listen` right after `server/discover` (see the server log below), and its docs say it "supports MCP `list_changed` notifications" and refreshes automatically ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp)). `handler.notify.toolsChanged()` reaches it; the spike proves delivery to the v2 client.
- **Legacy stateless (2025):** the 2025-11-25 transport lets the server answer the GET stream with `405`, which the stateless handler does. So nothing can be pushed outside a request: no `tools/list_changed`, no out-of-band logging. Mid-call notifications still ride the POST's SSE response. Codex would not use `list_changed` anyway: its rmcp client only logs "MCP server tool list changed" (`codex-rs/rmcp-client/src/logging_client_handler.rs` in [openai/codex](https://github.com/openai/codex)).
- `ctx.mcpReq.log(...)` is `@deprecated` as of 2026-07-28 (SEP-2577) in favour of stderr/OpenTelemetry. The explorer gets its live updates over our own SSE bus anyway, so MCP logging is not needed.
- Design consequence: keep the tool list static. Anything the agent needs to notice (plan locked, plan revised) should come back in tool results, which work in both eras.

## Registering the server

Claude Code (`claude mcp add --help`, 2.1.282):

```sh
claude mcp add --transport http uml-pr-review http://127.0.0.1:4477/mcp            # local scope (default): this project, this user
claude mcp add --transport http --scope user uml-pr-review http://127.0.0.1:4477/mcp
claude mcp add --transport http --scope project uml-pr-review http://127.0.0.1:4477/mcp  # writes .mcp.json
```

`.mcp.json` form (also works with `claude --mcp-config <file>`, or `claude mcp add-json uml-pr-review '{"type":"http","url":"http://127.0.0.1:4477/mcp"}'`):

```json
{ "mcpServers": { "uml-pr-review": { "type": "http", "url": "http://127.0.0.1:4477/mcp" } } }
```

Scopes ([Claude Code MCP docs](https://code.claude.com/docs/en/mcp)): `local` (default, private, stored in `~/.claude.json` under the project path), `project` (`.mcp.json`, shared through Git), `user` (all projects). Claude Code marks a remote server as needing authentication only when it answers `401` or `403`. Our Host/Origin guard answers `403`, so a misconfigured host name would surface as "needs auth" rather than as a connection error; always register `127.0.0.1` or `localhost`.

Codex (`codex mcp add --help`, 0.157.0):

```sh
codex mcp add uml-pr-review --url http://127.0.0.1:4477/mcp
```

`~/.codex/config.toml` form ([Codex MCP docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)):

```toml
[mcp_servers.uml-pr-review]
url = "http://127.0.0.1:4477/mcp"
default_tools_approval_mode = "approve"
```

Without `default_tools_approval_mode = "approve"` (or a per-tool `[mcp_servers.uml-pr-review.tools.<tool>] approval_mode = "approve"`), `codex exec` fails every call with "MCP tool call requires approval, but approval policy is never". Interactive Codex prompts instead. `codex mcp add --url` runs one OAuth discovery probe and, finding none, saves the entry; the docs say "If no credential source resolves, Codex can connect to the server without authentication". The old `experimental_use_rmcp_client` flag is gone (not in the 0.157.0 binary); the rmcp HTTP client is built in. A project-level `.codex/config.toml` also works but only loads for trusted projects.

Neither client needs any auth configuration for `127.0.0.1`.

## Spike

[`docs/research/spike/mcp-over-http-in-bun/`](spike/mcp-over-http-in-bun/): `mcp.ts` (factory and route), `spike.ts` (SDK clients), `serve.ts` (fixed port for real clients). Run `bun install && bun run spike.ts`. Typechecks with `tsc --noEmit` under `strict`.

`bun run spike.ts` (long schema lines cut at 260 characters):

```
Bun 1.4.2 serving MCP at http://127.0.0.1:65114/mcp

modern negotiated protocol 2026-07-28
notifications/tools/list_changed via subscriptions/listen -> [ "describe_module" ]

== v2 client (@modelcontextprotocol/client 2.1.0, versionNegotiation auto -> 2026-07-28 wire)
tools/list [{"name":"describe_module","inputSchema":{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"path":{"type":"string","description":"Module path relative to the repository root"}},"required":["path"]},"outputSchema
  activity {"era":"modern","method":"tools/call","userAgent":"Bun/1.4.2","sessionHeader":null,"clientFromInitialize":"spike-modern@2.1.0","envelopeKeys":["io.modelcontextprotocol/protocolVersion","io.modelcontextprotocol/clientInfo","io.modelcontextprotocol/cl
tools/call ok {"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"uml-pr-review","version":"0.0.0"}},"content":[{"type":"text","text":"{\"path\":\"src/web\",\"kind\":\"folder\",\"files\":4}"}],"structuredContent":{"path":"src/web","kind":"folder","files":4
  activity {"era":"modern","method":"tools/call","userAgent":"Bun/1.4.2","sessionHeader":null,"clientFromInitialize":"spike-modern@2.1.0","envelopeKeys":["io.modelcontextprotocol/protocolVersion","io.modelcontextprotocol/clientInfo","io.modelcontextprotocol/cl
tools/call miss {"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"uml-pr-review","version":"0.0.0"}},"content":[{"type":"text","text":"No module at \"nope\". Known modules: src/web, src."}],"isError":true}
tools/call bad args {"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"uml-pr-review","version":"0.0.0"}},"content":[{"type":"text","text":"Input validation error: Invalid arguments for tool describe_module: path: Invalid input: expected string, received 

legacy negotiated protocol 2025-11-25

== v1 client (@modelcontextprotocol/sdk 1.30.1, 2025-era wire, as Codex 0.157 speaks)
tools/list [{"name":"describe_module","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Module path relative to the repository root"}},"required":["path"],"$schema":"https://json-schema.org/draft/2020-12/schema"},"outputSchema
  activity {"era":"legacy","method":"tools/call","userAgent":"Bun/1.4.2","sessionHeader":null,"clientFromInitialize":null,"envelopeKeys":[]}
tools/call ok {"content":[{"type":"text","text":"{\"path\":\"src/web\",\"kind\":\"folder\",\"files\":4}"}],"structuredContent":{"path":"src/web","kind":"folder","files":4}}
  activity {"era":"legacy","method":"tools/call","userAgent":"Bun/1.4.2","sessionHeader":null,"clientFromInitialize":null,"envelopeKeys":[]}
tools/call miss {"content":[{"type":"text","text":"No module at \"nope\". Known modules: src/web, src."}],"isError":true}
tools/call bad args {"content":[{"type":"text","text":"Input validation error: Invalid arguments for tool describe_module: path: Invalid input: expected string, received number"}],"isError":true}

DNS-rebinding guard: Host evil.example -> 403
Standalone GET SSE stream (legacy stateless) -> 405
```

Real Claude Code against `bun run serve.ts`:

```sh
claude -p --strict-mcp-config --mcp-config mcp.json --allowedTools "mcp__uml-pr-review__describe_module" --model haiku \
  "Call the describe_module tool with path src/web, then with path nope. Reply with both raw results only."
```

```
{"path":"src/web","kind":"folder","files":4}

No module at "nope". Known modules: src/web, src.
```

Server log:

```
POST server/discover 200 ua=claude-code/2.1.282 (sdk-ts, agent-sdk/0.3.276) protocol=2026-07-28
POST subscriptions/listen 200 ua=claude-code/2.1.282 (sdk-ts, agent-sdk/0.3.276) protocol=2026-07-28
POST tools/list 200 ua=claude-code/2.1.282 (sdk-ts, agent-sdk/0.3.276) protocol=2026-07-28
activity {"era":"modern","method":"tools/call","userAgent":"claude-code/2.1.282 (sdk-ts, agent-sdk/0.3.276)","sessionHeader":null,"clientFromInitialize":"claude-code@2.1.282","envelopeKeys":["io.modelcontextprotocol/protocolVersion","io.modelcontextprotocol/clientInfo","io.modelcontextprotocol/clientCapabilities"]}
POST tools/call 200 ua=claude-code/2.1.282 (sdk-ts, agent-sdk/0.3.276) protocol=2026-07-28
activity {"era":"modern","method":"tools/call", ... same ...}
POST tools/call 200 ua=claude-code/2.1.282 (sdk-ts, agent-sdk/0.3.276) protocol=2026-07-28
```

Real Codex against `bun run serve.ts`:

```sh
codex exec --skip-git-repo-check --sandbox read-only \
  -c 'mcp_servers.uml-pr-review.url="http://127.0.0.1:4478/mcp"' \
  -c 'mcp_servers.uml-pr-review.default_tools_approval_mode="approve"' \
  "Call the describe_module tool of the uml-pr-review MCP server with path src/web, then with path nope. Reply with both raw results only."
```

```
{"content":[{"type":"text","text":"{\"path\":\"src/web\",\"kind\":\"folder\",\"files\":4}"}],"structuredContent":{"path":"src/web","kind":"folder","files":4}}
{"content":[{"type":"text","text":"No module at \"nope\". Known modules: src/web, src."}],"isError":true}
```

Server log:

```
POST initialize 200 ua=codex-mcp-client/0.157.0 protocol=null
  initialize {"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"elicitation":{"form":{},"url":{}}},"clientInfo":{"name":"codex-mcp-client","title":"Codex","version":"0.157.0"}}}
POST notifications/initialized 202 ua=codex-mcp-client/0.157.0 protocol=2025-06-18
POST tools/list 200 ua=codex-mcp-client/0.157.0 protocol=2025-06-18
activity {"era":"legacy","method":"tools/call","userAgent":"codex-mcp-client/0.157.0","sessionHeader":null,"clientFromInitialize":null,"envelopeKeys":[]}
POST tools/call 200 ua=codex-mcp-client/0.157.0 protocol=2025-06-18
activity {"era":"legacy","method":"tools/call", ... same ...}
POST tools/call 200 ua=codex-mcp-client/0.157.0 protocol=2025-06-18
```

## Consequences for the build

1. Add `@modelcontextprotocol/server@2.1.0` (and `@modelcontextprotocol/client@2.1.0` as a dev dependency for outside-in tests). Do not add the v1 `@modelcontextprotocol/sdk`.
2. Mount `"/mcp"` in `src/server.ts` next to the existing routes, guarded by the Host and Origin checks.
3. Keep domain state outside the per-request factory.
4. Tests can drive the real route in-process: `Bun.serve({ port: 0 })` plus the v2 `Client`, once with `versionNegotiation: { mode: "auto" }` (Claude Code's wire) and once with the default legacy mode (Codex's wire).
5. Document `default_tools_approval_mode = "approve"` in the Codex setup instructions.
