import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createEventBus } from "../../../src/architecture/events/index.ts";
import { createArchitectureRoutes } from "../../../src/architecture/http/index.ts";
import { createMcpRoute } from "../../../src/architecture/mcp/index.ts";
import { createArchitectureService } from "../../../src/architecture/service.ts";
import { temporaryRepository, type Files, type TemporaryRepository } from "../index/repository.ts";

export const explorerOrigin = "http://127.0.0.1:4477";

export type ArchitectureServer = {
  url: URL;
  mcpUrl: URL;
  api(path: string, init?: BunFetchRequestInit): Promise<Response>;
  stop(): Promise<void>;
};

export function startArchitectureServer(): ArchitectureServer {
  const bus = createEventBus();
  const service = createArchitectureService({ bus, explorerOrigin });
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 255,
    routes: { "/mcp": createMcpRoute({ service, bus }), ...createArchitectureRoutes({ service, bus }) },
  });
  const url = server.url;
  return {
    url,
    mcpUrl: new URL("/mcp", url),
    api: (path, init) => fetch(new URL(path, url), init),
    stop: () => server.stop(true),
  };
}

export type Wire = "modern" | "legacy";

export async function connectAgent(server: ArchitectureServer, wire: Wire, headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: `test-${wire}`, version: "1.0.0" }, wire === "modern" ? { versionNegotiation: { mode: "auto" } } : {});
  await client.connect(new StreamableHTTPClientTransport(server.mcpUrl, { requestInit: { headers } }));
  return client;
}

export const shop: Files = {
  "shop/orders/logic.py": "from shop.orders import models\n",
  "shop/orders/models.py": "",
  "shop/payments/facade/api.py": "from shop.payments.models import charge\n",
  "shop/payments/models/charge.py": "",
};

const repositories: TemporaryRepository[] = [];

export async function shopRepository(): Promise<TemporaryRepository> {
  const repository = await temporaryRepository(shop);
  repositories.push(repository);
  return repository;
}

export async function removeRepositories(): Promise<void> {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
}

export function jsonBody(body: unknown, init: RequestInit = {}): RequestInit {
  return { method: "POST", ...init, headers: { "content-type": "application/json", ...init.headers }, body: JSON.stringify(body) };
}

export function inRepository(route: string, repository: TemporaryRepository): string {
  return `${route}${route.includes("?") ? "&" : "?"}path=${encodeURIComponent(repository.dir)}`;
}
