import type { ArchitecturePayload } from "../src/architecture/contracts/index.ts";
import type { Measure, Tests } from "./contract.ts";
import { compare } from "./drivers.ts";
import { totalLines, type Scope, type ScopeFile } from "./scope.ts";
import { anchors, dimensionScore, measure, ratio, unscoredMeasure } from "./score.ts";

type FacadeFunction = { file: string; name: string };
type FacadeReference = { text: string; names: string[] };

export const minimumFacadeFunctions = 10;

const facadeSegment = /(^|\/)facade(\/|\.py$|\.tsx?$)/;
const pythonPublicFunction = /^(?:async\s+)?def\s+([A-Za-z]\w*)\s*\(/gm;
const typescriptPublicFunction = /^export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+)([A-Za-z$][\w$]*)/gm;

export function measureTests(payload: ArchitecturePayload, scope: Scope): Tests {
  const testLines = totalLines(scope.tests);
  const productionLines = totalLines(scope.production);
  const testRatio = ratio(testLines, productionLines);
  const facadeCoverage = facadeCoverageOf(payload, scope);
  const facts = { ratio: { testLines, productionLines, value: testRatio }, facadeCoverage };
  const measures = testsMeasures(facts);
  return { score: dimensionScore(measures), measures, ...facts };
}

export function testsMeasures({ ratio: { value }, facadeCoverage }: Pick<Tests, "ratio" | "facadeCoverage">): Record<string, Measure> {
  const scoreCoverage = facadeCoverage.functions >= minimumFacadeFunctions ? measure : unscoredMeasure;
  return {
    testRatio: measure(value, anchors.testRatio),
    facadeCoverage: scoreCoverage(facadeCoverage.share, anchors.facadeCoverage),
  };
}

function facadeCoverageOf(payload: ArchitecturePayload, scope: Scope): Tests["facadeCoverage"] {
  const facadeFiles = scope.production.filter(({ path }) => facadeSegment.test(path));
  const functions = facadeFiles.flatMap(publicFunctions);
  const references = facadeReferences(payload, scope, new Set(facadeFiles.map(({ path }) => path)));
  const uncovered = functions.filter(({ name }) => !references.some((reference) => referencesFunction(reference, name)));
  return {
    functions: functions.length,
    covered: functions.length - uncovered.length,
    share: ratio(functions.length - uncovered.length, functions.length),
    uncovered: uncovered.map(({ file, name }) => `${file}:${name}`).sort(compare),
  };
}

function facadeReferences(payload: ArchitecturePayload, scope: Scope, facadePaths: Set<string>): FacadeReference[] {
  const testTexts = new Map(scope.tests.map(({ path, text }) => [path, text]));
  return payload.imports.flatMap(([from, to, , , names]) => {
    const text = testTexts.get(payload.files[from]![0]);
    return text !== undefined && facadePaths.has(payload.files[to]![0]) ? [{ text, names }] : [];
  });
}

function referencesFunction({ text, names }: FacadeReference, name: string): boolean {
  return names.includes(name) || (names.length === 0 && mentions(text, name));
}

function publicFunctions(file: ScopeFile): FacadeFunction[] {
  const pattern = file.path.endsWith(".py") ? pythonPublicFunction : typescriptPublicFunction;
  return [...new Set([...file.text.matchAll(pattern)].map((match) => match[1]!))].map((name) => ({ file: file.path, name }));
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$])${name.replaceAll("$", "\\$")}(?![\\w$])`).test(text);
}
