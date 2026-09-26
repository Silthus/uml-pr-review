#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ArchitecturePayloadSchema, ArchitecturePlanSchema } from "../../architecture/contracts/index.ts";
import { ArchitectureModel } from "../../architecture/model/index.ts";
import type { ArchitectureSource } from "../../../test/support/architecture.ts";
import { ancestorsOf } from "../graph/paths.ts";

const planPath = process.argv[2];
if (!planPath) throw new Error("Usage: bun run src/explorer/dev/extract-plan-fixture.ts <plan-json> [architecture-json] [output-json]");
const input = process.argv[3] ?? "src/explorer/dev/posthog-architecture.fixture.json";
const output = process.argv[4] ?? "test/explorer/fixtures/posthog-plan-focus.json";
const planFile = (await Bun.file(planPath).json()) as { plan?: unknown };
const plan = ArchitecturePlanSchema.parse(planFile.plan ?? planFile);
const model = new ArchitectureModel(ArchitecturePayloadSchema.parse(await Bun.file(input).json()));
const planned = new Set([...plan.modules.map((module) => module.path), ...plan.seams.flatMap((seam) => [seam.from, seam.to])]);
const { dependencies } = model.lift(new Set([...planned].flatMap(ancestorsOf)));
const touching = dependencies.filter((dependency) => planned.has(dependency.from) || planned.has(dependency.to));
const source: ArchitectureSource = Object.fromEntries([...planned, ...touching.flatMap((dependency) => [dependency.from, dependency.to])].map((path) => [fileOf(path), []]));
for (const dependency of touching) source[fileOf(dependency.from)]!.push(fileOf(dependency.to));
await mkdir(dirname(output), { recursive: true });
await Bun.write(output, `${JSON.stringify(source)}\n`);
console.log(`wrote ${output}: ${Object.keys(source).length} modules, ${touching.length} dependencies`);

function fileOf(modulePath: string): string {
  return `${modulePath}/__init__.py`;
}
