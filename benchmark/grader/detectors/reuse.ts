import { isProductionSource, renamesOf, type ChangedFile, type Side } from "../change.ts";
import type { Detector, GradeContext } from "../context.ts";
import { sideLookup } from "../side-lookup.ts";
import { declaredSymbols, normalisedName, symbolKey } from "../symbols.ts";
import { difference, type Violation } from "../violations.ts";
import { textFindings, type TextRule } from "./text.ts";

const reuseTextRules: TextRule[] = [
  {
    detector: "reuse",
    rule: "raw-element",
    files: /^(frontend\/src|products\/[^/]+\/frontend)\/.*\.tsx$/,
    exclude: /(^|\/)lemon-ui\//,
    pattern: /<(button|input|select|textarea)\b/g,
    message: "a raw element where the Lemon UI component exists",
  },
];

export const reuse: Detector = async (context) => {
  const [twins, elements] = [await nameTwins(context), textFindings(context, reuseTextRules)];
  return { introduced: [...twins.introduced, ...elements.introduced], removed: [...twins.removed, ...elements.removed] };
};

async function nameTwins(context: GradeContext) {
  const base = await context.symbolsAtBase();
  const { minNameLength, maxDefinitions } = context.config.reuse;
  const keysOf = (file: ChangedFile, side: Side) => (file[side] ? declaredSymbols(file[side].path, file[side].text).map(({ name }) => symbolKey(file[side]!.path, name)) : []);
  const violationsOn = (side: Side) => {
    const elsewhere = sideLookup(base, context.change, side, keysOf);
    return context.change.files.flatMap((file) => {
      const version = file[side];
      if (!version || !isProductionSource(version.path)) return [];
      return declaredSymbols(version.path, version.text).flatMap(({ name, line }): Violation[] => {
        const others = normalisedName(name).length < minNameLength ? [] : elsewhere(symbolKey(version.path, name), version.path);
        if (others.length === 0 || others.length > maxDefinitions) return [];
        return [{ detector: "reuse", rule: "name-twin", file: version.path, line, subject: name, message: `${name} is already declared in ${others.join(", ")}` }];
      });
    });
  };
  return difference(violationsOn("before"), violationsOn("after"), renamesOf(context.change));
}
