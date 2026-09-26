import { describe, expect, test } from "bun:test";
import { configBlocks, documentStatements, isGuidanceDocument, moduleNamesOf } from "../lib/written-rules.ts";

describe("documentStatements", () => {
  test("keeps normative lines with their line numbers and skips headings, prose, and code", () => {
    const markdown = [
      "# Contributing to workflows",
      "",
      "Workflows run Hog code via templates.",
      "- Choose a stable, unique `id`; the frontend must use it as `template_id`.",
      "```ts",
      "// you must not copy this",
      "```",
      "1. Always validate your arguments.",
    ].join("\n");

    expect(documentStatements(markdown)).toEqual([
      { line: 4, text: "Choose a stable, unique `id`; the frontend must use it as `template_id`." },
      { line: 8, text: "Always validate your arguments." },
    ]);
  });
});

describe("configBlocks", () => {
  test("returns the TOML tables that name the scope's module", () => {
    const toml = ['[[modules]]', 'path = "products.cohorts"', 'depends_on = ["posthog"]', "", '[[modules]]', 'path = "products.workflows"', 'depends_on = ["posthog", "products.cdp"]'].join("\n");

    expect(configBlocks(toml, moduleNamesOf("products/workflows"))).toEqual([{ line: 5, text: '[[modules]]\npath = "products.workflows"\ndepends_on = ["posthog", "products.cdp"]' }]);
  });
});

describe("isGuidanceDocument", () => {
  test("recognises agent, contributor, spec, and skill documents but not other markdown", () => {
    const paths = ["products/workflows/CONTRIBUTING.md", "products/workflows/backend/_.spec.md", "products/workflows/skills/building-workflows/references/graph-schema.md", "products/workflows/backend/templates/email.md"];

    expect(paths.filter(isGuidanceDocument)).toEqual(paths.slice(0, 3));
  });
});
