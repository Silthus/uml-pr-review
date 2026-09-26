import { z } from "zod";
import type { Ladder } from "./contract.ts";
import { tally } from "./drivers.ts";

const RuleSchema = z.object({ currentLevel: z.string() }).loose();
const RulesFileSchema = z.union([z.array(RuleSchema), z.object({ rules: z.array(RuleSchema) }).loose().transform(({ rules }) => rules)]);

export async function readLadder(path: string | undefined): Promise<Ladder> {
  if (path === undefined || !(await Bun.file(path).exists())) return null;
  const rules = RulesFileSchema.parse(await Bun.file(path).json());
  return { rules: rules.length, levels: tally(rules, ({ currentLevel }) => currentLevel) };
}
