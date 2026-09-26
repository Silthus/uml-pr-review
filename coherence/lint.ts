import { z } from "zod";
import type { BlobCache } from "./blob-cache.ts";
import type { Smells } from "./contract.ts";
import { tally, topFiles } from "./drivers.ts";
import { totalLines, type ScopeFile } from "./scope.ts";
import { ratio } from "./score.ts";
import { blobKey, onOriginals, runPerFile, type Toolbox } from "./tools.ts";

export const ruffRules = { select: ["E", "W", "F", "B", "C4", "SIM", "PIE", "PERF", "PLE", "PLW"], ignore: ["E501"], targetVersion: "py312" } as const;

type Finding = { file: string; code: string };
type Linter = { tool: "ruff" | "oxlint"; settings: unknown; run: (files: ScopeFile[], toolbox: Toolbox) => Promise<Finding[]> };

const RuffOutputSchema = z.array(z.object({ code: z.string().nullable(), filename: z.string() }));
const OxlintOutputSchema = z.object({ diagnostics: z.array(z.object({ code: z.string().optional(), filename: z.string() })) });

export const ruff: Linter = { tool: "ruff", settings: ruffRules, run: ruffFindings };
export const oxlint: Linter = { tool: "oxlint", settings: null, run: oxlintFindings };

export async function lintFindings(files: ScopeFile[], toolbox: Toolbox, cache: BlobCache, { tool, settings, run }: Linter): Promise<Smells["ruff"]> {
  const originals = onOriginals(toolbox);
  const perFile = await cache.resolve(files, (file) => blobKey(tool, file, settings), async (misses) => {
    const findings = misses.length === 0 ? [] : await run(misses, originals);
    const codes = Map.groupBy(findings, ({ file }) => relativeTo(originals, file));
    return new Map(misses.map((file) => [file, (codes.get(file.path) ?? []).map(({ code }) => code).sort()]));
  });
  const findings = files.flatMap((file) => perFile.get(file)!);
  const kloc = totalLines(files) / 1000;
  return {
    count: findings.length,
    perKloc: kloc === 0 ? null : ratio(findings.length, kloc),
    drivers: topFiles(files.map((file) => [file.path, perFile.get(file)!.length])),
    rules: tally(findings, (code) => code),
  };
}

async function ruffFindings(files: ScopeFile[], toolbox: Toolbox): Promise<Finding[]> {
  const outputs = await runPerFile(toolbox, files, (paths) => [
    ...toolbox.ruff, "check", "--isolated", "--no-cache", "--exit-zero", "--output-format", "json",
    "--target-version", ruffRules.targetVersion, "--select", ruffRules.select.join(","), "--ignore", ruffRules.ignore.join(","),
    ...paths,
  ]);
  return outputs.flatMap((output) => RuffOutputSchema.parse(JSON.parse(output)).map(({ code, filename }) => ({ file: filename, code: code ?? "syntax-error" })));
}

async function oxlintFindings(files: ScopeFile[], toolbox: Toolbox): Promise<Finding[]> {
  const outputs = await runPerFile(toolbox, files, (paths) => [...toolbox.oxlint, "--format", "json", ...paths], [0, 1]);
  return outputs.flatMap((output) => OxlintOutputSchema.parse(JSON.parse(output)).diagnostics.map(({ code, filename }) => ({ file: filename, code: code ?? "parse-error" })));
}

function relativeTo(toolbox: Toolbox, file: string): string {
  return file.startsWith(`${toolbox.directory}/`) ? file.slice(toolbox.directory.length + 1) : file;
}
