import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { BlobCache } from "./blob-cache.ts";
import type { FileCount, Smells } from "./contract.ts";
import { tally, topFiles } from "./drivers.ts";
import { totalLines, type ScopeFile } from "./scope.ts";
import { anchors, dimensionScore, measure, ratio, roundTo } from "./score.ts";
import { blobKey, runTool, toolVersions, type Toolbox } from "./tools.ts";

export const ruffRules = { select: ["E", "W", "F", "B", "C4", "SIM", "PIE", "PERF", "PLE", "PLW"], ignore: ["E501"], targetVersion: "py312" } as const;
export const jscpdSettings = { minTokens: 50, minLines: 5, mode: "mild", formats: ["python", "typescript", "tsx"] } as const;

type Density = { count: number; perKloc: number | null; drivers: FileCount[] };
type Duplication = Smells["duplication"];

const RuffOutputSchema = z.array(z.object({ code: z.string().nullable(), filename: z.string() }));
const OxlintOutputSchema = z.object({ diagnostics: z.array(z.object({ code: z.string().optional(), filename: z.string() })) });
const JscpdReportSchema = z.object({
  statistics: z.object({
    total: z.object({ percentage: z.number(), duplicatedLines: z.number(), clones: z.number() }),
    formats: z.record(z.string(), z.object({ sources: z.record(z.string(), z.object({ duplicatedLines: z.number() })) })),
  }),
});

const markerComment = /(?:#|\/\/|\/\*|^\s*\*)(.*)$/;
const markerWord = /\b(?:todo|fixme|hack|xxx|workaround|temporary)\b/i;
type TypeEscapeCounts = Smells["typeEscapes"]["counts"];

const typeEscapePatterns: { name: keyof TypeEscapeCounts; pattern: RegExp; python: boolean }[] = [
  { name: "any", pattern: /\bAny\b/g, python: true },
  { name: "typeIgnore", pattern: /#\s*type:\s*ignore\b/g, python: true },
  { name: "tsIgnore", pattern: /@ts-ignore\b/g, python: false },
  { name: "asAny", pattern: /\bas any\b/g, python: false },
  { name: "eslintDisable", pattern: /eslint-disable/g, python: false },
];

export async function measureSmells(files: ScopeFile[], toolbox: Toolbox, cache: BlobCache): Promise<Smells> {
  const python = files.filter(({ path }) => path.endsWith(".py"));
  const typescript = files.filter(({ path }) => !path.endsWith(".py"));
  const [ruff, oxlint, duplication] = await Promise.all([
    lintFindings(python, toolbox, cache, "ruff", ruffFindings),
    lintFindings(typescript, toolbox, cache, "oxlint", oxlintFindings),
    duplicationOf(files, toolbox, cache),
  ]);
  const markers = densityOf(files, markerLines);
  const typeEscapes = typeEscapesOf(files);
  const measures = {
    ruffPerKloc: measure(ruff.perKloc, anchors.ruffPerKloc),
    oxlintPerKloc: measure(oxlint.perKloc, anchors.oxlintPerKloc),
    duplicationPercentage: measure(duplication.percentage, anchors.duplicationPercentage),
    markersPerKloc: measure(markers.perKloc, anchors.markersPerKloc),
    typeEscapesPerKloc: measure(typeEscapes.perKloc, anchors.typeEscapesPerKloc),
  };
  return { score: dimensionScore(measures), measures, ruff, oxlint, duplication, markers, typeEscapes };
}

async function lintFindings(
  files: ScopeFile[],
  toolbox: Toolbox,
  cache: BlobCache,
  tool: "ruff" | "oxlint",
  run: (files: ScopeFile[], toolbox: Toolbox) => Promise<Map<string, string[]>>,
): Promise<Density & { rules: Record<string, number> }> {
  const perFile = await cache.resolve(files, (file) => blobKey(tool, file), async (misses) => {
    const codes = await run(misses, toolbox);
    return new Map(misses.map((file) => [file, (codes.get(file.path) ?? []).sort()]));
  });
  const findings = files.flatMap((file) => perFile.get(file)!);
  return {
    count: findings.length,
    perKloc: perKloc(findings.length, files),
    drivers: topFiles(files.map((file) => [file.path, perFile.get(file)!.length])),
    rules: tally(findings, (code) => code),
  };
}

async function ruffFindings(files: ScopeFile[], toolbox: Toolbox): Promise<Map<string, string[]>> {
  if (files.length === 0) return new Map();
  const command = [
    ...toolbox.ruff, "check", "--isolated", "--no-cache", "--exit-zero", "--output-format", "json",
    "--target-version", ruffRules.targetVersion, "--select", ruffRules.select.join(","), "--ignore", ruffRules.ignore.join(","),
    ...files.map(({ path }) => path),
  ];
  const findings = RuffOutputSchema.parse(JSON.parse(await runTool(toolbox, command)));
  return codesByFile(findings.map(({ code, filename }) => ({ file: filename, code: code ?? "syntax-error" })), toolbox);
}

async function oxlintFindings(files: ScopeFile[], toolbox: Toolbox): Promise<Map<string, string[]>> {
  if (files.length === 0) return new Map();
  const output = await runTool(toolbox, [...toolbox.oxlint, "--format", "json", ...files.map(({ path }) => path)], [0, 1]);
  const { diagnostics } = OxlintOutputSchema.parse(JSON.parse(output));
  return codesByFile(diagnostics.map(({ code, filename }) => ({ file: filename, code: code ?? "parse-error" })), toolbox);
}

function codesByFile(findings: { file: string; code: string }[], toolbox: Toolbox): Map<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const { file, code } of findings) {
    const path = file.startsWith(`${toolbox.directory}/`) ? file.slice(toolbox.directory.length + 1) : file;
    byFile.set(path, [...(byFile.get(path) ?? []), code]);
  }
  return byFile;
}

async function duplicationOf(files: ScopeFile[], toolbox: Toolbox, cache: BlobCache): Promise<Duplication> {
  const fingerprint = new Bun.CryptoHasher("sha256").update(files.map(({ path, sha }) => `${path}\0${sha}`).sort().join("\n")).digest("hex");
  const key = `jscpd@${toolVersions.jscpd}\0${JSON.stringify(jscpdSettings)}\0${fingerprint}`;
  const results = await cache.resolve([key], (item) => item, async () => new Map([[key, await jscpd(files, toolbox)]]));
  return results.get(key)!;
}

async function jscpd(files: ScopeFile[], toolbox: Toolbox): Promise<Duplication> {
  if (files.length === 0) return { percentage: 0, duplicatedLines: 0, clones: 0, drivers: [] };
  const output = await mkdtemp(join(tmpdir(), "coherence-jscpd-"));
  try {
    await runTool(toolbox, [
      ...toolbox.jscpd, "--silent", "--reporters", "json", "--output", output,
      "--min-tokens", String(jscpdSettings.minTokens), "--min-lines", String(jscpdSettings.minLines),
      "--mode", jscpdSettings.mode, "--format", jscpdSettings.formats.join(","),
      ...files.map(({ path }) => path).sort(),
    ]);
    const { statistics } = JscpdReportSchema.parse(await Bun.file(join(output, "jscpd-report.json")).json());
    const perSource = Object.values(statistics.formats).flatMap(({ sources }) => Object.entries(sources).map(([file, { duplicatedLines }]): [string, number] => [file, duplicatedLines]));
    const { percentage, duplicatedLines, clones } = statistics.total;
    return { percentage: roundTo(percentage, 2), duplicatedLines, clones, drivers: topFiles(perSource) };
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

function markerLines(file: ScopeFile): number {
  return file.text.split("\n").filter((line) => markerWord.test(markerComment.exec(line)?.[1] ?? "")).length;
}

function typeEscapesOf(files: ScopeFile[]): Smells["typeEscapes"] {
  const counts: TypeEscapeCounts = { any: 0, typeIgnore: 0, tsIgnore: 0, asAny: 0, eslintDisable: 0 };
  const perFile = files.map((file): [string, number] => {
    const patterns = typeEscapePatterns.filter(({ python }) => python === file.path.endsWith(".py"));
    const found = patterns.map(({ name, pattern }) => {
      const matches = file.text.match(pattern)?.length ?? 0;
      counts[name] += matches;
      return matches;
    });
    return [file.path, found.reduce((total, matches) => total + matches, 0)];
  });
  const count = perFile.reduce((total, [, found]) => total + found, 0);
  return { count, perKloc: perKloc(count, files), drivers: topFiles(perFile), counts };
}

function densityOf(files: ScopeFile[], countIn: (file: ScopeFile) => number): Density {
  const perFile = files.map((file): [string, number] => [file.path, countIn(file)]);
  const count = perFile.reduce((total, [, found]) => total + found, 0);
  return { count, perKloc: perKloc(count, files), drivers: topFiles(perFile) };
}

function perKloc(count: number, files: ScopeFile[]): number | null {
  const kloc = totalLines(files) / 1000;
  return kloc === 0 ? null : ratio(count, kloc);
}
