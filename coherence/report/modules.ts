import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CoherenceIndex } from "../contract.ts";
import { measureCoherence } from "../measure.ts";
import { compositeScore } from "../score.ts";

const RawSchema = z.object({
  propagationCost: z.number(),
  cycleFiles: z.number().int(),
  facadeBypasses: z.number().int(),
  p90Ccn: z.number(),
  shareOverTen: z.number().nullable(),
  p90Nloc: z.number(),
  p90FileLines: z.number(),
  ruffPerKloc: z.number().nullable(),
  oxlintPerKloc: z.number().nullable(),
  duplication: z.number(),
  markersPerKloc: z.number().nullable(),
  typeEscapesPerKloc: z.number().nullable(),
});

export const ModuleRowSchema = z.object({
  path: z.string(),
  files: z.number().int(),
  lines: z.number().int(),
  code: z.number(),
  scores: z.object({ architecture: z.number().nullable(), complexity: z.number().nullable(), smells: z.number().nullable() }),
  raw: RawSchema,
});

export const ModuleBreakdownSchema = z.object({ scope: z.string(), commit: z.string(), rows: z.array(ModuleRowSchema) });

export type ModuleRow = z.infer<typeof ModuleRowSchema>;
export type ModuleBreakdown = z.infer<typeof ModuleBreakdownSchema>;

const minimumFiles = 3;

export async function scoreModules(
  { repository, scope, commit, dataDir }: { repository: string | undefined; scope: string; commit: string; dataDir: string },
  log: (line: string) => void = () => {},
): Promise<ModuleBreakdown | null> {
  const file = join(dataDir, scope, `modules-${commit.slice(0, 12)}.json`);
  const stored = await readFile(file, "utf8").catch(() => null);
  if (stored !== null) return withoutPassThroughParents(ModuleBreakdownSchema.parse(JSON.parse(stored)));
  if (repository === undefined) return null;
  const rows: ModuleRow[] = [];
  for (const path of await modulePaths(repository, scope, commit)) {
    const { index } = await measureCoherence({ repository, scope: path, commit });
    if (index.files.production < minimumFiles) continue;
    rows.push(moduleRow(index));
    log(`${path} code ${rows.at(-1)!.code.toFixed(1)} (${index.files.production} files)`);
  }
  const breakdown = ModuleBreakdownSchema.parse({ scope, commit, rows: rows.sort((a, b) => a.code - b.code || a.path.localeCompare(b.path)) });
  await writeFile(file, JSON.stringify(breakdown, null, 2));
  return withoutPassThroughParents(breakdown);
}

function withoutPassThroughParents(breakdown: ModuleBreakdown): ModuleBreakdown {
  const isPassThrough = (parent: ModuleRow) => breakdown.rows.some((child) => child.path.startsWith(`${parent.path}/`) && child.files === parent.files && child.lines === parent.lines);
  return { ...breakdown, rows: breakdown.rows.filter((row) => !isPassThrough(row)) };
}

async function modulePaths(repository: string, scope: string, commit: string): Promise<string[]> {
  const { index } = await measureCoherence({ repository, scope, commit });
  return index.dimensions.architecture.modules.map(({ path }) => path).filter((path) => path !== scope);
}

function moduleRow(index: CoherenceIndex): ModuleRow {
  const { architecture, complexity, smells } = index.dimensions;
  const scores = { architecture: architecture.score, complexity: complexity.score, smells: smells.score };
  return {
    path: index.scope,
    files: index.files.production,
    lines: index.files.productionLines,
    code: compositeScore({ ...scores, tests: null }),
    scores,
    raw: {
      propagationCost: architecture.propagationCost.value,
      cycleFiles: architecture.cycles.files.length,
      facadeBypasses: architecture.facade.bypasses.length,
      p90Ccn: complexity.functions.p90Ccn,
      shareOverTen: complexity.measures.shareOverTen?.value ?? null,
      p90Nloc: complexity.functions.p90Nloc,
      p90FileLines: complexity.files.p90Lines,
      ruffPerKloc: smells.ruff.perKloc,
      oxlintPerKloc: smells.oxlint.perKloc,
      duplication: smells.duplication.percentage,
      markersPerKloc: smells.markers.perKloc,
      typeEscapesPerKloc: smells.typeEscapes.perKloc,
    },
  };
}
