import { posix } from "node:path";
import { z } from "zod";

export type PathAlias = { pattern: string; targets: string[] };
export type Aliases = PathAlias[] | typeof unknownAliases;
export type PackageManifest = z.infer<typeof PackageManifestSchema>;
export type WorkspacePackage = { directory: string; manifest: PackageManifest };
export type ScriptConfiguration = { aliasesByDirectory: Map<string, Aliases>; packagesByName: Map<string, WorkspacePackage> };
export type ReadTexts = (paths: string[]) => Promise<Map<string, string>>;

type Invalid = typeof invalid;
type Paths = Record<string, string[]>;
type TsConfig = { extends: string[]; baseUrl?: string | Invalid; paths?: Paths | Invalid };
type CompilerPaths = { baseUrl?: string | Invalid; paths?: { directory: string; entries: Paths } | Invalid };

export const catchAllPattern = "*";
export const unknownAliases = "unknown";
const invalid: unique symbol = Symbol("invalid");
const unreadable: TsConfig = { extends: [], baseUrl: invalid, paths: invalid };
const relativeReference = /^\.\.?\//;

const TsConfigDocumentSchema = z.object({ extends: z.unknown().optional(), compilerOptions: z.unknown().optional() });
const CompilerOptionsSchema = z.object({ baseUrl: z.unknown().optional(), paths: z.unknown().optional() });
const ExtendsSchema = z
  .union([z.string().transform((reference) => [reference]), z.array(z.string().nullable().catch(null)).transform((references) => references.filter((reference) => reference !== null))])
  .catch([]);
const PathsSchema = z.record(z.string(), z.array(z.string()).catch([]));

const PackageManifestSchema = z.object({
  name: z.string().optional().catch(undefined),
  main: z.string().optional().catch(undefined),
  module: z.string().optional().catch(undefined),
  types: z.string().optional().catch(undefined),
  exports: z.unknown().optional(),
});

export async function loadScriptConfiguration(files: ReadonlySet<string>, readTexts: ReadTexts): Promise<ScriptConfiguration> {
  const named = (name: string) => [...files].filter((path) => posix.basename(path) === name && !path.includes("node_modules/"));
  const [aliasesByDirectory, packagesByName] = await Promise.all([
    loadPathAliases(named("tsconfig.json"), files, readTexts),
    loadWorkspacePackages(named("package.json"), readTexts),
  ]);
  return { aliasesByDirectory, packagesByName };
}

async function loadPathAliases(nearestConfigs: string[], files: ReadonlySet<string>, readTexts: ReadTexts): Promise<Map<string, Aliases>> {
  const configs = await readExtendsClosure(nearestConfigs, files, readTexts);
  const resolved = new Map<string, CompilerPaths>();
  const inProgress = new Set<string>();
  const compilerPathsOf = (path: string): CompilerPaths => {
    const config = configs.get(path);
    if (!config || inProgress.has(path)) return {};
    const known = resolved.get(path);
    if (known) return known;
    inProgress.add(path);
    const inherited = parentsOf(path, config, files).map(compilerPathsOf).reduce(overriddenBy, {});
    inProgress.delete(path);
    const effective = overriddenBy(inherited, declaredPaths(posix.dirname(path), config));
    resolved.set(path, effective);
    return effective;
  };
  return new Map(
    nearestConfigs.flatMap((path) => {
      const aliases = aliasesFrom(compilerPathsOf(path));
      return aliases ? [[posix.dirname(path), aliases] as const] : [];
    }),
  );
}

function overriddenBy(earlier: CompilerPaths, later: CompilerPaths): CompilerPaths {
  return { baseUrl: later.baseUrl ?? earlier.baseUrl, paths: later.paths ?? earlier.paths };
}

function declaredPaths(directory: string, { baseUrl, paths }: TsConfig): CompilerPaths {
  return {
    baseUrl: typeof baseUrl === "string" ? posix.join(directory, baseUrl) : baseUrl,
    paths: paths === invalid || paths === undefined ? paths : { directory, entries: paths },
  };
}

function aliasesFrom({ baseUrl, paths }: CompilerPaths): Aliases | undefined {
  if (baseUrl === invalid || paths === invalid) return unknownAliases;
  if (!paths) return undefined;
  const aliases = Object.entries(paths.entries).map(([pattern, targets]) => ({ pattern, targets: targets.map((target) => posix.join(baseUrl ?? paths.directory, target)) }));
  return aliases.sort((a, b) => b.pattern.replace(catchAllPattern, "").length - a.pattern.replace(catchAllPattern, "").length);
}

async function readExtendsClosure(roots: string[], files: ReadonlySet<string>, readTexts: ReadTexts): Promise<Map<string, TsConfig>> {
  const configs = new Map<string, TsConfig>();
  for (let pending = roots; pending.length > 0; ) {
    const texts = await readTexts(pending);
    for (const path of pending) configs.set(path, tsConfigOf(texts.get(path)));
    const parents = pending.flatMap((path) => parentsOf(path, configs.get(path), files));
    pending = [...new Set(parents)].filter((parent) => !configs.has(parent));
  }
  return configs;
}

function tsConfigOf(text: string | undefined): TsConfig {
  const document = validated(TsConfigDocumentSchema, text, Bun.JSONC.parse);
  if (!document) return unreadable;
  const options = CompilerOptionsSchema.safeParse(document.compilerOptions ?? {});
  const references = ExtendsSchema.parse(document.extends ?? []);
  if (!options.success) return { ...unreadable, extends: references };
  return { extends: references, baseUrl: fieldOf(z.string(), options.data.baseUrl), paths: fieldOf(PathsSchema, options.data.paths) };
}

function fieldOf<Value>(schema: z.ZodType<Value>, value: unknown): Value | Invalid | undefined {
  if (value === undefined) return undefined;
  const result = schema.safeParse(value);
  return result.success ? result.data : invalid;
}

function parentsOf(path: string, config: TsConfig | undefined, files: ReadonlySet<string>): string[] {
  return (config?.extends ?? []).flatMap((reference) => {
    if (!relativeReference.test(reference)) return [];
    const target = posix.join(posix.dirname(path), reference);
    return [target, `${target}.json`].filter((candidate) => files.has(candidate)).slice(0, 1);
  });
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
