export type ChartSeries = { label: string; slot: number; values: (number | null)[]; band: number };
export type Chart = { title: string; weeks: string[]; series: ChartSeries[]; width: number; height: number };

const margin = { top: 18, right: 128, bottom: 30, left: 38 };
const domain = { min: 0, max: 100 };
const labelGap = 15;

export function lineChart(chart: Chart): string {
  const plot = plotArea(chart);
  const x = (index: number) => plot.left + (chart.weeks.length === 1 ? plot.width / 2 : (index / (chart.weeks.length - 1)) * plot.width);
  const y = (value: number) => plot.top + ((domain.max - value) / (domain.max - domain.min)) * plot.height;
  const layers = [gridlines(chart, plot, y), xAxis(chart, plot, x), ...chart.series.map((series) => noiseBand(series, x, y)), ...chart.series.map((series) => line(series, x, y)), endLabels(chart.series, x, y), crosshair(plot)];
  return `<svg viewBox="0 0 ${chart.width} ${chart.height}" role="img" aria-label="${escape(chart.title)}" data-plot="${plot.left},${plot.width}">${layers.join("")}</svg>`;
}

export function sparkline(values: number[], width = 96, height = 28): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (index: number) => (values.length === 1 ? width / 2 : (index / (values.length - 1)) * width);
  const y = (value: number) => (max === min ? height / 2 : 2 + ((max - value) / (max - min)) * (height - 4));
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join("");
  const last = values.length - 1;
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${path}"/><circle cx="${x(last).toFixed(1)}" cy="${y(values[last]!).toFixed(1)}" r="3"/></svg>`;
}

function plotArea({ width, height }: Chart) {
  return { left: margin.left, top: margin.top, width: width - margin.left - margin.right, height: height - margin.top - margin.bottom };
}

type Plot = ReturnType<typeof plotArea>;
type Scale = (value: number) => number;

function gridlines(chart: Chart, plot: Plot, y: Scale): string {
  const ticks = [0, 25, 50, 75, 100];
  return ticks
    .map((tick) => `<line class="grid" x1="${plot.left}" x2="${plot.left + plot.width}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}"/><text class="tick" x="${plot.left - 6}" y="${(y(tick) + 3.5).toFixed(1)}" text-anchor="end">${tick}</text>`)
    .join("");
}

function xAxis(chart: Chart, plot: Plot, x: Scale): string {
  const every = Math.max(1, Math.ceil(chart.weeks.length / 7));
  const labels = chart.weeks.flatMap((week, index) => (index % every === 0 || index === chart.weeks.length - 1 ? [`<text class="tick" x="${x(index).toFixed(1)}" y="${plot.top + plot.height + 18}" text-anchor="middle">${week.slice(5)}</text>`] : []));
  return `<line class="axis" x1="${plot.left}" x2="${plot.left + plot.width}" y1="${plot.top + plot.height}" y2="${plot.top + plot.height}"/>${labels.join("")}`;
}

function noiseBand(series: ChartSeries, x: Scale, y: Scale): string {
  const present = series.values.flatMap((value, index) => (value === null ? [] : [{ index, value }]));
  if (present.length === 0 || series.band === 0) return "";
  const upper = present.map(({ index, value }) => `${x(index).toFixed(1)},${y(Math.min(domain.max, value + series.band)).toFixed(1)}`);
  const lower = [...present].reverse().map(({ index, value }) => `${x(index).toFixed(1)},${y(Math.max(domain.min, value - series.band)).toFixed(1)}`);
  return `<polygon class="noise-band slot-${series.slot}" points="${[...upper, ...lower].join(" ")}"/>`;
}

function line(series: ChartSeries, x: Scale, y: Scale): string {
  const segments = series.values.map((value, index) => (value === null ? null : `${x(index).toFixed(1)},${y(value).toFixed(1)}`));
  const path = segments.map((point, index) => (point === null ? "" : `${index === 0 || segments[index - 1] === null ? "M" : "L"}${point}`)).join("");
  const last = lastPresent(series);
  const dot = last === null ? "" : `<circle class="end-dot slot-${series.slot}" cx="${x(last.index).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="4"/>`;
  return `<path class="line slot-${series.slot}" d="${path}"/>${dot}`;
}

function endLabels(series: ChartSeries[], x: Scale, y: Scale): string {
  const ends = series.flatMap((entry) => {
    const last = lastPresent(entry);
    return last === null ? [] : [{ entry, index: last.index, lineY: y(last.value), labelY: y(last.value), value: last.value }];
  });
  ends.sort((a, b) => a.lineY - b.lineY);
  ends.forEach((end, position) => {
    const previous = ends[position - 1];
    if (previous && end.labelY - previous.labelY < labelGap) end.labelY = previous.labelY + labelGap;
  });
  return ends
    .map(({ entry, index, lineY, labelY, value }) => {
      const startX = x(index) + 6;
      const leader = Math.abs(labelY - lineY) > 1 ? `<line class="leader" x1="${startX.toFixed(1)}" y1="${lineY.toFixed(1)}" x2="${(startX + 10).toFixed(1)}" y2="${labelY.toFixed(1)}"/>` : "";
      return `${leader}<text class="end-label" x="${(startX + 12).toFixed(1)}" y="${(labelY + 3.5).toFixed(1)}"><tspan class="value">${value.toFixed(1)}</tspan> ${escape(entry.label)}</text>`;
    })
    .join("");
}

function crosshair(plot: Plot): string {
  return `<line class="crosshair" x1="0" x2="0" y1="${plot.top}" y2="${plot.top + plot.height}" visibility="hidden"/>`;
}

function lastPresent({ values }: ChartSeries): { index: number; value: number } | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== null && value !== undefined) return { index, value };
  }
  return null;
}

export function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
