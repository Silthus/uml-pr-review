import type { ArchitectureModel } from "../model/index.ts";

const suggestionCount = 3;

export function closestModules(base: ArchitectureModel, path: string): string[] {
  const suggestions = new Set<string>();
  for (const query of queriesFor(path)) {
    for (const { module } of base.search(query, suggestionCount)) {
      if (suggestions.size < suggestionCount && module.path !== ".") suggestions.add(module.path);
    }
  }
  return [...suggestions];
}

function queriesFor(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment !== ".");
  const basename = segments.at(-1);
  const parents = segments.slice(0, -1).map((_, end) => segments.slice(0, segments.length - 1 - end).join(" "));
  return [segments.join(" "), ...(basename ? [basename] : []), ...parents];
}
