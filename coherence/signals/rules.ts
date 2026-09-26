import { z } from "zod";

const EvidenceSchema = z.object({ url: z.string(), source: z.string() }).loose();

const RuleSchema = z
  .object({
    id: z.string(),
    statement: z.string(),
    kind: z.string(),
    component: z.string(),
    currentLevel: z.string(),
    proposedLevel: z.string(),
    evidence: z.array(EvidenceSchema),
  })
  .loose();

const HarvestSchema = z.object({ components: z.array(z.object({ name: z.string(), paths: z.array(z.string()) }).loose()), rules: z.array(RuleSchema) }).loose();

export type HarvestedRule = z.infer<typeof RuleSchema> & { paths: string[] };

export const enforcedLevels = new Set(["linted", "structural"]);
export const findingSources = new Set(["review", "bot-review", "session"]);

export async function readHarvestedRules(path: string): Promise<HarvestedRule[]> {
  if (!(await Bun.file(path).exists())) throw new Error(`no harvested rules at ${path}`);
  const { components, rules } = HarvestSchema.parse(await Bun.file(path).json());
  const pathsOf = new Map(components.map(({ name, paths }) => [name, paths]));
  return rules.map((rule) => ({ ...rule, paths: pathsOf.get(rule.component) ?? [] }));
}
