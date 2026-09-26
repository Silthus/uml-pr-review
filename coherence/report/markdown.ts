import { scoreKeys } from "../backfill.ts";
import { signed } from "./html.ts";
import { dimensions, type ReportModel } from "./model.ts";

export function renderMarkdown(model: ReportModel): string {
  const first = model.weeks[0] ?? "";
  const last = model.weeks.at(-1) ?? "";
  return [
    `# Coherence Index: ${model.repository} \`${model.ref}\`, ${model.weeks.length} weekly points (${first} to ${last})`,
    "",
    `Built ${model.built} at \`${model.head.slice(0, 12)}\`. The backfill took ${model.runtime.seconds} s: ${model.runtime.measured} commits measured, ${model.runtime.reused} reused. The full report with charts is [index-report.html](index-report.html).`,
    "",
    "## Is the index trustworthy?",
    "",
    "| Product | Composite now | Change | Day pairs | Median day-to-day | Noise band (p90) | Weekly steps beyond band |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...model.scopes.map((scope) => `| ${scope.scope} | ${scope.latest.composite.toFixed(1)} | ${signed(scope.change.composite)} | ${scope.noise.pairs.length} | ${scope.noise.median.composite.toFixed(1)} | ±${scope.noise.band.composite.toFixed(1)} | ${scope.stepsBeyondBand} of ${scope.steps} |`),
    "",
    `## Scores at ${last}`,
    "",
    `| Product | ${scoreKeys.join(" | ")} |`,
    `| --- | ${scoreKeys.map(() => "---").join(" | ")} |`,
    ...model.scopes.map((scope) => `| ${scope.scope} | ${scoreKeys.map((key) => scope.latest[key].toFixed(1)).join(" | ")} |`),
    "",
    "## Noise band per dimension",
    "",
    `| Product | ${dimensions.join(" | ")} |`,
    `| --- | ${dimensions.map(() => "---").join(" | ")} |`,
    ...model.scopes.map((scope) => `| ${scope.scope} | ${dimensions.map((dimension) => `±${scope.noise.band[dimension].toFixed(1)}`).join(" | ")} |`),
    "",
    "## Biggest movers",
    "",
    "| Δ composite | × band | Product | Date | Moved most | Change |",
    "| --- | --- | --- | --- | --- | --- |",
    ...model.movers.map((mover) => `| ${signed(mover.delta.composite)} | ${mover.timesBand === null ? "—" : `${mover.timesBand.toFixed(1)}×`} | ${mover.label} | ${mover.date.slice(0, 10)} | ${mover.dimension} ${signed(mover.delta[mover.dimension])} | ${moverLink(mover, model.github)} |`),
    "",
    ...modulesTable(model),
    ...interventionTable(model),
  ].join("\n");
}

function moverLink({ subject, pr, commit }: ReportModel["movers"][number], github: string | null): string {
  const title = subject.replace(/\s*\(#\d+\)\s*$/, "").replaceAll("|", "\\|");
  const prLink = pr === null ? "" : github ? ` [#${pr}](https://github.com/${github}/pull/${pr})` : ` #${pr}`;
  const commitLink = github ? `[\`${commit.slice(0, 7)}\`](https://github.com/${github}/commit/${commit})` : `\`${commit.slice(0, 7)}\``;
  return `${title}${prLink} ${commitLink}`;
}

function modulesTable(model: ReportModel): string[] {
  const modules = model.modules;
  if (modules === null) return [];
  return [
    `## ${modules.scope} modules at \`${modules.commit.slice(0, 12)}\`, worst first`,
    "",
    "The code score weights architecture 35, complexity 25, and smells 20; tests are left out because a module's tests live outside it.",
    "",
    "| Module | Files | Code | Architecture | Complexity | Smells | Propagation cost | Files on cycles | p90 CCN | Functions over CCN 10 | ruff / KLOC | Duplicated lines | Type escapes / KLOC |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...modules.rows.map(
      ({ path, files, code, scores, raw }) =>
        `| ${path.slice(modules.scope.length + 1)} | ${files} | ${code.toFixed(1)} | ${scores.architecture.toFixed(1)} | ${scores.complexity.toFixed(1)} | ${scores.smells.toFixed(1)} | ${raw.propagationCost.toFixed(3)} | ${raw.cycleFiles} | ${raw.p90Ccn} | ${raw.shareOverTen === null ? "—" : `${(raw.shareOverTen * 100).toFixed(1)}%`} | ${raw.ruffPerKloc?.toFixed(1) ?? "—"} | ${raw.duplication.toFixed(1)}% | ${raw.typeEscapesPerKloc?.toFixed(1) ?? "—"} |`,
    ),
    "",
  ];
}

function interventionTable(model: ReportModel): string[] {
  if (model.intervention === null) return [];
  const { date, results } = model.intervention;
  return [
    `## Difference in differences from ${date}`,
    "",
    "| Score | Treated slope before → after | Controls slope before → after | Effect (points per week) |",
    "| --- | --- | --- | --- |",
    ...scoreKeys.map((key) => `| ${key} | ${results[key].treated.before} → ${results[key].treated.after} | ${results[key].controls.before} → ${results[key].controls.after} | ${signed(results[key].effect)} |`),
    "",
  ];
}
