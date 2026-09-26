import { z } from "zod";

export const ModuleKindSchema = z.enum(["root", "product", "package", "layer", "django-app", "scene", "tests", "migrations", "generated", "python-package", "directory"]);
export const LanguageSchema = z.enum(["python", "typescript", "javascript", "rust"]);
export const ImportKindSchema = z.enum(["static", "type", "lazy", "reexport", "dynamic", "require"]);
export const FileRoleSchema = z.enum(["production", "test"]);

export const RepositoryRefSchema = z.object({
  id: z.string(),
  root: z.string(),
  commonDir: z.string(),
  name: z.string(),
});

export const ArchitecturePayloadSchema = z.object({
  version: z.literal(1),
  repository: RepositoryRefSchema,
  commit: z.string().nullable(),
  tree: z.string(),
  modules: z.array(z.tuple([z.string(), z.string(), z.number().int(), ModuleKindSchema, z.number().int(), z.number().int()])),
  files: z.array(z.tuple([z.string(), z.number().int(), LanguageSchema, FileRoleSchema])),
  imports: z.array(z.tuple([z.number().int(), z.number().int(), ImportKindSchema, z.number().int(), z.array(z.string())])),
  unresolved: z.array(z.tuple([z.number().int(), z.number().int(), z.string()])),
  stats: z.object({ files: z.number().int(), imports: z.number().int(), parsed: z.number().int(), cacheHits: z.number().int(), failed: z.number().int(), milliseconds: z.number().int() }),
});

export const ChangedFileSchema = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted"]),
  firstChangedLine: z.number().int().positive(),
});

export const ModuleViewSchema = z.object({
  path: z.string(),
  label: z.string(),
  kind: ModuleKindSchema,
  parent: z.string().nullable(),
  childCount: z.number().int(),
  directFiles: z.number().int(),
  totalFiles: z.number().int(),
});

export const DependencySchema = z.object({ from: z.string(), to: z.string(), imports: z.number().int() });

export const FarDependencySchema = z.object({
  module: z.string(),
  imports: z.number().int(),
  via: z.array(z.object({ module: z.string(), imports: z.number().int() })),
});

export const ImportEvidenceSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  target: z.string(),
  kind: ImportKindSchema,
  names: z.array(z.string()),
  test: z.boolean(),
});

export const SearchHitSchema = z.object({ module: ModuleViewSchema, files: z.array(z.string()) });

export type ModuleKind = z.infer<typeof ModuleKindSchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type ImportKind = z.infer<typeof ImportKindSchema>;
export type FileRole = z.infer<typeof FileRoleSchema>;
export type RepositoryRef = z.infer<typeof RepositoryRefSchema>;
export type ArchitecturePayload = z.infer<typeof ArchitecturePayloadSchema>;
export type ChangedFile = z.infer<typeof ChangedFileSchema>;
export type ModuleView = z.infer<typeof ModuleViewSchema>;
export type Dependency = z.infer<typeof DependencySchema>;
export type FarDependency = z.infer<typeof FarDependencySchema>;
export type ImportEvidence = z.infer<typeof ImportEvidenceSchema>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
