import {
  CLIENT_INFO_META_KEY,
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import type { EventBus } from "../events/index.ts";
import type { ArchitectureService } from "../service.ts";
import { architectureTools } from "./architecture-tools.ts";
import { planTools } from "./plan-tools.ts";

const tools = [...architectureTools, ...planTools];

const ClientInfoSchema = z.object({ name: z.string().min(1), version: z.string().optional() });
const EnvelopeSchema = z.object({ [CLIENT_INFO_META_KEY]: ClientInfoSchema });

export function createMcpRoute({ service, bus }: { service: ArchitectureService; bus: EventBus }): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(({ requestInfo }) => {
    const server = new McpServer({ name: "uml-pr-review", version: "0.0.0" });
    const userAgent = requestInfo?.headers.get("user-agent") ?? null;
    for (const register of tools) register(server, { service, bus, client: (envelope) => clientLabel(envelope, userAgent) });
    return server;
  });
  return async (request) =>
    hostHeaderValidationResponse(request, localhostAllowedHostnames()) ?? originValidationResponse(request, localhostAllowedOrigins()) ?? handler.fetch(request);
}

function clientLabel(envelope: unknown, userAgent: string | null): string {
  const parsed = EnvelopeSchema.safeParse(envelope);
  if (parsed.success) {
    const { name, version } = parsed.data[CLIENT_INFO_META_KEY];
    return version ? `${name}@${version}` : name;
  }
  return userAgent?.trim().split(/\s+/)[0] || "agent";
}
