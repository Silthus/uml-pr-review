#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ArchitecturePayloadSchema, type ArchitecturePayload, type FileRole, type ImportKind, type Language, type ModuleKind } from "../../architecture/contracts/index.ts";

const edgeKinds: ImportKind[] = ["static", "type", "lazy", "reexport", "dynamic", "require"];
const languages = new Set<Language>(["python", "typescript", "javascript", "rust"]);
const moduleKinds = new Set<ModuleKind>(["root", "product", "package", "layer", "django-app", "scene", "tests", "migrations", "generated", "python-package", "directory"]);

type PrototypePayload = {
  repository: string;
  commit: string | null;
  modules: [string, string, number | null, string, number, number][];
  files: [string, number, string][];
  edges: [number, number, number][];
};

async function main() {
  const input = process.argv[2];
  const output = process.argv[3] ?? "src/explorer/dev/posthog-architecture.fixture.json";
  if (!input) throw new Error("Usage: bun run src/explorer/dev/convert-posthog-fixture.ts <prototype-json> [output-json]");
  const raw = (await Bun.file(input).json()) as PrototypePayload;
  const payload: ArchitecturePayload = ArchitecturePayloadSchema.parse({
    version: 1,
    repository: { id: "posthog/.git", root: "/fixtures/posthog", commonDir: "/fixtures/posthog/.git", name: raw.repository },
    commit: raw.commit,
    tree: raw.commit ?? "0".repeat(40),
    modules: raw.modules.map(([path, label, parent, kind, directFiles, totalFiles]) => [path, label, parent ?? -1, moduleKind(kind), directFiles, totalFiles]),
    files: raw.files.map(([path, module, language]) => [path, module, fileLanguage(language), fileRole(path)]),
    imports: raw.edges.map(([from, to, kind]) => [from, to, edgeKinds[kind] ?? "static", 1, []]),
    unresolved: [],
    stats: { files: raw.files.length, imports: raw.edges.length, parsed: raw.files.length, cacheHits: 0, failed: 0, milliseconds: 0 },
  });
  await mkdir(dirname(output), { recursive: true });
  await Bun.write(output, `${JSON.stringify(payload)}\n`);
  console.log(`wrote ${output}`);
}

function moduleKind(kind: string): ModuleKind {
  return moduleKinds.has(kind as ModuleKind) ? (kind as ModuleKind) : "directory";
}

function fileLanguage(language: string): Language {
  if (languages.has(language as Language)) return language as Language;
  if (language === "tsx" || language === "ts") return "typescript";
  if (language === "jsx" || language === "js") return "javascript";
  return "python";
}

function fileRole(path: string): FileRole {
  return /(^|\/)(tests?|__tests__|__snapshots__|__mocks__|e2e)\//.test(path) || /(^|\/)test_[^/]*\.py$/.test(path) || /_test\.py$/.test(path) || /\.(test|spec)\.[mc]?[jt]sx?$/.test(path) ? "test" : "production";
}

await main();
