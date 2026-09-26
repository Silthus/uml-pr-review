import { z } from "zod";
import {
  DependencySchema,
  FarDependencySchema,
  ImportEvidenceSchema,
  ModuleViewSchema,
  RepositoryRefSchema,
  SearchHitSchema,
  type Dependency,
  type ModuleView,
} from "../contracts/index.ts";
import type { ArchitectureModel } from "../model/index.ts";
import { descriptions } from "./descriptions.ts";
import { counted, dependencyLine, evidenceLine, farDependencyLine, moduleLine, searchHitLines, section, short } from "./text.ts";
import { defineTool, ToolFailure, worktreeSchema } from "./tool-kit.ts";

const overviewDependencyLimit = 60;
const farDependencyLimit = 25;
const unresolvedLimit = 10;
const suggestionLimit = 3;

const includeTestsSchema = z.boolean().default(false).describe("Count imports from test files too. Default false.");
const modulePathSchema = (role: string) => z.string().describe(`${role} as a module path relative to the repository root, for example products/error_tracking; "." is the root.`);

const UnresolvedImportSchema = z.object({ file: z.string(), line: z.number().int(), specifier: z.string() });

export const overviewTool = defineTool({
  name: "get_architecture_overview",
  title: "Architecture overview",
  description: descriptions.get_architecture_overview,
  input: z.object({
    worktree: worktreeSchema,
    path: z.string().default(".").describe('Module to start from. Default "." (the whole repository).'),
    depth: z.number().int().min(1).max(3).default(1).describe("How many levels of modules below path to list, 1 to 3. Default 1."),
    includeTests: includeTestsSchema,
  }),
  output: z.object({
    repository: RepositoryRefSchema,
    tree: z.string(),
    root: ModuleViewSchema,
    modules: z.array(ModuleViewSchema),
    dependencies: z.array(DependencySchema),
    unresolvedImports: z.number().int(),
  }),
  async run({ path, depth, includeTests }, { service, repository }) {
    const model = await service.architecture(repository.root);
    const root = moduleOrFailure(model, path);
    const levels = levelsBelow(model, path, depth);
    const expanded = new Set([...ancestorsOf(model, path), path, ...[...levels].flatMap(([module, level]) => (level < depth ? [module] : []))]);
    const lifted = model.lift(expanded, { includeTests });
    const modules = lifted.modules.filter((module) => levels.has(module.path));
    const shown = new Set([path, ...modules.map((module) => module.path)]);
    const between = lifted.dependencies.filter(({ from, to }) => shown.has(from) && shown.has(to)).sort(heaviestFirst);
    const dependencies = between.slice(0, overviewDependencyLimit);
    const unresolvedImports = unresolvedWithin(model, path, includeTests).length;
    const text = [
      `Repository ${repository.name} at ${repository.root}, HEAD ${short(model.payload.commit ?? model.payload.tree)}.`,
      moduleLine(root),
      ...section(`Modules below ${path}, ${counted(depth, "level")} deep`, modules, (module) => moduleLine(module, "  ".repeat(levels.get(module.path)!)), "none."),
      ...section(`Heaviest dependencies between them (${dependencies.length} of ${between.length}, counted in imports)`, dependencies, dependencyLine, "none."),
      ...(unresolvedImports > 0 ? [`Unresolved imports: ${unresolvedImports}. describe_module lists them per module.`] : []),
    ];
    return {
      output: { repository, tree: model.payload.tree, root, modules, dependencies, unresolvedImports },
      text: text.join("\n"),
      next: "Call describe_module with one of these module paths to see what it depends on and what depends on it, or search_modules to find a module by name.",
      summary: `get_architecture_overview ${path}`,
    };
  },
});

export const describeModuleTool = defineTool({
  name: "describe_module",
  title: "Describe module",
  description: descriptions.describe_module,
  input: z.object({ worktree: worktreeSchema, path: modulePathSchema("The module to describe"), includeTests: includeTestsSchema }),
  output: z.object({
    module: ModuleViewSchema,
    children: z.array(ModuleViewSchema),
    dependsOn: z.array(FarDependencySchema),
    dependedOnBy: z.array(FarDependencySchema),
    unresolvedImports: z.array(UnresolvedImportSchema),
  }),
  async run({ path, includeTests }, { service, repository }) {
    const model = await service.architecture(repository.root);
    const module = moduleOrFailure(model, path);
    const children = model.children(path);
    const outgoing = model.dependencies(path, "out", { includeTests });
    const incoming = model.dependencies(path, "in", { includeTests });
    const unresolved = unresolvedWithin(model, path, includeTests);
    const output = {
      module,
      children,
      dependsOn: outgoing.slice(0, farDependencyLimit),
      dependedOnBy: incoming.slice(0, farDependencyLimit),
      unresolvedImports: unresolved.slice(0, unresolvedLimit),
    };
    const text = [
      `Module ${path} (${module.kind}): ${counted(module.directFiles, "file")} directly, ${module.totalFiles} in total.${module.parent ? ` Parent: ${module.parent}.` : ""}`,
      ...section(`Children (${children.length})`, children, (child) => moduleLine(child, "  "), "none."),
      ...section(`Depends on (${output.dependsOn.length} of ${outgoing.length} far modules, counted in imports)`, output.dependsOn, farDependencyLine, "nothing outside this module."),
      ...section(`Depended on by (${output.dependedOnBy.length} of ${incoming.length} far modules, counted in imports)`, output.dependedOnBy, farDependencyLine, "nothing outside this module."),
      ...(unresolved.length > 0
        ? [`Unresolved imports (${output.unresolvedImports.length} of ${unresolved.length}):`, ...output.unresolvedImports.map(({ file, line, specifier }) => `  ${file}:${line} ${specifier}`)]
        : []),
    ];
    return {
      output,
      text: text.join("\n"),
      next: `Call get_dependency_evidence with from ${path} and a module from dependsOn (or the reverse for dependedOnBy) to see the exact import lines.`,
      summary: `describe_module ${path}`,
      selection: { kind: "module", path },
    };
  },
});

export const evidenceTool = defineTool({
  name: "get_dependency_evidence",
  title: "Dependency evidence",
  description: descriptions.get_dependency_evidence,
  input: z.object({
    worktree: worktreeSchema,
    from: modulePathSchema("The importing module"),
    to: modulePathSchema("The imported module"),
    limit: z.number().int().min(1).max(100).default(20).describe("How many imports to list, 1 to 100. Default 20."),
    includeTests: includeTestsSchema,
  }),
  output: z.object({ from: z.string(), to: z.string(), total: z.number().int(), imports: z.array(ImportEvidenceSchema) }),
  async run({ from, to, limit, includeTests }, { service, repository }) {
    const model = await service.architecture(repository.root);
    moduleOrFailure(model, from);
    moduleOrFailure(model, to);
    const all = model.evidence(from, to, { includeTests, limit: Number.MAX_SAFE_INTEGER });
    const imports = all.slice(0, limit);
    const scope = includeTests ? "" : " (tests left out)";
    const text =
      all.length === 0
        ? [`No file in ${from} imports ${to}${scope}.`]
        : [
            `${counted(all.length, "import")} from ${from} to ${to}${scope}:`,
            ...imports.map(evidenceLine),
            ...(all.length > imports.length ? [`Showing ${imports.length} of ${all.length}; pass a higher limit (up to 100) for more.`] : []),
          ];
    return {
      output: { from, to, total: all.length, imports },
      text: text.join("\n"),
      next: `To plan a dependency from ${from} on ${to}, add a seam with edit_plan whose interface lists the target files it must go through.`,
      summary: `get_dependency_evidence ${from} -> ${to}`,
      selection: { kind: "seam", from, to },
    };
  },
});

export const searchTool = defineTool({
  name: "search_modules",
  title: "Search modules",
  description: descriptions.search_modules,
  input: z.object({
    worktree: worktreeSchema,
    query: z.string().min(1).describe("Words that must all occur in a module path or in one of its file paths."),
    limit: z.number().int().min(1).max(50).default(20).describe("How many modules to return, 1 to 50. Default 20."),
  }),
  output: z.object({ hits: z.array(SearchHitSchema) }),
  async run({ query, limit }, { service, repository }) {
    const model = await service.architecture(repository.root);
    const hits = model.search(query, limit);
    const text = hits.length === 0 ? [`No module matches "${query}".`] : [`${counted(hits.length, "module")} match "${query}":`, ...hits.flatMap(searchHitLines)];
    const next = hits.length === 0 ? "Search again with fewer or shorter words, or call get_architecture_overview to browse the module tree." : "Pass one of these module paths to describe_module or get_architecture_overview.";
    return { output: { hits }, text: text.join("\n"), next, summary: `search_modules "${query}"` };
  },
});

export const architectureTools = [overviewTool, describeModuleTool, evidenceTool, searchTool];

function moduleOrFailure(model: ArchitectureModel, path: string): ModuleView {
  const module = model.module(path);
  if (module) return module;
  const suggestions = closestModules(model, path);
  const didYouMean = suggestions.length > 0 ? ` Did you mean ${alternatives(suggestions)}?` : "";
  throw new ToolFailure(`No module \`${path}\`.${didYouMean} Use search_modules to find module paths.`);
}

function closestModules(model: ArchitectureModel, path: string): string[] {
  const segments = path.split("/").filter((segment) => segment && segment !== ".");
  const queries = segments.map((_, index) => segments.slice(index).join(" ")).concat(segments.slice(0, -1).reverse());
  const suggestions = new Set<string>();
  for (const query of queries) {
    for (const { module } of model.search(query, suggestionLimit)) if (module.path !== "." && suggestions.size < suggestionLimit) suggestions.add(module.path);
  }
  return [...suggestions];
}

function alternatives(paths: string[]): string {
  const quoted = paths.map((path) => `\`${path}\``);
  if (quoted.length < 3) return quoted.join(" or ");
  return `${quoted.slice(0, -1).join(", ")}, or ${quoted.at(-1)}`;
}

function ancestorsOf(model: ArchitectureModel, path: string): string[] {
  const parent = model.module(path)?.parent;
  return parent ? [...ancestorsOf(model, parent), parent] : [];
}

function levelsBelow(model: ArchitectureModel, path: string, depth: number): Map<string, number> {
  const levels = new Map<string, number>();
  const visit = (module: string, level: number) => {
    if (level > depth) return;
    for (const child of model.children(module)) {
      levels.set(child.path, level);
      visit(child.path, level + 1);
    }
  };
  visit(path, 1);
  return levels;
}

function unresolvedWithin(model: ArchitectureModel, path: string, includeTests: boolean): z.infer<typeof UnresolvedImportSchema>[] {
  const { files, unresolved } = model.payload;
  return unresolved.flatMap(([index, line, specifier]) => {
    const [file, , , role] = files[index]!;
    const within = path === "." || file.startsWith(`${path}/`);
    return within && (includeTests || role === "production") ? [{ file, line, specifier }] : [];
  });
}

function heaviestFirst(a: Dependency, b: Dependency): number {
  return b.imports - a.imports || a.from.localeCompare(b.from) || a.to.localeCompare(b.to);
}
