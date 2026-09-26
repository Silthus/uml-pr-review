#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ArchitecturePayloadSchema } from "../../architecture/contracts/index.ts";
import { ArchitectureModel } from "../../architecture/model/index.ts";
import type { ArchitectureSource } from "../../../test/support/architecture.ts";

const input = process.argv[2] ?? "src/explorer/dev/posthog-architecture.fixture.json";
const output = process.argv[3] ?? "test/explorer/fixtures/posthog-products-expanded.json";
const model = new ArchitectureModel(ArchitecturePayloadSchema.parse(await Bun.file(input).json()));
const { modules, dependencies } = model.lift(new Set(["products"]));
const source: ArchitectureSource = Object.fromEntries(modules.filter((module) => module.path !== ".").map((module) => [fileOf(module.path), []]));
for (const dependency of dependencies) {
  if (dependency.from === "." || dependency.to === ".") continue;
  source[fileOf(dependency.from)]!.push(fileOf(dependency.to));
}
await mkdir(dirname(output), { recursive: true });
await Bun.write(output, `${JSON.stringify(source)}\n`);
console.log(`wrote ${output}: ${modules.length} modules, ${dependencies.length} dependencies`);

function fileOf(modulePath: string): string {
  return `${modulePath}/__init__.py`;
}
