import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execute } from "../../lib/execute.ts";
import { uvxTool } from "../../lib/tools.ts";
import { toolVersions } from "../../../coherence/tools.ts";
import { isProductionSource, renamesOf, versionsOn, type FileVersion } from "../change.ts";
import type { Detector, GradeContext, TouchedFunction } from "../context.ts";
import { difference, type Violation } from "../violations.ts";

type FunctionMetric = { name: string; line: number; ccn: number; nloc: number; tokens: number };
type Measured = FileVersion & { functions: FunctionMetric[] };

const measurable = /\.(py|[mc]?[jt]sx?|rs)$/;

export const complexity: Detector = async (context) => {
  const before = await measure(context, versionsOn(context.change, "before"));
  const after = await measure(context, versionsOn(context.change, "after"));
  const renames = renamesOf(context.change);
  const finding = difference(before.flatMap((file) => thresholdViolations(file, context)), after.flatMap((file) => thresholdViolations(file, context)), renames);
  return { ...finding, touched: touchedFunctions(before, after, renames) };
};

function parseLizardRows(csv: string, root: string): (FunctionMetric & { file: string })[] {
  return csv.split("\n").flatMap((line) => {
    const fields = [...line.matchAll(/"([^"]*)"|([^,]+)/g)].map((match) => match[1] ?? match[2]!);
    if (fields.length < 10 || !/^\d+$/.test(fields[0]!)) return [];
    const [nloc, ccn, tokens, , , , file, name, , start] = fields;
    return [{ file: file!.replace(`${root}/`, ""), name: name!, line: Number(start), ccn: Number(ccn), nloc: Number(nloc), tokens: Number(tokens) }];
  });
}

function thresholdViolations({ path, functions }: Measured, context: GradeContext): Violation[] {
  const { ccnThresholds, nlocThreshold } = context.config.complexity;
  return functions.flatMap((metric) => [
    ...ccnThresholds.filter((threshold) => metric.ccn > threshold).map((threshold): Violation => ({ detector: "complexity", rule: `ccn-over-${threshold}`, file: path, line: metric.line, subject: metric.name, message: `${metric.name} has cyclomatic complexity ${metric.ccn}, over ${threshold}` })),
    ...(metric.nloc > nlocThreshold ? [{ detector: "complexity" as const, rule: "long-function", file: path, line: metric.line, subject: metric.name, message: `${metric.name} is ${metric.nloc} lines of code, over ${nlocThreshold}` }] : []),
  ]);
}

function touchedFunctions(before: Measured[], after: Measured[], renames: Map<string, string>): TouchedFunction[] {
  const previous = new Map(before.flatMap(({ path, functions }) => functions.map((metric) => [`${renames.get(path) ?? path}\0${metric.name}`, metric] as const)));
  const touched = after.flatMap(({ path, functions }) =>
    functions.flatMap((metric): TouchedFunction[] => {
      const old = previous.get(`${path}\0${metric.name}`);
      previous.delete(`${path}\0${metric.name}`);
      if (old && old.tokens === metric.tokens && old.ccn === metric.ccn && old.nloc === metric.nloc) return [];
      return [{ file: path, name: metric.name, line: metric.line, before: old ? { ccn: old.ccn, nloc: old.nloc } : null, after: { ccn: metric.ccn, nloc: metric.nloc } }];
    }),
  );
  const deleted = [...previous].map(([key, metric]): TouchedFunction => ({ file: key.split("\0")[0]!, name: metric.name, line: metric.line, before: { ccn: metric.ccn, nloc: metric.nloc }, after: null }));
  return [...touched, ...deleted];
}

async function measure(context: GradeContext, versions: FileVersion[]): Promise<Measured[]> {
  const measured = versions.filter(({ path }) => isProductionSource(path) && measurable.test(path));
  const metrics = await context.resultCache.resolve(measured, (version) => `grader-lizard@${toolVersions.lizard}\0${version.sha}\0${extensionOf(version.path)}`, runLizard);
  return measured.map((version) => ({ ...version, functions: metrics.get(version) ?? [] }));
}

async function runLizard(versions: FileVersion[]): Promise<Map<FileVersion, FunctionMetric[]>> {
  const lizard = uvxTool(`lizard==${toolVersions.lizard}`) ?? missingLizard();
  const directory = await mkdtemp(join(tmpdir(), "grader-lizard-"));
  try {
    const names = versions.map((version, index) => `${index}/${version.path.split("/").at(-1)}`);
    await Promise.all(versions.map(async (version, index) => {
      await mkdir(dirname(join(directory, names[index]!)), { recursive: true });
      await writeFile(join(directory, names[index]!), version.text);
    }));
    const result = await execute(directory, [...lizard, "--csv", ...names]);
    if (result.code !== 0) throw new Error(`lizard failed (${result.code}): ${result.stderr.slice(0, 300)}`);
    const rows = Map.groupBy(parseLizardRows(result.stdout, directory), ({ file }) => file);
    return new Map(versions.map((version, index) => [version, (rows.get(names[index]!) ?? []).map(({ file: _file, ...metric }) => metric)]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf("."));
}

function missingLizard(): never {
  throw new Error("lizard is not available: install uv so uvx can run it.");
}
