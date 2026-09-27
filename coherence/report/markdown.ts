import { scoreKeys } from "../backfill.ts";
import { score, signed, weightsText } from "./format.ts";
import { dimensions, type ReportModel } from "./model.ts";

export function renderMarkdown(model: ReportModel): string {
  const first = model.weeks[0] ?? "";
  const last = model.weeks.at(-1) ?? "";
  const { runtime } = model;
  return [
    `# Coherence Index: ${model.repository} \`${model.ref}\`, ${model.weeks.length} weekly points (${first} to ${last})`,
    "",
    `Built ${model.built} at \`${model.head.slice(0, 12)}\`. ${runtime.total.measured} commits measured in ${runtime.total.seconds} s across all backfill runs; the last run took ${runtime.seconds} s (${runtime.measured} measured, ${runtime.reused} reused). The full report with charts is [index-report.html](index-report.html).`,
    "",
    "## Is the index trustworthy?",
    "",
    "The index has no measurement noise; the band is the 90th percentile of one weekday of ordinary commits, measured on Wednesday→Thursday pairs in weeks where the product changed.",
    "",
    "| Product | Composite now | Change | Day pairs | Weekday median | Weekday band (p90) | Typical week | Largest week |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...model.scopes.map(
      (scope) =>
        `| ${scope.scope} | ${scope.latest.composite.toFixed(1)} | ${signed(scope.change.composite)} | ${scope.noise.pairs.length} | ${scope.noise.median.composite.toFixed(1)} | ±${scope.noise.band.composite.toFixed(1)} | ${scope.weekly.median.toFixed(1)} | ${signed(scope.weekly.largest.delta)} (ending ${scope.weekly.largest.week}) |`,
    ),
    "",
    `## Scores at ${last}`,
    "",
    `| Product | ${scoreKeys.join(" | ")} |`,
    `| --- | ${scoreKeys.map(() => "---").join(" | ")} |`,
    ...model.scopes.map((scope) => `| ${scope.scope} | ${scoreKeys.map((key) => scope.latest[key].toFixed(1)).join(" | ")} |`),
    "",
    "## Weekday band per dimension",
    "",
    `| Product | ${dimensions.join(" | ")} |`,
    `| --- | ${dimensions.map(() => "---").join(" | ")} |`,
    ...model.scopes.map((scope) => `| ${scope.scope} | ${dimensions.map((dimension) => `±${scope.noise.band[dimension].toFixed(1)}`).join(" | ")} |`),
    "",
    "## Biggest movers, per product",
    "",
    "Every facade bypass costs the same per thousand production lines. A commit that moves code into a product, such as models moving into a products app, can expose imports that already crossed into it: they count as new bypasses. Under the rule that is correct, since the coupling was always there, but it is a change in what the index sees, not new coupling.",
    "",
    "| Product | Δ composite | × band | Date | Moved most | Change |",
    "| --- | --- | --- | --- | --- | --- |",
    ...model.scopes.flatMap(({ topMovers }) =>
      topMovers.map((mover) => `| ${mover.label} | ${signed(mover.delta.composite)} | ${mover.timesBand === null ? "—" : `${mover.timesBand.toFixed(1)}×`} | ${mover.date.slice(0, 10)} | ${mover.dimension} ${signed(mover.delta[mover.dimension])} | ${moverLink(mover, model.github)} |`),
    ),
    "",
    ...modulesTable(model),
    ...interventionTable(model),
  ].join("\n");
}

function moverLink({ subject, pr, commit }: ReportModel["scopes"][number]["topMovers"][number], github: string | null): string {
  const title = subject.replace(/\s*\(#\d+\)\s*$/, "").replace(/[|<>`]/g, (character) => `\\${character}`);
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
    `Each directory is scored as its own scope at the repository head. The code score weights ${weightsText(["architecture", "complexity", "smells"])}; tests are left out because a module's tests live outside it. Parents and children are both listed.`,
    "",
    "| Module | Files | Code | Architecture | Complexity | Smells | Propagation cost | Files on cycles | p90 CCN | Functions over CCN 10 | ruff / KLOC | Duplicated lines | Type escapes / KLOC |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...modules.rows.map(
      ({ path, files, code, scores, raw }) =>
        `| ${path.slice(modules.scope.length + 1)} | ${files} | ${code.toFixed(1)} | ${score(scores.architecture)} | ${score(scores.complexity)} | ${score(scores.smells)} | ${raw.propagationCost.toFixed(3)} | ${raw.cycleFiles} | ${raw.p90Ccn} | ${raw.shareOverTen === null ? "—" : `${(raw.shareOverTen * 100).toFixed(1)}%`} | ${score(raw.ruffPerKloc)} | ${raw.duplication.toFixed(1)}% | ${score(raw.typeEscapesPerKloc)} |`,
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
