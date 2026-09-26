import { z } from "zod";

export const DiffLineSchema = z.object({
  kind: z.enum(["ctx", "add", "del"]),
  old: z.number().int().nullable(),
  new: z.number().int().nullable(),
  text: z.string(),
});

export const FileStatusSchema = z.enum(["added", "modified", "deleted", "renamed", "unchanged"]);

export const SymbolKindSchema = z.enum(["function", "class", "method", "object", "describe", "test", "hook"]);

export const PackageSchema = z.object({ root: z.string(), name: z.string() });

export const FileSchema = z.object({
  path: z.string(),
  status: FileStatusSchema,
  previousPath: z.string().optional(),
  role: z.enum(["test", "production"]),
  package: z.string(),
  diff: z.array(DiffLineSchema),
});

export const SymbolSchema = z.object({
  id: z.string(),
  file: z.string(),
  name: z.string(),
  kind: SymbolKindSchema,
  parentId: z.string().optional(),
  range: z.object({ start: z.number().int(), end: z.number().int() }),
  change: z.enum(["added", "modified", "unchanged"]),
  signatureChanged: z.boolean(),
  hop: z.number().int().nonnegative(),
});

export const CallSchema = z.object({ from: z.string(), to: z.string(), sites: z.array(z.number().int()) });

export const ImportSchema = z.object({ from: z.string(), to: z.string() });

export const GraphSchema = z.object({
  version: z.literal(1),
  generator: z.object({ name: z.literal("uml-pr-review"), version: z.string() }),
  pr: z.object({
    url: z.string(),
    repo: z.string(),
    number: z.number().int(),
    title: z.string(),
    headSha: z.string(),
    baseSha: z.string(),
    baseRef: z.string(),
  }),
  packages: z.array(PackageSchema),
  files: z.array(FileSchema),
  symbols: z.array(SymbolSchema),
  calls: z.array(CallSchema),
  imports: z.array(ImportSchema),
  warnings: z.array(z.string()),
});

export type DiffLine = z.infer<typeof DiffLineSchema>;
export type FileStatus = z.infer<typeof FileStatusSchema>;
export type SymbolKind = z.infer<typeof SymbolKindSchema>;
export type Package = z.infer<typeof PackageSchema>;
export type GraphFile = z.infer<typeof FileSchema>;
export type GraphSymbol = z.infer<typeof SymbolSchema>;
export type Call = z.infer<typeof CallSchema>;
export type Import = z.infer<typeof ImportSchema>;
export type Graph = z.infer<typeof GraphSchema>;

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function canonical(graph: Graph): Graph {
  const parsed = GraphSchema.parse(graph);
  return {
    ...parsed,
    packages: [...parsed.packages].sort((a, b) => byText(a.root, b.root)),
    files: [...parsed.files].sort((a, b) => byText(a.path, b.path)),
    symbols: [...parsed.symbols].sort(
      (a, b) => byText(a.file, b.file) || a.range.start - b.range.start || byText(a.id, b.id),
    ),
    calls: parsed.calls
      .map((call) => ({ ...call, sites: [...call.sites].sort((a, b) => a - b) }))
      .sort((a, b) => byText(a.from, b.from) || byText(a.to, b.to)),
    imports: [...parsed.imports].sort((a, b) => byText(a.from, b.from) || byText(a.to, b.to)),
    warnings: [...parsed.warnings].sort(byText),
  };
}

export const serializeGraph = (graph: Graph) => `${JSON.stringify(canonical(graph), null, 2)}\n`;
