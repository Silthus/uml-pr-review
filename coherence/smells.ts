import type { BlobCache } from "./blob-cache.ts";
import type { Smells } from "./contract.ts";
import { topFiles } from "./drivers.ts";
import { measureDuplication } from "./duplication.ts";
import { lintFindings, oxlint, ruff } from "./lint.ts";
import { totalLines, type ScopeFile } from "./scope.ts";
import { anchors, dimensionScore, measure, ratio } from "./score.ts";
import type { Toolbox } from "./tools.ts";

type TypeEscapeCounts = Smells["typeEscapes"]["counts"];
type TypeEscape = { name: keyof TypeEscapeCounts; pattern: RegExp; python: boolean; skipsImports: boolean };

const markerComment = /(?:^|\s)(?:#|\/\/|\/\*|\*)(.*)$/;
const markerWord = /\b(?:todo|fixme|hack|xxx|workaround|temporary)\b/i;
const importLine = /^\s*(?:from\s+\S+\s+)?import\b/;
const typeEscapes: TypeEscape[] = [
  { name: "any", pattern: /\bAny\b/g, python: true, skipsImports: true },
  { name: "any", pattern: /:\s*any\b/g, python: false, skipsImports: false },
  { name: "typeIgnore", pattern: /#\s*type:\s*ignore\b/g, python: true, skipsImports: false },
  { name: "tsIgnore", pattern: /@ts-ignore\b/g, python: false, skipsImports: false },
  { name: "asAny", pattern: /\bas any\b/g, python: false, skipsImports: false },
  { name: "eslintDisable", pattern: /eslint-disable/g, python: false, skipsImports: false },
];

export async function measureSmells(files: ScopeFile[], toolbox: Toolbox, cache: BlobCache): Promise<Smells> {
  const [ruffFindings, oxlintFindings, duplication] = await Promise.all([
    lintFindings(files.filter(isPython), toolbox, cache, ruff),
    lintFindings(files.filter((file) => !isPython(file)), toolbox, cache, oxlint),
    measureDuplication(files, toolbox, cache),
  ]);
  const markers = markersOf(files);
  const escapes = typeEscapesOf(files);
  const measures = {
    ruffPerKloc: measure(ruffFindings.perKloc, anchors.ruffPerKloc),
    oxlintPerKloc: measure(oxlintFindings.perKloc, anchors.oxlintPerKloc),
    duplicationPercentage: measure(duplication.percentage, anchors.duplicationPercentage),
    markersPerKloc: measure(markers.perKloc, anchors.markersPerKloc),
    typeEscapesPerKloc: measure(escapes.perKloc, anchors.typeEscapesPerKloc),
  };
  return { score: dimensionScore(measures), measures, ruff: ruffFindings, oxlint: oxlintFindings, duplication, markers, typeEscapes: escapes };
}

function markersOf(files: ScopeFile[]): Smells["markers"] {
  const perFile = files.map((file): [string, number] => [file.path, file.text.split("\n").filter(hasMarkerComment).length]);
  const count = perFile.reduce((total, [, found]) => total + found, 0);
  return { count, perKloc: perKloc(count, files), drivers: topFiles(perFile) };
}

function hasMarkerComment(line: string): boolean {
  return markerWord.test(markerComment.exec(line)?.[1] ?? "");
}

function typeEscapesOf(files: ScopeFile[]): Smells["typeEscapes"] {
  const counts: TypeEscapeCounts = { any: 0, typeIgnore: 0, tsIgnore: 0, asAny: 0, eslintDisable: 0 };
  const perFile = files.map((file): [string, number] => {
    const lines = file.text.split("\n");
    const found = typeEscapes
      .filter(({ python }) => python === isPython(file))
      .map(({ name, pattern, skipsImports }) => {
        const matches = lines.filter((line) => !(skipsImports && importLine.test(line))).reduce((total, line) => total + (line.match(pattern)?.length ?? 0), 0);
        counts[name] += matches;
        return matches;
      });
    return [file.path, found.reduce((total, matches) => total + matches, 0)];
  });
  const count = perFile.reduce((total, [, found]) => total + found, 0);
  return { count, perKloc: perKloc(count, files), drivers: topFiles(perFile), counts };
}

function perKloc(count: number, files: ScopeFile[]): number | null {
  const kloc = totalLines(files) / 1000;
  return kloc === 0 ? null : ratio(count, kloc);
}

function isPython({ path }: ScopeFile): boolean {
  return path.endsWith(".py");
}
