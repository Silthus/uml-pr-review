import { z } from "zod";

const TextPartSchema = z.object({ type: z.string(), text: z.string().optional() });

const ContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking") }),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal("tool_result"), tool_use_id: z.string(), content: z.union([z.string(), z.array(TextPartSchema)]) }),
]);

const MessageSchema = z.object({ content: z.union([z.string(), z.array(z.looseObject({ type: z.string() }))]) });

const InitSchema = z.object({
  type: z.literal("system"),
  subtype: z.literal("init"),
  model: z.string(),
  session_id: z.string(),
  claude_code_version: z.string(),
  mcp_servers: z.array(z.object({ name: z.string(), status: z.string() })),
});

const ResultSchema = z.object({
  type: z.literal("result"),
  num_turns: z.number(),
  duration_ms: z.number(),
  total_cost_usd: z.number(),
  is_error: z.boolean(),
  modelUsage: z.record(z.string(), z.object({ provider: z.string().optional(), costUSD: z.number() })),
  permission_denials: z.array(z.unknown()),
});

const TurnSchema = z.object({ type: z.enum(["assistant", "user"]), message: MessageSchema });

type ContentBlock = z.infer<typeof ContentBlockSchema>;

const [logPath, verbatimList = "check_plan", width = "700"] = process.argv.slice(2);
if (!logPath) throw new Error("Usage: bun scripts/proof/render-transcript.ts <stream-json log> [tools shown verbatim, comma separated] [cut width]");

const verbatimTools = new Set(verbatimList.split(","));
const cut = Number(width);
const toolNames = new Map<string, string>();
const lines = (await Bun.file(logPath).text()).split("\n").filter((line) => line.startsWith("{"));

for (const line of lines) for (const rendered of render(JSON.parse(line))) console.log(rendered);

function render(event: unknown): string[] {
  const init = InitSchema.safeParse(event);
  if (init.success) return [initLine(init.data)];
  const result = ResultSchema.safeParse(event);
  if (result.success) return [resultLine(result.data)];
  const turn = TurnSchema.safeParse(event);
  if (!turn.success || typeof turn.data.message.content === "string") return [];
  return turn.data.message.content.flatMap((block) => {
    const parsed = ContentBlockSchema.safeParse(block);
    return parsed.success ? renderBlock(parsed.data) : [];
  });
}

function initLine(init: z.infer<typeof InitSchema>): string {
  const servers = init.mcp_servers.map((server) => `${server.name}: ${server.status}`).join(", ");
  return `[init] claude ${init.claude_code_version}, model ${init.model}, session ${init.session_id}, mcp servers [${servers}]\n`;
}

function resultLine(result: z.infer<typeof ResultSchema>): string {
  const models = Object.entries(result.modelUsage).map(([model, usage]) => `${model} (provider ${usage.provider ?? "not reported"}, $${usage.costUSD.toFixed(4)})`);
  return `[done] ${result.num_turns} turns, ${result.duration_ms} ms, $${result.total_cost_usd.toFixed(2)}, is_error=${result.is_error}, permission_denials ${result.permission_denials.length}, modelUsage ${models.join(", ")}\n`;
}

function renderBlock(block: ContentBlock): string[] {
  switch (block.type) {
    case "text":
      return [`[assistant] ${block.text}\n`];
    case "thinking":
      return [];
    case "tool_use":
      return [`>>> ${rememberTool(block.id, block.name)} ${JSON.stringify(block.input)}`];
    case "tool_result":
      return [renderResult(block.tool_use_id, block.content)];
  }
}

function rememberTool(id: string, name: string): string {
  const tool = name.replace("mcp__uml-pr-review__", "");
  toolNames.set(id, tool);
  return tool;
}

function renderResult(toolUseId: string, content: string | z.infer<typeof TextPartSchema>[]): string {
  const tool = toolNames.get(toolUseId) ?? "?";
  const text = typeof content === "string" ? content : content.map((part) => part.text ?? `[${part.type}]`).join("\n");
  return `<<< ${tool}\n${verbatimTools.has(tool) ? text : shorten(text)}\n`;
}

function shorten(text: string): string {
  return text.length <= cut ? text : `${text.slice(0, cut)} … (${text.length - cut} more characters)`;
}
