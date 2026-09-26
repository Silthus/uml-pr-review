import { z } from "zod";
import type { Ladder } from "./contract.ts";
import { tally } from "./drivers.ts";

const RuleSchema = z.object({ currentLevel: z.string() }).loose();
const RulesFileSchema = z.union([z.array(RuleSchema), z.object({ rules: z.array(RuleSchema) }).loose().transform(({ rules }) => rules)]);

export async function readLadder(path: string | undefined): Promise<Ladder> {
  if (path === undefined || !(await Bun.file(path).exists())) return null;
  const text = await Bun.file(path).text();
  const rules = RulesFileSchema.parse(JSON.parse(text));
  return { source: `sha256:${new Bun.CryptoHasher("sha256").update(text).digest("hex")}`, rules: rules.length, levels: tally(rules, ({ currentLevel }) => currentLevel) };
}
