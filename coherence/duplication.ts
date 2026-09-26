import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { BlobCache } from "./blob-cache.ts";
import type { Smells } from "./contract.ts";
import { topFiles } from "./drivers.ts";
import type { ScopeFile } from "./scope.ts";
import { roundTo } from "./score.ts";
import { cacheKey, runTool, type Toolbox } from "./tools.ts";

export const jscpdSettings = { minTokens: 50, minLines: 5, maxLines: 1_000_000, maxSize: "100mb", mode: "mild", formats: ["python", "typescript", "tsx"] } as const;

type Duplication = Smells["duplication"];
type LineRange = { start: number; end: number };

const LocationSchema = z.object({ name: z.string(), start: z.number().int(), end: z.number().int() });
const JscpdReportSchema = z.object({ duplicates: z.array(z.object({ firstFile: LocationSchema, secondFile: LocationSchema })) });

export async function measureDuplication(files: ScopeFile[], toolbox: Toolbox, cache: BlobCache): Promise<Duplication> {
  const fingerprint = new Bun.CryptoHasher("sha256").update(files.map(({ path, sha }) => `${path}\0${sha}`).sort().join("\n")).digest("hex");
  const key = cacheKey("jscpd", jscpdSettings, fingerprint);
  const results = await cache.resolve([key], (item) => item, async () => new Map([[key, await jscpd(files, toolbox)]]));
  return results.get(key)!;
}

async function jscpd(files: ScopeFile[], toolbox: Toolbox): Promise<Duplication> {
  const output = await mkdtemp(join(tmpdir(), "coherence-jscpd-"));
  try {
    await runTool(toolbox, [
      ...toolbox.jscpd, "--silent", "--reporters", "json", "--output", output,
      "--min-tokens", String(jscpdSettings.minTokens), "--min-lines", String(jscpdSettings.minLines),
      "--max-lines", String(jscpdSettings.maxLines), "--max-size", jscpdSettings.maxSize,
      "--mode", jscpdSettings.mode, "--format", jscpdSettings.formats.join(","), ".",
    ]);
    const report = Bun.file(join(output, "jscpd-report.json"));
    const duplicates = (await report.exists()) ? JscpdReportSchema.parse(await report.json()).duplicates : [];
    return duplicationOf(files, duplicates.map(({ firstFile, secondFile }) => [firstFile, secondFile]));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

function duplicationOf(files: ScopeFile[], clones: [z.infer<typeof LocationSchema>, z.infer<typeof LocationSchema>][]): Duplication {
  const distinct = new Map(clones.map((pair) => [pair.map(({ name, start, end }) => `${name}:${start}-${end}`).join("\0"), pair]));
  const rangesByFile = Map.groupBy([...distinct.values()].flat(), ({ name }) => name);
  const duplicatedByFile = [...rangesByFile].map(([file, ranges]): [string, number] => [file, coveredLines(ranges)]);
  const duplicatedLines = duplicatedByFile.reduce((total, [, lines]) => total + lines, 0);
  const lines = files.reduce((total, { text }) => total + physicalLines(text), 0);
  return {
    percentage: lines === 0 ? 0 : roundTo((100 * duplicatedLines) / lines, 2),
    duplicatedLines,
    clones: distinct.size,
    drivers: topFiles(duplicatedByFile),
  };
}

function coveredLines(ranges: LineRange[]): number {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let covered = 0;
  let reached = 0;
  for (const { start, end } of sorted) {
    covered += Math.max(0, end - Math.max(start - 1, reached));
    reached = Math.max(reached, end);
  }
  return covered;
}

function physicalLines(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}
