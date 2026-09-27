import { subtypes } from "../../corrections/labels.ts";
import type { GraderConfig } from "../config.ts";
import { bySubtype, matchedLineThreshold, outcomeOf, percent, productionFileFlags, rate, type ScoredCase } from "./metrics.ts";
import type { StoredGrade } from "./store.ts";

export function tuningReport(scored: ScoredCase[], clean: StoredGrade[], config: GraderConfig): string {
  const cases = scored.filter(({ verified }) => verified === true);
  const detectors = config.detectors;
  const outcomes = new Map(cases.map((scored) => [scored.id, outcomeOf(scored, detectors)]));
  const flags = productionFileFlags(clean, detectors);
  const flagRate = rate(flags.flagged);
  const threshold = matchedLineThreshold(flags.addedLines, flagRate.hits / Math.max(1, flagRate.total));
  const lines = [
    `verified cases ${cases.length} of ${scored.length}; clean PRs ${clean.length}, production files ${flagRate.total}, flagged ${percent(flagRate)}; matched size baseline: added > ${threshold} lines`,
    "",
    ["detector", ...subtypes, "all"].join("\t"),
  ];
  for (const detector of [...detectors, "any" as const]) {
    const flagged = bySubtype(cases, (scored) => {
      const outcome = outcomes.get(scored.id)!;
      return detector === "any" ? outcome.flagged.size > 0 : outcome.flagged.has(detector);
    });
    lines.push([detector, ...[...subtypes, "all" as const].map((subtype) => `${rate(flagged[subtype]).hits}/${flagged[subtype].length}`)].join("\t"));
  }
  const confirmed = bySubtype(cases, (scored) => [...outcomes.get(scored.id)!.flagged].some((detector) => outcomes.get(scored.id)!.fixed.has(detector)));
  lines.push(["confirmed", ...[...subtypes, "all" as const].map((subtype) => `${rate(confirmed[subtype]).hits}/${confirmed[subtype].length}`)].join("\t"));
  const baseline = bySubtype(cases, (scored) => outcomes.get(scored.id)!.addedLines > threshold);
  lines.push(["size>N", ...[...subtypes, "all" as const].map((subtype) => `${rate(baseline[subtype]).hits}/${baseline[subtype].length}`)].join("\t"));
  lines.push("", "detector: clean-file flag rate, catch, size baseline catch at the same flag rate");
  for (const detector of detectors) {
    const cleanRate = rate(productionFileFlags(clean, [detector]).flagged);
    const matched = matchedLineThreshold(flags.addedLines, cleanRate.hits / Math.max(1, cleanRate.total));
    const caught = rate(cases.map(({ id }) => outcomes.get(id)!.flagged.has(detector)));
    const sized = rate(cases.map(({ id }) => outcomes.get(id)!.addedLines > matched));
    lines.push(`  ${detector}: flags ${percent(cleanRate)} of clean files, catches ${percent(caught)}; size > ${matched} catches ${percent(sized)}`);
  }
  return lines.join("\n");
}
