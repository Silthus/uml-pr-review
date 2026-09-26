import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { harvestSchema } from "./lib/items.ts";
import { renderSources, renderTheory } from "./lib/render.ts";
import { assembleTheory } from "./lib/theory.ts";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { harvest: { type: "string" }, draft: { type: "string" }, out: { type: "string" } } });
if (!values.harvest || !values.draft || !values.out) {
  console.error("Usage: bun harvest/assemble.ts --harvest <harvest.json> --draft <theory-draft.json> --out <dir>\n  Checks every evidence link and quote against the harvest, then writes rules.json, THEORY.draft.md, and sources.md.");
  process.exit(1);
}

const harvest = harvestSchema.parse(await Bun.file(values.harvest).json());
const theory = assembleTheory(await Bun.file(values.draft).json(), harvest);
await mkdir(values.out, { recursive: true });
await Bun.write(join(values.out, "rules.json"), `${JSON.stringify(theory, null, 2)}\n`);
await Bun.write(join(values.out, "THEORY.draft.md"), renderTheory(theory));
await Bun.write(join(values.out, "sources.md"), renderSources(harvest, theory));
console.log(`${theory.rules.length} rules, ${theory.backlog.length} on the ladder backlog, written to ${values.out}`);
