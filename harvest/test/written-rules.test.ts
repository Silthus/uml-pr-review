import { describe, expect, test } from "bun:test";
import { ancestorGuidancePaths, configStatements, documentStatements, isGuidanceDocument, moduleNamesOf } from "../lib/written-rules.ts";

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

describe("configStatements", () => {
  test("returns the TOML tables that name the scope's module", () => {
    const toml = ['[[modules]]', 'path = "products.cohorts"', 'depends_on = ["posthog"]', "", '[[modules]]', 'path = "products.workflows"', 'depends_on = ["posthog", "products.cdp"]'].join("\n");

    expect(configStatements("tach.toml", toml, moduleNamesOf("products/workflows"))).toEqual([{ line: 5, text: '[[modules]]\npath = "products.workflows"\ndepends_on = ["posthog", "products.cdp"]' }]);
  });

  test("returns the lines that name the scope in any other config format", () => {
    const ini = ["[importlinter:contract:facade]", "source_modules = products.cohorts", "ignore_imports = products.workflows.backend.routes -> products.workflows.backend.api"].join("\n");

    expect(configStatements(".importlinter", ini, moduleNamesOf("products/workflows"))).toEqual([{ line: 3, text: "ignore_imports = products.workflows.backend.routes -> products.workflows.backend.api" }]);
  });
});

describe("ancestorGuidancePaths", () => {
  test("lists the agent guides that apply to the scope from the root down", () => {
    expect(ancestorGuidancePaths("products/workflows")).toEqual(["AGENTS.md", "CLAUDE.md", "products/AGENTS.md", "products/CLAUDE.md"]);
  });
});

describe("isGuidanceDocument", () => {
  test("recognises agent, contributor, spec, and skill documents but not other markdown", () => {
    const paths = ["products/workflows/CONTRIBUTING.md", "products/workflows/backend/_.spec.md", "products/workflows/skills/building-workflows/references/graph-schema.md", "products/workflows/backend/templates/email.md"];

    expect(paths.filter(isGuidanceDocument)).toEqual(paths.slice(0, 3));
  });
});
