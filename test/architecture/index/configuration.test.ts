import { afterEach, describe, expect, test } from "bun:test";
import { createRepositoryIndexer } from "../../../src/architecture/index/index.ts";
import { importsOf, temporaryRepository, unresolvedOf, type Files, type TemporaryRepository } from "./repository.ts";

const repositories: TemporaryRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

async function indexOf(files: Files) {
  const repository = await temporaryRepository(files);
  repositories.push(repository);
  const payload = await createRepositoryIndexer({ workers: 1 }).index(repository.dir, { commit: "HEAD" });
  return { imports: importsOf(payload), unresolved: unresolvedOf(payload) };
}

describe("tsconfig inheritance", () => {
  test("follows relative extends to any JSON file and resolves inherited paths from the declaring config's baseUrl", async () => {
    expect(
      await indexOf({
        "tsconfig.json": JSON.stringify({ extends: "./config/base.json" }),
        "config/base.json": JSON.stringify({ compilerOptions: { baseUrl: "..", paths: { "@lib/*": ["lib/*"] } } }),
        "app/use.ts": 'import { api } from "@lib/api";\n',
        "lib/api.ts": "export const api = 1;\n",
      }),
    ).toEqual({ imports: ["app/use.ts:1 -> lib/api.ts static [api]"], unresolved: [] });
  });

  test("resolves inherited paths without a baseUrl from the declaring config's directory, through extends without an extension", async () => {
    expect(
      await indexOf({
        "web/tsconfig.json": JSON.stringify({ extends: ["./tsconfig.strict", "../shared/aliases"] }),
        "web/tsconfig.strict.json": JSON.stringify({ compilerOptions: { strict: true } }),
        "shared/aliases.json": JSON.stringify({ compilerOptions: { paths: { "@shared/*": ["./src/*"] } } }),
        "web/app.ts": 'import "@shared/format";\n',
        "shared/src/format.ts": "",
      }),
    ).toEqual({ imports: ["web/app.ts:1 -> shared/src/format.ts static"], unresolved: [] });
  });

  test("takes a baseUrl from the extending config for paths it inherits", async () => {
    expect(
      await indexOf({
        "web/tsconfig.json": JSON.stringify({ extends: "./paths.json", compilerOptions: { baseUrl: "src" } }),
        "web/paths.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["*"] } } }),
        "web/src/app.ts": 'import "~/scenes/home";\n',
        "web/src/scenes/home.ts": "",
      }),
    ).toEqual({ imports: ["web/src/app.ts:1 -> web/src/scenes/home.ts static"], unresolved: [] });
  });

  test("stops at an extends cycle", async () => {
    expect(
      await indexOf({
        "tsconfig.json": JSON.stringify({ extends: "./loop.json" }),
        "loop.json": JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { paths: { "@lib/*": ["lib/*"] } } }),
        "app/use.ts": 'import "@lib/api";\nimport "@other/thing";\n',
        "lib/api.ts": "",
      }),
    ).toEqual({ imports: ["app/use.ts:1 -> lib/api.ts static"], unresolved: [] });
  });
});

describe("malformed configuration", () => {
  test("reports imports through an invalid alias as unresolved and keeps resolving everything else", async () => {
    expect(
      await indexOf({
        "tsconfig.json": JSON.stringify({ extends: 7, compilerOptions: { baseUrl: ["."], paths: { "@lib/*": 42, "@ok/*": ["ok/*"], "@mixed/*": ["ok/*", 3] } } }),
        "package.json": "42",
        "packages/broken/package.json": JSON.stringify({ name: 42, main: { not: "a path" }, exports: [1, 2] }),
        "packages/odd/package.json": JSON.stringify({ name: "odd", main: 5, exports: { ".": 9 } }),
        "packages/odd/src/index.ts": "",
        "app/use.ts": 'import "@lib/api";\nimport "@ok/thing";\nimport "@mixed/thing";\nimport "odd";\nimport "./local";\n',
        "app/local.ts": "",
        "ok/thing.ts": "",
      }),
    ).toEqual({
      imports: ["app/use.ts:5 -> app/local.ts static", "app/use.ts:2 -> ok/thing.ts static", "app/use.ts:4 -> packages/odd/src/index.ts static"],
      unresolved: ["app/use.ts:1 @lib/api", "app/use.ts:3 @mixed/thing"],
    });
  });
});

describe("package exports", () => {
  test("evaluates a root conditional export object before main and src/index", async () => {
    expect(
      await indexOf({
        "packages/pkg/package.json": JSON.stringify({ name: "pkg", main: "./src/index.ts", exports: { types: "./dist/api.d.ts", source: "./src/api.ts", default: "./dist/api.js" } }),
        "packages/pkg/src/api.ts": "export const api = 1;\n",
        "packages/pkg/src/index.ts": "",
        "app/use.ts": 'import { api } from "pkg";\n',
      }),
    ).toEqual({ imports: ["app/use.ts:1 -> packages/pkg/src/api.ts static [api]"], unresolved: [] });
  });
});
