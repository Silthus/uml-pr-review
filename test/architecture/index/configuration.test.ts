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
        "app/use.ts": 'import "@lib/api";\n',
        "lib/api.ts": "",
      }),
    ).toEqual({ imports: ["app/use.ts:1 -> lib/api.ts static"], unresolved: [] });
  });

  test("prefers the exact extends path over the same path with .json appended", async () => {
    expect(
      await indexOf({
        "tsconfig.json": JSON.stringify({ extends: "./base" }),
        base: JSON.stringify({ compilerOptions: { paths: { "@a/*": ["exact/*"] } } }),
        "base.json": JSON.stringify({ compilerOptions: { paths: { "@a/*": ["appended/*"] } } }),
        "app/use.ts": 'import "@a/x";\n',
        "exact/x.ts": "",
        "appended/x.ts": "",
      }),
    ).toEqual({ imports: ["app/use.ts:1 -> exact/x.ts static"], unresolved: [] });
  });

  test("reads each config of a deep extends diamond once", async () => {
    const depth = 40;
    const level = (index: number) => (index === depth ? { compilerOptions: { baseUrl: "..", paths: { "@lib/*": ["lib/*"] } } } : { extends: [`./a${index + 1}.json`, `./b${index + 1}.json`] });
    const diamond = Object.fromEntries(Array.from({ length: depth }, (_, index) => [[`configs/a${index + 1}.json`, JSON.stringify(level(index + 1))], [`configs/b${index + 1}.json`, JSON.stringify(level(index + 1))]]).flat());

    expect(
      await indexOf({
        ...diamond,
        "tsconfig.json": JSON.stringify({ extends: ["./configs/a1.json", "./configs/b1.json"] }),
        "app/use.ts": 'import "@lib/api";\n',
        "lib/api.ts": "",
      }),
    ).toEqual({ imports: ["app/use.ts:1 -> lib/api.ts static"], unresolved: [] });
  });
});

describe("malformed configuration", () => {
  test("reports imports through an alias with invalid targets as unresolved and keeps the valid aliases", async () => {
    expect(
      await indexOf({
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@lib/*": 42, "@mixed/*": ["ok/*", 3], "@ok/*": ["ok/*"] } } }),
        "app/use.ts": 'import "@lib/api";\nimport "@mixed/thing";\nimport "@ok/thing";\n',
        "ok/thing.ts": "",
      }),
    ).toEqual({ imports: ["app/use.ts:3 -> ok/thing.ts static"], unresolved: ["app/use.ts:1 @lib/api", "app/use.ts:2 @mixed/thing"] });
  });

  const brokenConfigs: [string, Files][] = [
    ["paths that are not an object", { "tsconfig.json": JSON.stringify({ compilerOptions: { paths: [["@lib/*", "lib/*"]] } }) }],
    ["baseUrl that is not a string", { "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: { baseUrl: 5, paths: { "@lib/*": ["lib/*"] } } }), "base.json": JSON.stringify({ compilerOptions: { baseUrl: "." } }) }],
    ["compilerOptions that are not an object", { "tsconfig.json": JSON.stringify({ compilerOptions: "strict" }) }],
    ["paths that would otherwise be inherited", { "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: { paths: "oops" } }), "base.json": JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["lib/*"] } } }) }],
    ["syntax error", { "tsconfig.json": '{ "compilerOptions": { "paths": { "@lib/*": ["lib/*"' }],
  ];

  test.each(brokenConfigs)("reports bare imports governed by a tsconfig with %s as unresolved", async (_, config) => {
    expect(
      await indexOf({
        ...config,
        "app/use.ts": 'import "@lib/api";\nimport "react";\nimport "./local";\n',
        "app/local.ts": "",
        "lib/api.ts": "",
      }),
    ).toEqual({ imports: ["app/use.ts:3 -> app/local.ts static"], unresolved: ["app/use.ts:1 @lib/api", "app/use.ts:2 react"] });
  });

  test("follows the valid entries of an extends array and skips the invalid ones", async () => {
    expect(
      await indexOf({
        "tsconfig.json": JSON.stringify({ extends: [3, "./base.json", { path: "./other.json" }] }),
        "base.json": JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["lib/*"] } } }),
        "app/use.ts": 'import "@lib/api";\n',
        "lib/api.ts": "",
      }),
    ).toEqual({ imports: ["app/use.ts:1 -> lib/api.ts static"], unresolved: [] });
  });

  test("ignores package.json fields of the wrong type", async () => {
    expect(
      await indexOf({
        "package.json": "42",
        "packages/nameless/package.json": JSON.stringify({ name: 42, main: "./src/index.ts" }),
        "packages/nameless/src/index.ts": "",
        "packages/odd/package.json": JSON.stringify({ name: "odd", main: 5, exports: { ".": 9 } }),
        "packages/odd/src/index.ts": "",
        "app/use.ts": 'import "odd";\n',
      }),
    ).toEqual({ imports: ["app/use.ts:1 -> packages/odd/src/index.ts static"], unresolved: [] });
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
