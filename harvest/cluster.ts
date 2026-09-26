import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { harvestSchema } from "./lib/items.ts";
import { clusteringInputs, clusteringPrompt } from "./lib/clustering.ts";

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { harvest: { type: "string" }, product: { type: "string" }, work: { type: "string" }, out: { type: "string" } } });
if (!values.harvest || !values.product || !values.work || !values.out) {
  console.error("Usage: bun harvest/cluster.ts --harvest <harvest.json> --product <name> --work <dir> --out <docs dir>\n  Writes the per-source inputs and the clustering prompt for an Opus agent into <dir>. The agent writes <dir>/draft.json and validates it with assemble.ts.");
  process.exit(1);
}

const harvestPath = resolve(values.harvest);
const work = resolve(values.work);
const harvest = harvestSchema.parse(await Bun.file(harvestPath).json());
await mkdir(work, { recursive: true });
for (const [source, lines] of Object.entries(clusteringInputs(harvest))) await Bun.write(join(work, `${source}.jsonl`), lines);
const template = await Bun.file(join(import.meta.dir, "clustering-prompt.md")).text();
const draft = join(work, "draft.json");
const assemble = `bun ${join(import.meta.dir, "assemble.ts")} --harvest ${harvestPath} --draft ${draft} --out ${resolve(values.out)}`;
await Bun.write(join(work, "prompt.md"), clusteringPrompt(template, { product: values.product, harvest: harvestPath, workdir: work, draft, assemble }, harvest));
console.log(`Hand ${join(work, "prompt.md")} to an Opus agent, for example: claude -p --model opus < ${join(work, "prompt.md")}`);
