import { isFacadeBypass } from "../../lib/boundary.ts";
import { renamesOf, type Change, type Side } from "../change.ts";
import type { Detector, GradeContext } from "../context.ts";
import { isOnCycle, type Import, type ImportGraph } from "../graph.ts";
import { difference, type DetectorName, type Violation } from "../violations.ts";

type ImportRule = { detector: DetectorName; rule: string; applies(entry: Import, graph: ImportGraph, context: GradeContext): boolean; message(entry: Import): string };

const productBackend = /^products\/([^/]+)\/backend\//;

export const cycles: Detector = (context) =>
  importFindings(context, [
    {
      detector: "cycles",
      rule: "import-cycle",
      applies: (entry, graph) => isOnCycle(graph, entry) && componentFiles(graph, entry) <= context.config.cycles.maxComponentFiles,
      message: ({ from, to }) => `${from} imports ${to}, and ${to} imports back into ${from}`,
    },
  ]);

export const facade: Detector = (context) =>
  importFindings(context, [{ detector: "facade", rule: "facade-bypass", applies: (entry) => !entry.fromTest && isFacadeBypass(entry), message: ({ from, to }) => `${from} imports ${to}, past its product's facade` }]);

export const layeringImportRules: ImportRule[] = [
  sameProductRule("presentation-imports-internals", /^presentation\//, (target) => !/^(facade|presentation)\//.test(target), "presentation may import only its facade and presentation"),
  sameProductRule("routes-imports-non-presentation", /^routes\.py$/, (target) => !/^presentation\//.test(target), "routes.py may import only presentation"),
  sameProductRule("facade-imports-presentation", /^facade\//, (target) => /^presentation\//.test(target), "a facade must not import its presentation"),
  sameProductRule("entrypoint-imports-internals", /^(management\/commands\/|tasks\/|tasks\.py$)/, (target) => /^(models|logic)(\.py$|\/)/.test(target), "commands and tasks call the facade, not models or logic"),
  sameProductRule("contracts-import-models", /^facade\/contracts\.py$/, (target) => /^models(\.py$|\/)/.test(target), "contracts must not depend on models"),
];

export function importViolations(graph: ImportGraph, files: string[], rules: ImportRule[], context: GradeContext): Violation[] {
  return files.flatMap((file) =>
    graph.importsFrom(file).flatMap((entry) =>
      rules.filter((rule) => rule.applies(entry, graph, context)).map((rule): Violation => ({ detector: rule.detector, rule: rule.rule, file: entry.from, line: entry.line, subject: entry.to, message: rule.message(entry) })),
    ),
  );
}

export async function importFindings(context: GradeContext, rules: ImportRule[]) {
  const graphs = await context.graphs();
  const violationsOn = (side: Side) => importViolations(graphs[side], changedPaths(context.change, side), rules, context);
  return difference(violationsOn("before"), violationsOn("after"), renamesOf(context.change));
}

export function changedPaths(change: Change, side: Side): string[] {
  return change.files.flatMap(({ status, path, previousPath }) => {
    if (side === "before") return status === "added" ? [] : [previousPath];
    return status === "deleted" ? [] : [path];
  });
}

function componentFiles(graph: ImportGraph, { from }: Import): number {
  return graph.componentSize(graph.componentOf(from)!);
}

function sameProductRule(rule: string, source: RegExp, forbidden: (target: string) => boolean, message: string): ImportRule {
  return {
    detector: "layering",
    rule,
    applies: ({ from, to, fromTest }) => {
      const product = productBackend.exec(from)?.[1];
      const backend = `products/${product}/backend/`;
      return !fromTest && product !== undefined && to.startsWith(backend) && source.test(from.slice(backend.length)) && forbidden(to.slice(backend.length));
    },
    message: ({ from, to }) => `${from} imports ${to}: ${message}`,
  };
}
