import { renamesOf, versionsOn, type FileVersion, type Side } from "../change.ts";
import type { GradeContext } from "../context.ts";
import { difference, type DetectorName, type Violation } from "../violations.ts";

export type TextRule = { detector: DetectorName; rule: string; files: RegExp; exclude?: RegExp; pattern: RegExp; message: string };

export function textViolations(version: FileVersion, rules: TextRule[]): Violation[] {
  const applicable = rules.filter(({ files, exclude }) => files.test(version.path) && !exclude?.test(version.path));
  if (applicable.length === 0) return [];
  return version.text.split("\n").flatMap((text, index) =>
    applicable.flatMap((rule) => [...text.matchAll(rule.pattern)].map((match): Violation => ({ detector: rule.detector, rule: rule.rule, file: version.path, line: index + 1, subject: match[1] ?? match[0], message: `${rule.message}: ${match[0].trim()}` }))),
  );
}

export function textFindings(context: GradeContext, rules: TextRule[]) {
  const violationsOn = (side: Side) => versionsOn(context.change, side).flatMap((version) => textViolations(version, rules));
  return difference(violationsOn("before"), violationsOn("after"), renamesOf(context.change));
}
