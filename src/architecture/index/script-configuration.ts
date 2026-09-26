import { posix } from "node:path";
import { z } from "zod";

export type PathAlias = { pattern: string; targets: string[] };
export type PackageManifest = z.infer<typeof PackageManifestSchema>;
export type WorkspacePackage = { directory: string; manifest: PackageManifest };
export type ScriptConfiguration = { aliasesByDirectory: Map<string, PathAlias[]>; packagesByName: Map<string, WorkspacePackage> };
export type ReadTexts = (paths: string[]) => Promise<Map<string, string>>;

type TsConfig = z.infer<typeof TsConfigSchema>;
type DeclaredPaths = { directory: string; entries: Record<string, string[]> };
type CompilerPaths = { baseUrl?: string; paths?: DeclaredPaths };

const optional = <Schema extends z.ZodType>(schema: Schema) => schema.optional().catch(undefined);

const TsConfigSchema = z.object({
  extends: optional(z.union([z.string(), z.array(z.string())])),
  compilerOptions: optional(
    z.object({
      baseUrl: optional(z.string()),
      paths: optional(z.record(z.string(), z.array(z.string()).catch([]))),
    }),
  ),
});

const PackageManifestSchema = z.object({
  name: optional(z.string()),
  main: optional(z.string()),
  module: optional(z.string()),
  types: optional(z.string()),
  exports: z.unknown().optional(),
});

const catchAllPattern = "*";
const relativeReference = /^\.\.?\//;

export async function loadScriptConfiguration(files: ReadonlySet<string>, readTexts: ReadTexts): Promise<ScriptConfiguration> {
  const named = (name: string) => [...files].filter((path) => posix.basename(path) === name && !path.includes("node_modules/"));
  const [aliasesByDirectory, packagesByName] = await Promise.all([
    loadPathAliases(named("tsconfig.json"), files, readTexts),
    loadWorkspacePackages(named("package.json"), readTexts),
  ]);
  return { aliasesByDirectory, packagesByName };
}

async function loadPathAliases(nearestConfigs: string[], files: ReadonlySet<string>, readTexts: ReadTexts): Promise<Map<string, PathAlias[]>> {
  const configs = await readExtendsClosure(nearestConfigs, files, readTexts);
  const compilerPathsOf = (path: string, chain: ReadonlySet<string>): CompilerPaths => {
    const config = configs.get(path);
    if (!config || chain.has(path)) return {};
    const directory = posix.dirname(path);
    const inherited = parentsOf(path, config, files)
      .map((parent) => compilerPathsOf(parent, new Set([...chain, path])))
      .reduce<CompilerPaths>((earlier, later) => ({ baseUrl: later.baseUrl ?? earlier.baseUrl, paths: later.paths ?? earlier.paths }), {});
    const { baseUrl, paths } = config.compilerOptions ?? {};
    return {
      baseUrl: baseUrl === undefined ? inherited.baseUrl : posix.join(directory, baseUrl),
      paths: paths === undefined ? inherited.paths : { directory, entries: paths },
    };
  };
  return new Map(
    nearestConfigs.flatMap((path) => {
      const { baseUrl, paths } = compilerPathsOf(path, new Set());
      return paths ? [[posix.dirname(path), aliasesOf(baseUrl ?? paths.directory, paths.entries)] as const] : [];
    }),
  );
}

async function readExtendsClosure(roots: string[], files: ReadonlySet<string>, readTexts: ReadTexts): Promise<Map<string, TsConfig | undefined>> {
  const configs = new Map<string, TsConfig | undefined>();
  for (let pending = roots; pending.length > 0; ) {
    const texts = await readTexts(pending);
    for (const path of pending) configs.set(path, validated(TsConfigSchema, texts.get(path), Bun.JSONC.parse));
    const parents = pending.flatMap((path) => parentsOf(path, configs.get(path), files));
    pending = [...new Set(parents)].filter((parent) => !configs.has(parent));
  }
  return configs;
}

function parentsOf(path: string, config: TsConfig | undefined, files: ReadonlySet<string>): string[] {
  return [config?.extends ?? []].flat().flatMap((reference) => {
    if (!relativeReference.test(reference)) return [];
    const target = posix.join(posix.dirname(path), reference);
    return [target, `${target}.json`].filter((candidate) => files.has(candidate)).slice(0, 1);
  });
}

function aliasesOf(base: string, paths: Record<string, string[]>): PathAlias[] {
  const aliases = Object.entries(paths).map(([pattern, targets]) => ({ pattern, targets: targets.map((target) => posix.join(base, target)) }));
  return aliases.sort((a, b) => b.pattern.replace(catchAllPattern, "").length - a.pattern.replace(catchAllPattern, "").length);
}

async function loadWorkspacePackages(manifestPaths: string[], readTexts: ReadTexts): Promise<Map<string, WorkspacePackage>> {
  const texts = await readTexts(manifestPaths);
  const packages = new Map<string, WorkspacePackage>();
  for (const path of manifestPaths) {
    const manifest = validated(PackageManifestSchema, texts.get(path), JSON.parse);
    if (manifest?.name && !packages.has(manifest.name)) packages.set(manifest.name, { directory: posix.dirname(path), manifest });
  }
  return packages;
}

function validated<Schema extends z.ZodType>(schema: Schema, text: string | undefined, parse: (text: string) => unknown): z.infer<Schema> | undefined {
  if (text === undefined) return undefined;
  try {
    const result = schema.safeParse(parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
