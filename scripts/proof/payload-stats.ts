import { gunzipSync } from "node:zlib";
import type { ArchitecturePayload } from "../../src/architecture/contracts/index.ts";
import { ArchitectureModel } from "../../src/architecture/model/index.ts";

const [payloadPath] = process.argv.slice(2);
if (!payloadPath) throw new Error("Usage: bun scripts/proof/payload-stats.ts <gzipped GET /api/architecture body>");

const payload = JSON.parse(gunzipSync(await Bun.file(payloadPath).bytes()).toString()) as ArchitecturePayload;
const model = new ArchitectureModel(payload);
const topLevel = model.children(".");
const products = model.children("products");
const kinds = Map.groupBy(products, (module) => module.kind);

console.log(`top-level modules: ${topLevel.length} (${topLevel.map((module) => module.path).join(", ")})`);
console.log(`children of products: ${products.length}; by kind: ${[...kinds].map(([kind, members]) => `${kind} ${members.length}`).join(", ")}`);
console.log(`stats: ${JSON.stringify(payload.stats)}`);
