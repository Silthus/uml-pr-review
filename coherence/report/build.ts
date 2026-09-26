#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readManifest } from "../backfill.ts";
import { renderHtml } from "./html.ts";
import { renderMarkdown } from "./markdown.ts";
import { buildModel, type ReportModel } from "./model.ts";
import { scoreModules } from "./modules.ts";

export type BuildRequest = { dataDir: string; outDir: string; repository?: string; modulesFor?: string; github?: string; intervention?: string; built?: Date };

export async function buildReport(request: BuildRequest, log: (line: string) => void = () => {}): Promise<ReportModel> {
  const manifest = await readManifest(request.dataDir);
  const modules = await moduleBreakdown(manifest, request, log);
  const model = buildModel(manifest, { github: request.github, modules, intervention: request.intervention, built: request.built ?? new Date() });
  await mkdir(request.outDir, { recursive: true });
  await writeFile(join(request.outDir, "index-report.html"), renderHtml(model));
  await writeFile(join(request.outDir, "index-report.md"), renderMarkdown(model));
  return model;
}

async function moduleBreakdown(manifest: Awaited<ReturnType<typeof readManifest>>, { modulesFor, repository, dataDir }: BuildRequest, log: (line: string) => void) {
  const scope = modulesFor ?? Object.keys(manifest.scopes)[0];
  const latest = scope === undefined ? undefined : manifest.scopes[scope]?.points.at(-1);
  if (scope === undefined || latest === undefined) return null;
  return scoreModules({ repository, scope, commit: latest.commit, date: latest.date, dataDir }, log);
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      data: { type: "string", default: join(import.meta.dir, "..", "data") },
      out: { type: "string", default: join(import.meta.dir, "..", "..", "docs", "coherence") },
      repo: { type: "string" },
      modules: { type: "string" },
      github: { type: "string" },
      intervention: { type: "string" },
    },
  });
  const model = await buildReport(
    { dataDir: resolve(values.data), outDir: resolve(values.out), repository: values.repo ? resolve(values.repo) : undefined, modulesFor: values.modules, github: values.github, intervention: values.intervention },
    (line) => console.error(line),
  );
  console.log(`Report for ${model.scopes.length} scopes over ${model.weeks.length} weeks written to ${resolve(values.out)}/index-report.{html,md}`);
}
