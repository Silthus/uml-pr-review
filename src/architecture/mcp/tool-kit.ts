import type { CallToolResult, McpServer, ServerContext, ToolCallback } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { RepositoryRef, SelectionTarget } from "../contracts/index.ts";
import type { EventBus } from "../events/index.ts";
import { ServiceError, type ArchitectureService } from "../service.ts";

export const worktreeSchema = z.string().describe("Absolute path of your working directory in the repository. Use the directory you are working in.");

export type ToolEnvironment = { service: ArchitectureService; bus: EventBus; client: (envelope: unknown) => string };

export type ToolContext = { service: ArchitectureService; repository: RepositoryRef; client: string };

export type ToolReply<Output> = {
  output: Output;
  text: string;
  next: string;
  summary: string;
  planId?: string;
  selection?: SelectionTarget;
};

export class ToolFailure extends Error {
  constructor(
    message: string,
    readonly planId?: string,
  ) {
    super(message);
  }
}

type WorktreeInput = z.ZodObject<{ worktree: typeof worktreeSchema }>;

export type ToolDefinition<Input extends WorktreeInput, Output extends z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: Input;
  output: Output;
  run(input: z.output<Input>, context: ToolContext): Promise<ToolReply<z.output<Output>>>;
};

export type ToolRegistration = (server: McpServer, environment: ToolEnvironment) => void;

const summaryLength = 160;

const nextSchema = z.string().describe("What to do next, in plain words.");

export function defineTool<Input extends WorktreeInput, Output extends z.ZodObject>(tool: ToolDefinition<Input, Output>): ToolRegistration {
  return (server, { service, bus, client }) => {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.input, outputSchema: tool.output.extend({ next: nextSchema }) },
      (async (input: z.output<Input>, ctx: ServerContext): Promise<CallToolResult> => {
        const started = performance.now();
        const caller = client(ctx.mcpReq.envelope);
        const repository = await service.repository(input.worktree).catch((error: unknown) => error as Error);
        if (repository instanceof Error) return failed(messageOf(repository));
        const publish = (status: "ok" | "error", summary: string, planId: string | undefined) =>
          bus.publish({
            type: "agent_activity",
            repositoryId: repository.id,
            id: crypto.randomUUID(),
            client: caller,
            tool: tool.name,
            status,
            summary: summary.length > summaryLength ? `${summary.slice(0, summaryLength - 1)}…` : summary,
            ...(planId === undefined ? {} : { planId }),
            durationMs: Math.round(performance.now() - started),
          });
        try {
          const reply = await tool.run(input, { service, repository, client: caller });
          publish("ok", reply.summary, reply.planId);
          if (reply.selection) {
            bus.publish({ type: "selection_hint", repositoryId: repository.id, client: caller, tool: tool.name, target: reply.selection, ...(reply.planId === undefined ? {} : { planId: reply.planId }) });
          }
          return { content: [{ type: "text", text: `${reply.text}\nNext: ${reply.next}` }], structuredContent: { ...reply.output, next: reply.next } };
        } catch (error) {
          const message = messageOf(error);
          publish("error", `${tool.name} failed: ${message.split("\n")[0]}`, error instanceof ToolFailure ? error.planId : undefined);
          return failed(message);
        }
      }) as ToolCallback<Input>,
    );
  };
}

function failed(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function messageOf(error: unknown): string {
  if (error instanceof ServiceError || error instanceof ToolFailure) return error.message;
  console.error(error);
  return `The tool failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`;
}
