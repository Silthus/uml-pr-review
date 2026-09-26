#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
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
  if (scope === undefined || !(scope in manifest.scopes)) return null;
  return scoreModules({ repository, scope, commit: manifest.head, dataDir }, log);
}

const ArgumentsSchema = z.object({
  data: z.string().min(1),
  out: z.string().min(1),
  repo: z.string().min(1).optional(),
  modules: z.string().min(1).optional(),
  github: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
  intervention: z.iso.date().optional(),
});

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
  const parsed = ArgumentsSchema.safeParse(values);
  if (!parsed.success) {
    console.error(`Usage: bun coherence/report/build.ts [--data coherence/data] [--out docs/coherence] [--repo <path>] [--modules <scope>] [--github owner/repo] [--intervention YYYY-MM-DD]\n${z.prettifyError(parsed.error)}`);
    process.exit(2);
  }
  const { data, out, repo, modules, github, intervention } = parsed.data;
  const model = await buildReport({ dataDir: resolve(data), outDir: resolve(out), repository: repo ? resolve(repo) : undefined, modulesFor: modules, github, intervention }, (line) => console.error(line));
  console.log(`Report for ${model.scopes.length} scopes over ${model.weeks.length} weeks written to ${resolve(out)}/index-report.{html,md}`);
}
