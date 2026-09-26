import { scoreKeys, type Scores } from "../backfill.ts";
import { escape, lineChart, sparkline, type ChartSeries } from "./charts.ts";
import { score, signed } from "./format.ts";
import { dimensions, labelOf, type MoverView, type ReportModel, type ScopeView } from "./model.ts";
import type { ModuleRow } from "./modules.ts";
import { style } from "./style.ts";

export function renderHtml(model: ReportModel): string {
  const first = model.weeks[0] ?? "";
  const last = model.weeks.at(-1) ?? "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Coherence Index · ${escape(model.repository)}</title>
<style>${style}</style>
</head>
<body>
<main>
<header>
  <div>
    <h1>Coherence Index</h1>
    <p class="subtitle">${escape(model.repository)} <code>${escape(model.ref)}</code> · ${model.scopes.map(({ scope }) => `<code>${escape(scope)}</code>`).join(", ")} · ${model.weeks.length} weekly points, ${first} to ${last} · built ${model.built} at <code>${model.head.slice(0, 12)}</code></p>
  </div>
  <button type="button" id="theme" aria-label="Switch colour theme">Theme: system</button>
</header>
${verdict(model)}
${compositeSection(model)}
${dimensionSection(model)}
${moversSection(model)}
${modulesSection(model)}
${interventionSection(model)}
${method(model)}
</main>
<script>${script}</script>
</body>
</html>
`;
}

function verdict(model: ReportModel): string {
  const [treated, ...controls] = model.scopes;
  return `<section>
  <h2>Is the index trustworthy, and where does ${escape(treated?.label ?? "the product")} stand?</h2>
  ${treated ? `<p class="lead">${escape(trustSentence(treated))}</p><p class="lead">${escape(standingSentence(treated, controls, model.weeks.length - 1))}</p>` : ""}
  <div class="tiles">${model.scopes.map(tile).join("")}</div>
  <p class="note">The index has no measurement noise: the same commit always gives the same number. The band is background movement. For every week in which a product changed, the commits at Wednesday and Thursday 00:00 UTC were scored too, and the band is the 90th percentile of that one-weekday movement, drawn as a shaded band around every line below. A single commit inside the band is the size of ordinary work; the biggest movers below are the commits that exceed it.</p>
</section>`;
}

function trustSentence(treated: ScopeView): string {
  const { noise, label } = treated;
  const largest = Math.max(0, ...noise.pairs.map(({ delta }) => Math.abs(delta.composite)));
  return `One weekday of ordinary commits moves the ${label} composite by ${noise.median.composite.toFixed(1)} points typically and ${noise.band.composite.toFixed(1)} at the 90th percentile (${noise.pairs.length} day pairs, largest ${largest.toFixed(1)}), so a change beyond ±${noise.band.composite.toFixed(1)} is a real change.`;
}

function standingSentence(treated: ScopeView, controls: ScopeView[], weeks: number): string {
  const { label, latest, change, weekly, topMovers } = treated;
  const weakest = [...dimensions].sort((a, b) => latest[a] - latest[b]).slice(0, 2);
  const neighbours = controls.map((control) => `${control.label} ${control.latest.composite.toFixed(1)}`).join(" and ");
  const biggest = topMovers[0];
  const biggestText = biggest ? ` Its largest single change was ${signed(biggest.delta.composite)}${biggest.timesBand === null ? "" : `, ${biggest.timesBand.toFixed(1)}× the band`}: ${biggest.subject}.` : "";
  return `${label} stands at ${latest.composite.toFixed(1)}, ${signed(change.composite)} over ${weeks} weeks against ${neighbours}. A typical week moves it ${weekly.median.toFixed(1)}; the largest week moved it ${signed(weekly.largest.delta)} (ending ${weekly.largest.week}). Its weakest dimensions are ${weakest.map((dimension) => `${dimension} ${latest[dimension].toFixed(1)}`).join(" and ")}.${biggestText}`;
}

function tile(scope: ScopeView): string {
  const change = scope.change.composite;
  return `<article class="tile">
    <p class="label"><span class="swatch slot-${scope.slot}"></span>${escape(scope.label)}</p>
    <p class="value">${scope.latest.composite.toFixed(1)}</p>
    <p class="delta ${change > 0 ? "up" : change < 0 ? "down" : ""}">${change > 0 ? "▲" : change < 0 ? "▼" : "▬"} ${signed(change)} over ${scope.weekly.steps} weeks</p>
    <p class="detail">weekday band ±${scope.noise.band.composite.toFixed(1)} · typical week ${scope.weekly.median.toFixed(1)} · largest week ${signed(scope.weekly.largest.delta)}</p>
    ${sparkline(scope.points.map(({ scores }) => scores.composite))}
  </article>`;
}

function compositeSection(model: ReportModel): string {
  return `<section>
  <h2>Composite, week by week</h2>
  ${figure(model, "Composite score, 0 to 100", "composite", 1100, 340)}
</section>`;
}

function dimensionSection(model: ReportModel): string {
  return `<section>
  <h2>Each dimension</h2>
  <p class="note">The composite weights architecture 35, complexity 25, smells 20, and tests 20. Each chart keeps the full 0 to 100 axis so the products compare honestly.</p>
  <div class="charts">${dimensions.map((dimension) => figure(model, `${capitalise(dimension)} score, 0 to 100`, dimension, 540, 240)).join("")}</div>
</section>`;
}

function figure(model: ReportModel, title: string, key: keyof Scores, width: number, height: number): string {
  const series: ChartSeries[] = model.scopes.map((scope) => ({ label: scope.label, slot: scope.slot, band: scope.noise.band[key], values: model.weeks.map((week) => scope.points.find((point) => point.week === week)?.scores[key] ?? null) }));
  const data = JSON.stringify({ weeks: model.weeks, series: series.map(({ label, slot, values }) => ({ label, slot, values })) });
  return `<figure class="chart" data-chart="${escape(data)}">
    <figcaption>${escape(title)}</figcaption>
    ${legend(model.scopes)}
    <div class="plot">${lineChart({ title, weeks: model.weeks, series, width, height })}<div class="tooltip" hidden></div></div>
    ${tableView(model, key)}
  </figure>`;
}

function legend(scopes: ScopeView[]): string {
  return `<ul class="legend">${scopes.map(({ label, slot }) => `<li><span class="key slot-${slot}"></span>${escape(label)}</li>`).join("")}</ul>`;
}

function tableView(model: ReportModel, key: keyof Scores): string {
  const rows = model.weeks.map((week) => `<tr><td>${week}</td>${model.scopes.map((scope) => `<td>${scope.points.find((point) => point.week === week)?.scores[key].toFixed(1) ?? "—"}</td>`).join("")}</tr>`);
  return `<details class="table-view"><summary>Table</summary><table><thead><tr><th>Week</th>${model.scopes.map(({ label }) => `<th>${escape(label)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></details>`;
}

function moversSection(model: ReportModel): string {
  const movers = model.scopes.flatMap(({ topMovers }) => topMovers);
  const largest = Math.max(1, ...movers.map(({ delta }) => Math.abs(delta.composite)));
  return `<section>
  <h2>Biggest movers, per product</h2>
  <p class="note">Inside the three weeks that moved each product most, every first-parent commit touching the product was scored and compared with the commit scored before it. The five largest per product are listed. A commit outside the product that changes its inbound imports is attributed to the next commit inside it.</p>
  <table class="movers">
    <thead><tr><th>Product</th><th>Δ composite</th><th>× band</th><th>Date</th><th>Moved most</th><th>Change</th></tr></thead>
    <tbody>${movers.map((mover) => moverRow(mover, largest, model.github)).join("")}</tbody>
  </table>
</section>`;
}

function moverRow(mover: MoverView, largest: number, github: string | null): string {
  const change = mover.delta.composite;
  const width = Math.round((Math.abs(change) / largest) * 100);
  const pr = mover.pr === null ? "" : github ? ` <a href="https://github.com/${escape(github)}/pull/${mover.pr}">#${mover.pr}</a>` : ` #${mover.pr}`;
  const sha = github ? `<a class="sha" href="https://github.com/${escape(github)}/commit/${mover.commit}">${mover.commit.slice(0, 7)}</a>` : `<span class="sha">${mover.commit.slice(0, 7)}</span>`;
  return `<tr>
    <td>${escape(mover.label)}</td>
    <td class="delta-cell"><span class="bar ${change > 0 ? "up" : "down"}" style="width:${width}%"></span><b>${signed(change)}</b></td>
    <td>${mover.timesBand === null ? "—" : `${mover.timesBand.toFixed(1)}× band`}</td>
    <td>${mover.date.slice(0, 10)}</td>
    <td>${mover.dimension} ${signed(mover.delta[mover.dimension])}</td>
    <td class="subject">${escape(mover.subject.replace(/\s*\(#\d+\)\s*$/, ""))}${pr} ${sha}</td>
  </tr>`;
}

function modulesSection(model: ReportModel): string {
  const modules = model.modules;
  if (modules === null) return "";
  const shown = 12;
  const row = (module: ModuleRow) => moduleRow(module, modules.scope);
  return `<section>
  <h2>${escape(labelOf(modules.scope))} modules at <code>${modules.commit.slice(0, 12)}</code>, worst first</h2>
  <p class="note">Each directory of the scope is scored as its own scope with the same index, at the repository head. The code score weights architecture 35, complexity 25, and smells 20; tests are left out because a module's tests live outside it. Parents and their children are both listed, so a large parent such as <code>backend</code> summarises the rows beneath it. Modules with fewer than 3 production files are not listed.</p>
  <table class="modules">
    <thead><tr>
      <th>Module</th><th>Files</th><th>Code</th>
      <th>Architecture<small>propagation cost · files on cycles · facade share</small></th>
      <th>Complexity<small>p90 CCN · functions over CCN 10 · p90 NLOC · p90 file lines</small></th>
      <th>Smells<small>ruff / KLOC · oxlint / KLOC · duplicated lines · markers / KLOC · type escapes / KLOC</small></th>
    </tr></thead>
    <tbody>${modules.rows.slice(0, shown).map(row).join("")}</tbody>
    ${modules.rows.length > shown ? `<tbody class="more" hidden>${modules.rows.slice(shown).map(row).join("")}</tbody>` : ""}
  </table>
  ${modules.rows.length > shown ? `<button type="button" class="show-more">Show all ${modules.rows.length} modules</button>` : ""}
</section>`;
}

function moduleRow(module: ModuleRow, scope: string): string {
  const { raw, scores } = module;
  const share = (value: number | null) => (value === null ? "no crossings" : `${(value * 100).toFixed(0)}%`);
  const perKloc = (value: number | null) => (value === null ? "—" : value.toFixed(1));
  return `<tr>
    <td class="module"><b>${escape(module.path.slice(scope.length + 1))}</b><small>${module.lines.toLocaleString("en-US")} lines</small></td>
    <td>${module.files}</td>
    <td><b>${module.code.toFixed(1)}</b></td>
    <td><b>${score(scores.architecture)}</b><small>${raw.propagationCost.toFixed(3)} · ${raw.cycleFiles} · ${share(raw.facadeShare)}</small></td>
    <td><b>${score(scores.complexity)}</b><small>${raw.p90Ccn} · ${raw.shareOverTen === null ? "—" : `${(raw.shareOverTen * 100).toFixed(1)}%`} · ${raw.p90Nloc} · ${raw.p90FileLines}</small></td>
    <td><b>${score(scores.smells)}</b><small>${perKloc(raw.ruffPerKloc)} · ${perKloc(raw.oxlintPerKloc)} · ${raw.duplication.toFixed(1)}% · ${perKloc(raw.markersPerKloc)} · ${perKloc(raw.typeEscapesPerKloc)}</small></td>
  </tr>`;
}

function interventionSection(model: ReportModel): string {
  if (model.intervention === null) return "";
  const { date, results } = model.intervention;
  const [treated, ...controls] = model.scopes;
  return `<section>
  <h2>Difference in differences from ${date}</h2>
  <p class="note">Slopes are points per week, fitted by least squares before and after the intervention. The effect is the treated slope change minus the mean control slope change.</p>
  <table class="did">
    <thead><tr><th>Score</th><th>${escape(treated?.label ?? "treated")} before → after</th><th>${escape(controls.map(({ label }) => label).join(", "))} before → after</th><th>Effect</th></tr></thead>
    <tbody>${scoreKeys.map((key) => `<tr><td>${key}</td><td>${results[key].treated.before} → ${results[key].treated.after}</td><td>${results[key].controls.before} → ${results[key].controls.after}</td><td><b>${signed(results[key].effect)}</b> per week</td></tr>`).join("")}</tbody>
  </table>
</section>`;
}

function method(model: ReportModel): string {
  return `<footer>
  <h2>How to read this</h2>
  <ul>
    <li><b>Points.</b> One score per week: the first-parent <code>${escape(model.ref)}</code> commit at each Monday 00:00 UTC boundary, measured by <code>coherence/index.ts</code> with pinned tools and fixed anchors, so the same commit always gives the same number.</li>
    <li><b>Band.</b> For each week, the first-parent commits at Wednesday and Thursday 00:00 UTC were scored too, and the pair is kept when the product's files changed between them. The band is the 90th percentile of the absolute change per product and per score: the size of an ordinary weekday of work, including the odd refactor. It is the yardstick for single commits; weekly steps are summarised separately as the typical and largest week.</li>
    <li><b>Movers.</b> In the three weeks with the largest composite change per product, every first-parent commit that touched the product was scored, and each is compared with the previous scored commit.</li>
    <li><b>Runtime.</b> ${model.runtime.total.measured} commits measured in ${model.runtime.total.seconds.toLocaleString("en-US")} s across all backfill runs; the last run took ${model.runtime.seconds.toLocaleString("en-US")} s with ${model.runtime.measured} measured and ${model.runtime.reused} reused from <code>coherence/data/</code>.</li>
  </ul>
</footer>`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const script = `
const root = document.documentElement;
const themes = ["system", "light", "dark"];
const themeButton = document.getElementById("theme");
themeButton.addEventListener("click", () => {
  const next = themes[(themes.indexOf(root.dataset.theme || "system") + 1) % themes.length];
  if (next === "system") delete root.dataset.theme; else root.dataset.theme = next;
  themeButton.textContent = "Theme: " + next;
});
document.querySelector(".show-more")?.addEventListener("click", (event) => {
  document.querySelector("tbody.more").hidden = false;
  event.currentTarget.remove();
});
for (const figure of document.querySelectorAll("figure.chart")) {
  const svg = figure.querySelector("svg");
  const data = JSON.parse(figure.dataset.chart);
  const [left, width] = svg.dataset.plot.split(",").map(Number);
  const viewWidth = svg.viewBox.baseVal.width;
  const crosshair = svg.querySelector(".crosshair");
  const tooltip = figure.querySelector(".tooltip");
  const count = data.weeks.length;
  let current = -1;
  const xOf = (index) => left + (count === 1 ? width / 2 : (index / (count - 1)) * width);
  const show = (index) => {
    current = Math.max(0, Math.min(count - 1, index));
    const x = xOf(current);
    crosshair.setAttribute("x1", x); crosshair.setAttribute("x2", x); crosshair.setAttribute("visibility", "visible");
    const rows = data.series.map((series) => {
      const row = document.createElement("div");
      const key = document.createElement("span"); key.className = "key slot-" + series.slot;
      const value = document.createElement("b"); value.textContent = series.values[current] === null ? "—" : series.values[current].toFixed(1);
      const label = document.createElement("span"); label.textContent = series.label;
      row.append(key, value, label);
      return row;
    });
    const title = document.createElement("div"); title.className = "when"; title.textContent = data.weeks[current];
    tooltip.replaceChildren(title, ...rows);
    tooltip.hidden = false;
    const rect = svg.getBoundingClientRect();
    const px = (x / viewWidth) * rect.width;
    tooltip.style.left = (px > rect.width * 0.7 ? px - tooltip.offsetWidth - 12 : px + 12) + "px";
  };
  const hide = () => { crosshair.setAttribute("visibility", "hidden"); tooltip.hidden = true; current = -1; };
  svg.addEventListener("pointermove", (event) => {
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * viewWidth;
    show(Math.round(((px - left) / width) * (count - 1)));
  });
  svg.addEventListener("pointerleave", hide);
  svg.tabIndex = 0;
  svg.addEventListener("focus", () => show(count - 1));
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { show(current - 1); event.preventDefault(); }
    if (event.key === "ArrowRight") { show(current + 1); event.preventDefault(); }
  });
}
`;
