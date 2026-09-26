import { scoreKeys, type Scores } from "../backfill.ts";
import { escape, lineChart, sparkline, type ChartSeries } from "./charts.ts";
import { dimensions, type MoverView, type ReportModel, type ScopeView } from "./model.ts";
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
  const [treated] = model.scopes;
  return `<section>
  <h2>Is the index trustworthy?</h2>
  ${treated ? `<p class="lead">${escape(verdictSentence(treated, model))}</p>` : ""}
  <div class="tiles">${model.scopes.map(tile).join("")}</div>
  <p class="note">Noise is measured, not assumed: each weekly commit was re-scored against the commit one day earlier. The band is the 90th percentile of those day-to-day movements, drawn as a shaded band around every line below. A weekly step inside the band is not evidence of anything.</p>
</section>`;
}

function verdictSentence(treated: ScopeView, model: ReportModel): string {
  const largest = model.movers.find(({ scope }) => scope === treated.scope);
  const pairs = treated.noise.pairs.length;
  const largestMove = Math.max(0, ...treated.noise.pairs.map(({ delta }) => Math.abs(delta.composite)));
  const stability = `Re-scoring the day before each of ${pairs} weekly commits moved the ${treated.label} composite by a median of ${treated.noise.median.composite.toFixed(1)} points and at most ${largestMove.toFixed(1)}, so the band is ±${treated.noise.band.composite.toFixed(1)}. ${treated.stepsBeyondBand} of ${treated.steps} weekly steps moved beyond it.`;
  if (!largest) return stability;
  const times = largest.timesBand === null ? "" : `, ${largest.timesBand.toFixed(1)}× the band,`;
  return `${stability} The largest single change${times} was ${signed(largest.delta.composite)} on ${largest.date.slice(0, 10)}: ${largest.subject}.`;
}

function tile(scope: ScopeView): string {
  const change = scope.change.composite;
  return `<article class="tile">
    <p class="label"><span class="swatch slot-${scope.slot}"></span>${escape(scope.label)}</p>
    <p class="value">${scope.latest.composite.toFixed(1)}</p>
    <p class="delta ${change > 0 ? "up" : change < 0 ? "down" : ""}">${change > 0 ? "▲" : change < 0 ? "▼" : "▬"} ${signed(change)} over ${scope.steps} weeks · noise ±${scope.noise.band.composite.toFixed(1)}</p>
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
  <div class="grid">${dimensions.map((dimension) => figure(model, `${capitalise(dimension)} score, 0 to 100`, dimension, 540, 240)).join("")}</div>
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
  const largest = Math.max(1, ...model.movers.map(({ delta }) => Math.abs(delta.composite)));
  return `<section>
  <h2>Biggest movers</h2>
  <p class="note">Inside the three weeks that moved each product most, every first-parent commit touching the product was scored. These are the commits with the largest composite change, compared with the commit scored before them.</p>
  <table class="movers">
    <thead><tr><th>Δ composite</th><th>× band</th><th>Product</th><th>Date</th><th>Moved most</th><th>Change</th></tr></thead>
    <tbody>${model.movers.map((mover) => moverRow(mover, largest, model.github)).join("")}</tbody>
  </table>
</section>`;
}

function moverRow(mover: MoverView, largest: number, github: string | null): string {
  const change = mover.delta.composite;
  const width = Math.round((Math.abs(change) / largest) * 100);
  const pr = mover.pr === null ? "" : github ? ` <a href="https://github.com/${github}/pull/${mover.pr}">#${mover.pr}</a>` : ` #${mover.pr}`;
  const sha = github ? `<a class="sha" href="https://github.com/${github}/commit/${mover.commit}">${mover.commit.slice(0, 7)}</a>` : `<span class="sha">${mover.commit.slice(0, 7)}</span>`;
  return `<tr>
    <td class="delta-cell"><span class="bar ${change > 0 ? "up" : "down"}" style="width:${width}%"></span><b>${signed(change)}</b></td>
    <td>${mover.timesBand === null ? "—" : `${mover.timesBand.toFixed(1)}× band`}</td>
    <td>${escape(mover.label)}</td>
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
  <p class="note">Each module is scored as its own scope with the same index. The code score weights architecture 35, complexity 25, and smells 20; tests are left out because a module's tests live outside it. Modules with fewer than 3 production files are not listed.</p>
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
    <td><b>${scores.architecture.toFixed(1)}</b><small>${raw.propagationCost.toFixed(3)} · ${raw.cycleFiles} · ${share(raw.facadeShare)}</small></td>
    <td><b>${scores.complexity.toFixed(1)}</b><small>${raw.p90Ccn} · ${raw.shareOverTen === null ? "—" : `${(raw.shareOverTen * 100).toFixed(1)}%`} · ${raw.p90Nloc} · ${raw.p90FileLines}</small></td>
    <td><b>${scores.smells.toFixed(1)}</b><small>${perKloc(raw.ruffPerKloc)} · ${perKloc(raw.oxlintPerKloc)} · ${raw.duplication.toFixed(1)}% · ${perKloc(raw.markersPerKloc)} · ${perKloc(raw.typeEscapesPerKloc)}</small></td>
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
    <li><b>Noise band.</b> For each weekly commit, the first-parent commit one day earlier was scored too. The band is the 90th percentile of the absolute day-to-day change per product and per score, so it reflects how much the index moves on an ordinary day of commits.</li>
    <li><b>Movers.</b> In the three weeks with the largest composite change per product, every first-parent commit that touched the product was scored, and each is compared with the previous scored commit.</li>
    <li><b>Runtime.</b> The backfill took ${model.runtime.seconds.toLocaleString("en-US")} s: ${model.runtime.measured} commits measured, ${model.runtime.reused} reused from <code>coherence/data/</code>.</li>
  </ul>
</footer>`;
}

function labelOf(scope: string): string {
  return scope.split("/").at(-1) ?? scope;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function signed(value: number): string {
  return value > 0 ? `+${value.toFixed(1)}` : value < 0 ? `−${Math.abs(value).toFixed(1)}` : "0.0";
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
