import { z } from "zod";

const ScoreSchema = z.number().min(0).max(100);

export const MeasureSchema = z.object({ value: z.number().nullable(), score: ScoreSchema.nullable(), best: z.number(), worst: z.number() });

const FileCountSchema = z.object({ file: z.string(), count: z.number().int() });

const DimensionBase = { score: ScoreSchema.nullable(), measures: z.record(z.string(), MeasureSchema) };

export const ComplexitySchema = z.object({
  ...DimensionBase,
  functions: z.object({ count: z.number().int(), p50Ccn: z.number(), p90Ccn: z.number(), overTen: z.number().int(), overTwenty: z.number().int(), p90Nloc: z.number() }),
  files: z.object({ count: z.number().int(), p90Lines: z.number() }),
  drivers: z.array(z.object({ file: z.string(), function: z.string(), ccn: z.number().int(), nloc: z.number().int() })),
});

export const ModuleCouplingSchema = z.object({ path: z.string(), fanIn: z.number().int(), fanOut: z.number().int(), instability: z.number().nullable() });

const CrossingCountSchema = z.object({ crossings: z.number().int(), bypasses: z.number().int() });

export const ArchitectureSchema = z.object({
  ...DimensionBase,
  propagationCost: z.object({ value: z.number(), files: z.number().int(), outboundFiles: z.number().int(), drivers: z.array(FileCountSchema) }),
  cycles: z.object({ count: z.number().int(), files: z.array(z.string()) }),
  facade: z.object({
    crossings: z.number().int(),
    inbound: CrossingCountSchema,
    outbound: CrossingCountSchema,
    bypasses: z.array(z.object({ from: z.string(), to: z.string(), direction: z.enum(["inbound", "outbound"]) })),
  }),
  undeclaredDependencies: z.array(z.object({ from: z.string(), to: z.string() })).nullable(),
  modules: z.array(ModuleCouplingSchema),
});

const DensitySchema = z.object({ count: z.number().int(), perKloc: z.number().nullable(), drivers: z.array(FileCountSchema) });

export const SmellsSchema = z.object({
  ...DimensionBase,
  ruff: DensitySchema.extend({ rules: z.record(z.string(), z.number().int()) }),
  oxlint: DensitySchema.extend({ rules: z.record(z.string(), z.number().int()) }),
  duplication: z.object({ percentage: z.number(), duplicatedLines: z.number().int(), clones: z.number().int(), drivers: z.array(FileCountSchema) }),
  markers: DensitySchema,
  typeEscapes: DensitySchema.extend({
    counts: z.object({ any: z.number().int(), typeIgnore: z.number().int(), tsIgnore: z.number().int(), asAny: z.number().int(), eslintDisable: z.number().int() }),
  }),
});

export const TestsSchema = z.object({
  ...DimensionBase,
  ratio: z.object({ testLines: z.number().int(), productionLines: z.number().int(), value: z.number().nullable() }),
  facadeCoverage: z.object({ functions: z.number().int(), covered: z.number().int(), share: z.number().nullable(), uncovered: z.array(z.string()) }),
});

export const LadderSchema = z.object({ source: z.string(), rules: z.number().int(), levels: z.record(z.string(), z.number().int()) }).nullable();

export const DimensionWeightsSchema = z.object({ architecture: z.number(), complexity: z.number(), smells: z.number(), tests: z.number() });

export const CoherenceIndexSchema = z.object({
  version: z.literal(1),
  scoringVersion: z.number().int().default(1),
  scope: z.string(),
  commit: z.string(),
  tree: z.string(),
  tools: z.record(z.string(), z.string()),
  files: z.object({ production: z.number().int(), test: z.number().int(), excluded: z.number().int(), productionLines: z.number().int(), testLines: z.number().int(), generatedLines: z.number().int() }),
  composite: z.object({ score: ScoreSchema, weights: DimensionWeightsSchema }),
  dimensions: z.object({ architecture: ArchitectureSchema, complexity: ComplexitySchema, smells: SmellsSchema, tests: TestsSchema, ladder: LadderSchema }),
});

export const TimingSchema = z.object({ milliseconds: z.number().int(), cache: z.object({ hits: z.number().int(), misses: z.number().int() }) });

export const CoherenceReportSchema = z.object({ index: CoherenceIndexSchema, timing: TimingSchema });

export type Measure = z.infer<typeof MeasureSchema>;
export type FileCount = z.infer<typeof FileCountSchema>;
export type Complexity = z.infer<typeof ComplexitySchema>;
export type Architecture = z.infer<typeof ArchitectureSchema>;
export type ModuleCoupling = z.infer<typeof ModuleCouplingSchema>;
export type Smells = z.infer<typeof SmellsSchema>;
export type Tests = z.infer<typeof TestsSchema>;
export type Ladder = z.infer<typeof LadderSchema>;
export type DimensionWeights = z.infer<typeof DimensionWeightsSchema>;
export type CoherenceIndex = z.infer<typeof CoherenceIndexSchema>;
export type Timing = z.infer<typeof TimingSchema>;
export type CoherenceReport = z.infer<typeof CoherenceReportSchema>;
