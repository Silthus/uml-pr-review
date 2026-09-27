import { parseLizardCsv } from "../benchmark/lib/static-quality.ts";
import type { BlobCache } from "./blob-cache.ts";
import type { Complexity, Measure } from "./contract.ts";
import { compare, driverLimit } from "./drivers.ts";
import type { ScopeFile } from "./scope.ts";
import { anchors, dimensionScore, measure, percentile, ratio } from "./score.ts";
import { blobKey, runPerFile, type Toolbox } from "./tools.ts";

type FunctionComplexity = { function: string; ccn: number; nloc: number };
type LocatedFunction = FunctionComplexity & { file: string };

const complexThreshold = 10;
const veryComplexThreshold = 20;

export async function measureComplexity(files: ScopeFile[], toolbox: Toolbox, cache: BlobCache): Promise<Complexity> {
  const perFile = await cache.resolve(files, (file) => blobKey("lizard", file), (misses) => lizard(misses, toolbox));
  const functions = files.flatMap((file) => perFile.get(file)!.map((metric): LocatedFunction => ({ file: file.path, ...metric })));
  const ccns = functions.map(({ ccn }) => ccn);
  const overTen = ccns.filter((ccn) => ccn > complexThreshold).length;
  const overTwenty = ccns.filter((ccn) => ccn > veryComplexThreshold).length;
  const summary = {
    count: functions.length,
    p50Ccn: percentile(ccns, 0.5),
    p90Ccn: percentile(ccns, 0.9),
    overTen,
    overTwenty,
    p90Nloc: percentile(functions.map(({ nloc }) => nloc), 0.9),
  };
  const fileSummary = { count: files.length, p90Lines: percentile(files.map(({ lines }) => lines), 0.9) };
  const measures = complexityMeasures({ functions: summary, files: fileSummary });
  return {
    score: dimensionScore(measures),
    measures,
    functions: summary,
    files: fileSummary,
    drivers: functions
      .sort((a, b) => b.ccn - a.ccn || b.nloc - a.nloc || compare(a.file, b.file) || compare(a.function, b.function))
      .slice(0, driverLimit)
      .map(({ file, function: name, ccn, nloc }) => ({ file, function: name, ccn, nloc })),
  };
}

export function complexityMeasures({ functions, files }: Pick<Complexity, "functions" | "files">): Record<"p90Ccn" | "shareOverTen" | "shareOverTwenty" | "p90FunctionNloc" | "p90FileLines", Measure> {
  const measured = functions.count > 0;
  return {
    p90Ccn: measure(measured ? functions.p90Ccn : null, anchors.p90Ccn),
    shareOverTen: measure(ratio(functions.overTen, functions.count), anchors.shareOverTen),
    shareOverTwenty: measure(ratio(functions.overTwenty, functions.count), anchors.shareOverTwenty),
    p90FunctionNloc: measure(measured ? functions.p90Nloc : null, anchors.p90FunctionNloc),
    p90FileLines: measure(files.p90Lines, anchors.p90FileLines),
  };
}

async function lizard(files: ScopeFile[], toolbox: Toolbox): Promise<Map<ScopeFile, FunctionComplexity[]>> {
  const outputs = await runPerFile(toolbox, files, (paths) => [...toolbox.lizard, "--csv", ...paths]);
  const byPath = Map.groupBy(outputs.flatMap((csv) => parseLizardCsv(csv, toolbox.directory)), ({ file }) => file);
  return new Map(
    files.map((file) => [
      file,
      (byPath.get(file.path) ?? [])
        .map(({ name, ccn, nloc }) => ({ function: name, ccn, nloc }))
        .sort((a, b) => compare(a.function, b.function) || a.ccn - b.ccn || a.nloc - b.nloc),
    ]),
  );
}
