export const style = `
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11, 11, 11, 0.10); --mid: #f0efec;
  --slot-1: #2a78d6; --slot-2: #eb6834; --slot-3: #1baf7a; --good: #006300; --bad: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255, 255, 255, 0.10); --mid: #383835;
    --slot-1: #3987e5; --slot-2: #d95926; --slot-3: #199e70; --good: #0ca30c; --bad: #e66767;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --border: rgba(255, 255, 255, 0.10); --mid: #383835;
  --slot-1: #3987e5; --slot-2: #d95926; --slot-3: #199e70; --good: #0ca30c; --bad: #e66767;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 32px 24px 48px; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; }
h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 18px; margin: 0 0 8px; }
p { margin: 0 0 8px; }
code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink-2); }
a { color: inherit; text-decoration-color: var(--axis); text-underline-offset: 2px; }
a:hover { text-decoration-color: var(--ink); }
.subtitle, .note { color: var(--ink-2); }
.note { font-size: 13px; max-width: 900px; }
.lead { font-size: 16px; max-width: 900px; }
section, footer { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; }
footer { font-size: 13px; color: var(--ink-2); }
footer ul { padding-left: 18px; margin: 0; }
footer li { margin-bottom: 4px; }
button { font: inherit; font-size: 13px; color: var(--ink-2); background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
button:hover { color: var(--ink); border-color: var(--axis); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin: 16px 0 12px; }
.tile { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.tile .label { color: var(--ink-2); font-size: 13px; display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.tile .value { font-size: 40px; font-weight: 600; line-height: 1.1; margin-bottom: 4px; }
.tile .delta { font-size: 13px; color: var(--ink-2); }
.tile .delta.up { color: var(--good); }
.tile .delta.down { color: var(--bad); }
.swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
.sparkline { display: block; width: 120px; height: 32px; margin-top: 8px; }
.sparkline path { fill: none; stroke: var(--axis); stroke-width: 1.5; }
.sparkline circle { fill: var(--ink-2); }
.slot-1 { --series: var(--slot-1); } .slot-2 { --series: var(--slot-2); } .slot-3 { --series: var(--slot-3); }
.swatch, .key { background: var(--series); }
.key { display: inline-block; width: 16px; height: 2px; vertical-align: middle; margin-right: 6px; }
figure.chart { margin: 0; position: relative; }
figure.chart figcaption { font-size: 13px; color: var(--ink-2); margin-bottom: 4px; }
.legend { list-style: none; display: flex; gap: 16px; padding: 0; margin: 0 0 4px; font-size: 13px; color: var(--ink-2); }
.plot { position: relative; }
.plot svg { display: block; width: 100%; height: auto; outline: none; }
.plot svg:focus-visible { outline: 2px solid var(--slot-1); outline-offset: 2px; border-radius: 6px; }
.grid { stroke: var(--grid); stroke-width: 1; }
.axis { stroke: var(--axis); stroke-width: 1; }
.tick { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.noise-band { fill: var(--series); fill-opacity: 0.12; stroke: none; }
.line { fill: none; stroke: var(--series); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.end-dot { fill: var(--series); stroke: var(--surface); stroke-width: 2; }
.leader { stroke: var(--axis); stroke-width: 1; }
.end-label { fill: var(--ink-2); font-size: 12px; }
.end-label .value { fill: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.crosshair { stroke: var(--ink-2); stroke-width: 1; }
.tooltip { position: absolute; top: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 13px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12); pointer-events: none; white-space: nowrap; }
.tooltip .when { color: var(--muted); font-size: 12px; margin-bottom: 2px; }
.tooltip div { display: flex; align-items: center; gap: 6px; }
.tooltip b { font-variant-numeric: tabular-nums; }
.tooltip span:last-child { color: var(--ink-2); }
.table-view { font-size: 12px; color: var(--ink-2); margin-top: 4px; }
.table-view summary { cursor: pointer; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; }
div.grid { stroke: none; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--grid); vertical-align: top; }
th { color: var(--ink-2); font-weight: 500; }
th small, td small { display: block; color: var(--muted); font-weight: 400; font-size: 11px; line-height: 1.3; }
td { font-variant-numeric: tabular-nums; }
tbody tr:hover { background: var(--mid); }
.delta-cell { position: relative; min-width: 120px; }
.delta-cell .bar { position: absolute; left: 0; top: 8px; bottom: 8px; border-radius: 0 4px 4px 0; opacity: 0.18; background: var(--bad); }
.delta-cell .bar.up { background: var(--good); }
.delta-cell b { position: relative; }
.subject { max-width: 520px; }
.sha { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
td.module b { font-weight: 600; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: no-preference) { .delta-cell .bar { transition: width 200ms ease; } }
`;
