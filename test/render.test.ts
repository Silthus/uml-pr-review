import { expect, test } from "bun:test";
import { renderArtifact } from "../src/render/artifact";
import type { RenderModel } from "../src/render/model";
import fixture from "./fixtures/lonir-4819.render.json";

test("renders the lonir fixture deterministically", async () => {
  const first = await renderArtifact(fixture as RenderModel);
  const second = await renderArtifact(fixture as RenderModel);

  expect(first.startsWith("<!doctype html>")).toBe(true);
  expect(first).toContain(fixture.pr.title);
  expect(second).toBe(first);
});

test("renders a deleted file with no symbols", async () => {
  const html = await renderArtifact({
    pr: {
      url: "https://github.com/example/repo/pull/1",
      number: 1,
      headSha: "abc123",
      title: "delete config file",
    },
    modules: [],
    files: [
      {
        id: "config/old.yml",
        path: "config/old.yml",
        touched: true,
        status: "deleted",
        moduleId: null,
        role: "production",
        library: false,
        changedLines: [],
        deleteAnchors: [1],
        removedLines: [{ anchor: 1, old: 1, text: "old: true" }],
      },
    ],
    symbols: [],
    edges: [],
    warnings: [],
  });

  expect(html).toContain("old.yml");
  expect(html).toContain("deleted, 0 lines outside any symbol");
});
