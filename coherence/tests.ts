import type { Tests } from "./contract.ts";
import { compare } from "./drivers.ts";
import { totalLines, type Scope, type ScopeFile } from "./scope.ts";
import { anchors, dimensionScore, measure, ratio } from "./score.ts";

type FacadeFunction = { file: string; name: string };

const facadeSegment = /(^|\/)facade(\/|\.py$|\.tsx?$)/;
const pythonPublicFunction = /^(?:async\s+)?def\s+([A-Za-z]\w*)\s*\(/gm;
const typescriptPublicFunction = /^export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+)([A-Za-z$][\w$]*)/gm;

export function measureTests(scope: Scope): Tests {
  const testLines = totalLines(scope.tests);
  const productionLines = totalLines(scope.production);
  const testRatio = ratio(testLines, productionLines);
  const facadeCoverage = facadeCoverageOf(scope);
  const measures = {
    testRatio: measure(testRatio, anchors.testRatio),
    facadeCoverage: measure(facadeCoverage.share, anchors.facadeCoverage),
  };
  return { score: dimensionScore(measures), measures, ratio: { testLines, productionLines, value: testRatio }, facadeCoverage };
}

function facadeCoverageOf(scope: Scope): Tests["facadeCoverage"] {
  const functions = scope.production.filter(({ path }) => facadeSegment.test(path)).flatMap(publicFunctions);
  const uncovered = functions.filter(({ name }) => !scope.tests.some(({ text }) => mentions(text, name)));
  return {
    functions: functions.length,
    covered: functions.length - uncovered.length,
    share: ratio(functions.length - uncovered.length, functions.length),
    uncovered: uncovered.map(({ file, name }) => `${file}:${name}`).sort(compare),
  };
}

function publicFunctions(file: ScopeFile): FacadeFunction[] {
  const pattern = file.path.endsWith(".py") ? pythonPublicFunction : typescriptPublicFunction;
  return [...new Set([...file.text.matchAll(pattern)].map((match) => match[1]!))].map((name) => ({ file: file.path, name }));
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$])${name.replaceAll("$", "\\$")}(?![\\w$])`).test(text);
}
