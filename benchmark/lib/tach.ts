import { z } from "zod";

const rootModule = "<root>";

const DependencySchema = z.union([z.string(), z.object({ path: z.string() }).loose()]);
const TachFileSchema = z
  .object({
    modules: z.array(z.object({ path: z.string(), depends_on: z.array(DependencySchema).default([]), utility: z.boolean().default(false) }).loose()).default([]),
  })
  .loose();

export type TachModule = { path: string; dependsOn: Set<string>; utility: boolean };

export type TachConfig = {
  moduleOf(file: string): string;
  declares(from: string, to: string): boolean;
};

export function parseTach(text: string): TachConfig {
  const modules = TachFileSchema.parse(Bun.TOML.parse(text)).modules.map(
    (module): TachModule => ({ path: module.path, dependsOn: new Set(module.depends_on.map(dependencyPath)), utility: module.utility }),
  );
  const byPath = new Map(modules.map((module) => [module.path, module]));
  const prefixes = modules
    .filter(({ path }) => path !== rootModule)
    .map(({ path }) => ({ path, directory: `${path.replaceAll(".", "/")}/`, file: `${path.replaceAll(".", "/")}.py` }))
    .sort((a, b) => b.directory.length - a.directory.length);
  return {
    moduleOf: (file) => prefixes.find(({ directory, file: moduleFile }) => file.startsWith(directory) || file === moduleFile)?.path ?? rootModule,
    declares: (from, to) => byPath.get(to)?.utility === true || byPath.get(from)?.dependsOn.has(to) === true,
  };
}

function dependencyPath(dependency: z.infer<typeof DependencySchema>): string {
  return typeof dependency === "string" ? dependency : dependency.path;
}
