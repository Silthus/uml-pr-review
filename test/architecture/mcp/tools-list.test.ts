import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectAgent, startArchitectureServer, type ArchitectureServer, type Wire } from "../http/architecture-server.ts";

let server: ArchitectureServer;

beforeAll(() => {
  server = startArchitectureServer();
});

afterAll(() => server.stop());

const planContext = ["pendingHumanComments", "humanChanges", "explorerUrl"];

const expectedTools = {
  get_architecture_overview: {
    description:
      "Start here. Returns the module tree of the repository (or of one module) a few levels deep, with each module's kind and file count, and the heaviest dependencies between the modules shown, counted in imports. Modules are source folders; kinds such as product, layer, package, or django-app tell you what a folder is. Tests are left out unless you ask for them. The human sees the same architecture in the explorer.",
    input: ["worktree", "path", "depth", "includeTests"],
    required: ["worktree"],
    output: ["repository", "tree", "root", "modules", "dependencies", "unresolvedImports", "next"],
  },
  describe_module: {
    description:
      "Explains one module: its children, what it depends on, and what depends on it, each counted in imports and grouped by the far module, with the deepest modules behind each count in `via`. Use it to find where a change belongs and which existing interfaces a module already uses. Follow up with get_dependency_evidence to see the exact import lines. The explorer follows the modules you describe.",
    input: ["worktree", "path", "includeTests"],
    required: ["worktree", "path"],
    output: ["module", "children", "dependsOn", "dependedOnBy", "unresolvedImports", "next"],
  },
  get_dependency_evidence: {
    description:
      "Lists the exact imports from files in one module to files in another, as file:line, target file, kind, and imported names. Use it to learn a dependency's current interface before you plan a seam through it.",
    input: ["worktree", "from", "to", "limit", "includeTests"],
    required: ["worktree", "from", "to"],
    output: ["from", "to", "total", "imports", "next"],
  },
  search_modules: {
    description:
      "Finds modules by words in their path or in the paths of their files, for example 'feature flags facade' or 'error_tracking frontend'. Returns module paths you can pass to the other tools.",
    input: ["worktree", "query", "limit"],
    required: ["worktree", "query"],
    output: ["hits", "next"],
  },
  create_plan: {
    description:
      "Starts a new architecture plan for a change you are about to make, based on the current HEAD. A plan names the modules the change will create, modify, or remove, and the seams (dependencies) it adds, removes, or keeps, each with the interface it must go through. Draft the plan before you write code; the human watches it appear in the explorer and may comment or edit. Then fill it with edit_plan.",
    input: ["worktree", "title", "goal"],
    required: ["worktree", "title", "goal"],
    output: ["plan", ...planContext, "next"],
  },
  get_plan: {
    description:
      "Returns an architecture plan with its modules, seams, comments, and lock status, the human comments you have not answered yet, and any edits the human made since your last change. Read it before you implement and whenever a result says the human commented or changed the plan.",
    input: ["worktree", "planId", "history"],
    required: ["worktree"],
    output: ["plan", "otherPlans", ...planContext, "next"],
  },
  edit_plan: {
    description:
      "Applies a batch of edits to a draft plan atomically: upsert_module, drop_module, upsert_seam, drop_seam, set_summary, set_base_commit, add_comment, and resolve_comment (answer a human comment with a reply). Pass the revision you last saw as expectedRevision; if the human changed the plan in between, nothing is applied and the result tells you what changed so you can retry. A seam's interface lists the files (and optionally the symbols) of the target module that the dependency must go through. Locked plans only accept comments.",
    input: ["worktree", "planId", "expectedRevision", "operations", "note"],
    required: ["worktree", "planId", "expectedRevision", "operations"],
    output: ["plan", "warnings", ...planContext, "next"],
  },
  set_plan_lock: {
    description:
      "Locks or unlocks a plan. Only do this when the human has just asked you to in this conversation, and quote their words in humanRequest. A locked plan is the agreed architecture: you implement it and check against it, and you cannot change its modules or seams until the human unlocks it.",
    input: ["worktree", "planId", "locked", "humanRequest"],
    required: ["worktree", "planId", "locked", "humanRequest"],
    output: ["plan", ...planContext, "next"],
  },
  check_plan: {
    description:
      "Checks the working tree, including uncommitted and untracked files, against a plan. Every finding names file:line and the change that would conform; apply the fixes and check again. Run it while you implement (planned work that is not done yet is reported as pending) and once more with final: true when you think you are done (anything still missing then is a violation).",
    input: ["worktree", "planId", "final"],
    required: ["worktree"],
    output: ["result", ...planContext, "next"],
  },
};

type JsonSchema = { properties: Record<string, Record<string, unknown>>; required?: string[] };

const schemaOf = (schema: unknown) => schema as JsonSchema;

describe.each<Wire>(["modern", "legacy"])("tools/list over the %s wire", (wire) => {
  test("lists exactly the nine tools with the spec's descriptions and schemas", async () => {
    const client = await connectAgent(server, wire);
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.map((tool) => tool.name).toSorted()).toEqual(Object.keys(expectedTools).toSorted());
    for (const tool of tools) {
      const expected = expectedTools[tool.name as keyof typeof expectedTools];
      const input = schemaOf(tool.inputSchema);
      const output = schemaOf(tool.outputSchema);
      expect({ name: tool.name, description: tool.description, input: Object.keys(input.properties), required: input.required, output: Object.keys(output.properties) }).toEqual({
        name: tool.name,
        ...expected,
      });
    }
  });

  test("states the limits and defaults of the inputs", async () => {
    const client = await connectAgent(server, wire);
    const { tools } = await client.listTools();
    await client.close();
    const input = (name: string) => schemaOf(tools.find((tool) => tool.name === name)!.inputSchema).properties;

    expect(input("get_architecture_overview").depth).toMatchObject({ minimum: 1, maximum: 3, default: 1 });
    expect(input("get_architecture_overview").path).toMatchObject({ default: "." });
    expect(input("get_dependency_evidence").limit).toMatchObject({ minimum: 1, maximum: 100, default: 20 });
    expect(input("search_modules").limit).toMatchObject({ minimum: 1, maximum: 50, default: 20 });
    expect(input("edit_plan").operations).toMatchObject({ minItems: 1, maxItems: 50 });
    expect(input("create_plan").worktree).toMatchObject({ description: "Absolute path of your working directory in the repository. Use the directory you are working in." });
  });

  test("types every input and encodes the operations and output enums", async () => {
    const client = await connectAgent(server, wire);
    const { tools } = await client.listTools();
    await client.close();
    const tool = (name: string) => tools.find((candidate) => candidate.name === name)!;
    const typesOf = (schema: unknown) => Object.fromEntries(Object.entries(schemaOf(schema).properties).map(([key, property]) => [key, property.type ?? "union"]));
    const operations = schemaOf(tool("edit_plan").inputSchema).properties.operations as { items: { oneOf: JsonSchema[] } };
    const output = (name: string) => schemaOf(tool(name).outputSchema).properties;

    expect(typesOf(tool("get_architecture_overview").inputSchema)).toEqual({ worktree: "string", path: "string", depth: "integer", includeTests: "boolean" });
    expect(typesOf(tool("edit_plan").inputSchema)).toEqual({ worktree: "string", planId: "string", expectedRevision: "integer", operations: "array", note: "string" });
    expect(typesOf(tool("set_plan_lock").inputSchema)).toEqual({ worktree: "string", planId: "string", locked: "boolean", humanRequest: "string" });
    expect(typesOf(tool("check_plan").inputSchema)).toEqual({ worktree: "string", planId: "string", final: "boolean" });
    expect(operations.items.oneOf.map((operation) => operation.properties.op!.const)).toEqual([
      "set_summary",
      "set_base_commit",
      "upsert_module",
      "drop_module",
      "upsert_seam",
      "drop_seam",
      "add_comment",
      "resolve_comment",
    ]);
    expect(schemaOf(output("describe_module").module).properties.kind!.enum).toEqual(["root", "product", "package", "layer", "django-app", "scene", "tests", "migrations", "generated", "python-package", "directory"]);
    expect(schemaOf(output("check_plan").result).properties.verdict!.enum).toEqual(["conforming", "pending", "violating"]);
    expect(output("check_plan").next).toMatchObject({ type: "string" });
  });
});
