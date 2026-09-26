import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildReport } from "../../coherence/report/build.ts";
import { backfillFixture, type BackfillFixture } from "./backfill-fixture.ts";

const toolTimeoutMs = 300_000;

let fixture: BackfillFixture;
let html: string;
let markdown: string;

beforeAll(async () => {
  fixture = await backfillFixture();
  const outDir = join(fixture.dataDir, "report");
  await buildReport({ dataDir: fixture.dataDir, outDir, repository: fixture.repository.dir, modulesFor: "products/a", github: "example/repo" });
  html = await readFile(join(outDir, "index-report.html"), "utf8");
  markdown = await readFile(join(outDir, "index-report.md"), "utf8");
}, toolTimeoutMs);

afterAll(() => fixture.cleanup());

describe("the coherence report", () => {
  test("is one self-contained page with a composite chart and one chart per dimension, each drawing the measured noise band", () => {
    expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)="(?:https?:)?\/\//);
    expect(html.match(/<figure class="chart"/g)).toHaveLength(5);
    const bandsWithWidth = Object.values(fixture.manifest.scopes).flatMap(({ noise }) => Object.values(noise.band)).filter((band) => band > 0).length;
    expect(html.match(/class="noise-band/g)).toHaveLength(bandsWithWidth);
    expect(bandsWithWidth).toBeGreaterThan(0);
    for (const scope of ["products/a", "products/b"]) expect(html).toContain(scope);
  });

  test("links the biggest movers to their commit and pull request and says how far they exceed the noise band", () => {
    const merge = fixture.commits.merge!;

    expect(html).toContain(`https://github.com/example/repo/pull/42`);
    expect(html).toContain(`https://github.com/example/repo/commit/${merge}`);
    expect(html).toContain("Remove the busy function");
    expect(html).toMatch(/×\s*band/);
  });

  test("ranks the modules of the treated scope at the latest commit from worst to best with the raw numbers behind each sub-score", () => {
    expect(html).toContain("a modules at <code>");
    expect(html).toContain("<b>backend</b>");
    expect(html).toContain("p90 CCN");
    expect(html).toContain("ruff / KLOC");
  });

  test("summarises the same numbers in markdown", () => {
    const band = fixture.manifest.scopes["products/a"]!.noise.band.composite.toFixed(1);

    expect(markdown).toContain("# Coherence Index");
    expect(markdown).toContain(`| products/a |`);
    expect(markdown).toContain(band);
    expect(markdown).toContain("https://github.com/example/repo/pull/42");
  });
});
