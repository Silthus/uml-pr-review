import { isProductionSource, renamesOf, versionsOn, type Side } from "../change.ts";
import type { Detector, GradeContext } from "../context.ts";
import { declaredSymbols, isShared, normalisedName } from "../symbols.ts";
import { difference, type Violation } from "../violations.ts";
import { cloneFindings } from "./clones.ts";

export const reuse: Detector = async (context) => {
  const roots = context.config.reuse.sharedRoots;
  const [names, clones] = await Promise.all([
    nameFindings(context),
    cloneFindings(context, { detector: "reuse", rule: "shared-clone", eligible: (path) => !isShared(path, roots), counts: (other) => isShared(other, roots), message: "shared code exists for this" }),
  ]);
  return { introduced: [...names.introduced, ...clones.introduced], removed: [...names.removed, ...clones.removed] };
};

export const duplication: Detector = (context) =>
  cloneFindings(context, { detector: "duplication", rule: "clone", eligible: () => true, counts: (other) => isProductionSource(other), message: "duplicated code" });

async function nameFindings(context: GradeContext) {
  const shared = await context.sharedSymbols();
  const { sharedRoots, minNameLength } = context.config.reuse;
  const violationsOn = (side: Side) =>
    versionsOn(context.change, side)
      .filter(({ path }) => isProductionSource(path) && !isShared(path, sharedRoots))
      .flatMap(({ path, text }) =>
        declaredSymbols(path, text).flatMap(({ name, line }): Violation[] => {
          const definitions = shared.definitionsOf(name);
          if (normalisedName(name).length < minNameLength || definitions.length !== 1) return [];
          return [{ detector: "reuse", rule: "shared-name", file: path, line, subject: name, message: `${name} re-declares ${definitions[0]}'s ${name}` }];
        }),
      );
  return difference(violationsOn("before"), violationsOn("after"), renamesOf(context.change));
}
