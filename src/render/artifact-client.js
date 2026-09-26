const G = JSON.parse(document.getElementById("graph-data").textContent);
const L = JSON.parse(document.getElementById("layout-data").textContent);
const sym = new Map(G.symbols.map(s => [s.id, s]));
const file = new Map(G.files.map(f => [f.id, f]));
const mod = new Map(G.modules.map(m => [m.id, m]));
const inOf = new Map(G.symbols.map(s => [s.id, []]));
const outOf = new Map(G.symbols.map(s => [s.id, []]));
for (const e of G.edges) { inOf.get(e.to).push(e.from); outOf.get(e.from).push(e.to); }
const symsOfFile = id => G.symbols.filter(s => s.file === id).map(s => s.id);


const root = document.documentElement;
const mq = matchMedia("(prefers-color-scheme: dark)");
function applySys() { root.classList.toggle("sys-dark", mq.matches); }
applySys(); mq.addEventListener("change", applySys);
function setTheme(t) {
  if (t === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
  for (const b of document.querySelectorAll(".theme button")) b.classList.toggle("on", b.dataset.t === t);
}
document.querySelector(".theme").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setTheme(b.dataset.t); });
setTheme("system");

const stage = document.getElementById("stage");
const scenes = {};
for (const g of stage.querySelectorAll(".scene")) {
  scenes[g.dataset.v] = {
    root: g, vp: g.querySelector(".vp"),
    cells: [...g.querySelectorAll("[data-cid]")],
    groups: [...g.querySelectorAll("[data-gid]")],
    wires: [...g.querySelectorAll("[data-eid]")],
    laneG: g.querySelector(".layer-lane"), chips: [], order: [],
    view: null, fitted: false,
  };
}

let variant = "E1", disclosed = false, selected = null, openSym = null;
const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const att = t => esc(t).replace(/"/g, "&quot;");


function place(key, state) {
  const S = scenes[key], P = L[key][state];
  for (const el of S.cells) {
    const p = P.cells[el.dataset.cid];
    if (p) { el.setAttribute("transform", "translate(" + p[0] + " " + p[1] + ")"); el.classList.remove("nopos"); }
    else el.classList.add("nopos");
  }
  for (const el of S.groups) {
    const b = P.groups[el.dataset.gid];
    if (!b) { el.classList.add("nopos"); continue; }
    el.classList.remove("nopos");
    const shape = P.edges["shape:" + el.dataset.gid];
    if (shape) {
      el.removeAttribute("transform");
      el.querySelector("path").setAttribute("d", shape);
      const [lx, ly, rot, anchor] = P.edges["label:" + el.dataset.gid].split("|");
      const t = el.querySelector("text");
      t.setAttribute("transform", "translate(" + lx + " " + ly + ") rotate(" + rot + ")");
      t.setAttribute("text-anchor", anchor);
      t.setAttribute("y", "3.5");
      continue;
    }
    el.setAttribute("transform", "translate(" + b[0] + " " + b[1] + ")");
    for (const t of el.querySelectorAll("[data-span]")) t.setAttribute(t.dataset.span, b[2]);
    for (const t of el.querySelectorAll("[data-span2]")) t.setAttribute(t.dataset.span2, b[3]);
    for (const t of el.querySelectorAll("[data-spanx]")) t.setAttribute("x", b[2] + Number(t.dataset.dx || 0));
    const box = el.querySelector(".box");
    if (box) { box.setAttribute("width", b[2]); box.setAttribute("height", b[3]); }
  }
  for (const el of S.wires) {
    const d = P.edges[el.dataset.eid] || "";
    const path = el.querySelector("path");
    if (d) { path.setAttribute("d", d); el.classList.remove("nopos"); } else el.classList.add("nopos");
    const lab = el.querySelector(".elabel"), lp = P.labels[el.dataset.eid];
    if (lab) { if (lp) { lab.setAttribute("transform", "translate(" + lp[0] + " " + lp[1] + ")"); lab.style.display = ""; } else lab.style.display = "none"; }
  }
  S.bounds = { w: P.w, h: P.h };
  for (const el of [...S.cells, ...S.groups, ...S.wires]) el.classList.toggle("hidden", el.classList.contains("nopos"));
}



function extent(S) {
  const b = S.bounds || { w: 1000, h: 1000 };
  let x0 = 0, x1 = b.w, y1 = b.h;
  for (const c of S.chips) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x + LANE_W); y1 = Math.max(y1, c.y + CHIP_H); }
  return { x: x0, y: 0, w: x1 - x0, h: y1 };
}
function view(key, floor) {
  const S = scenes[key];
  if (!S.view) {
    const r = stage.getBoundingClientRect(), b = extent(S);
    const whole = Math.min((r.width - 40) / Math.max(b.w, 1), (r.height - 40) / Math.max(b.h, 1));
    const k = Math.min(1.1, Math.max(whole, floor || 0));
    S.view = { k, x: Math.max(14, (r.width - b.w * k) / 2) - b.x * k, y: Math.max(14, (r.height - b.h * k) / 2) };
  }
  return S.view;
}
function paint(key) { const v = view(key); scenes[key].vp.setAttribute("transform", "translate(" + v.x + " " + v.y + ") scale(" + v.k + ")"); }
function fit(key, floor) { scenes[key].view = null; view(key, floor); paint(key); }

let drag = null;
stage.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  const v = view(variant);
  const hit = e.target.closest("[data-sel],[data-port],[data-drop]");
  drag = { px: e.clientX, py: e.clientY, x: v.x, y: v.y, moved: false, hit };
  stage.setPointerCapture(e.pointerId); stage.classList.add("dragging");
});
stage.addEventListener("pointermove", e => {
  if (!drag) return;
  const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  const v = view(variant); v.x = drag.x + dx; v.y = drag.y + dy; paint(variant);
});
stage.addEventListener("pointerup", e => {
  if (drag && !drag.moved) {
    const h = drag.hit;
    const drop = e.target.closest("[data-drop]");
    if (drop) dropChip(variant, drop.dataset.drop);
    else if (h && h.dataset.port) discloseP(h.dataset.port);
    else if (h) select(h.dataset.sel, true);
    else select(null);
  }
  drag = null; stage.classList.remove("dragging");
});
stage.addEventListener("wheel", e => {
  e.preventDefault();
  const v = view(variant), r = stage.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const step = Math.exp(-e.deltaY * (e.ctrlKey ? 0.008 : 0.0016));
  const k = Math.max(0.08, Math.min(4, v.k * step));
  v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k; paint(variant);
}, { passive: false });
function zoomBy(f) {
  const v = view(variant), r = stage.getBoundingClientRect(), mx = r.width / 2, my = r.height / 2;
  const k = Math.max(0.08, Math.min(4, v.k * f));
  v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k; paint(variant);
}


const tip = document.querySelector(".tip"), pop = document.querySelector(".pop");
let pinnedPop = null;
stage.addEventListener("mousemove", e => {
  const port = e.target.closest("[data-port]");
  if (port && !drag) { showPop(port.dataset.port, e.clientX, e.clientY); tip.classList.remove("on"); return; }
  if (!pinnedPop) pop.classList.remove("on");
  const hit = e.target.closest("[data-sel]");
  hotCode(hit && !hit.dataset.sel.startsWith("file:") ? hit.dataset.sel : null);
  litTests(hit ? hit.dataset.sel : null);
  if (!hit || drag) { tip.classList.remove("on"); return; }
  const id = hit.dataset.sel;
  if (id.startsWith("file:")) {
    const f = file.get(id.slice(5)), syms = symsOfFile(f.id), t = syms.filter(s => sym.get(s).touched).length;
    tip.innerHTML = "<b>" + f.path + "</b><br><i>" + f.moduleName + " &#183; " + f.role + " &#183; " + f.status + (f.changed ? " &#183; " + f.changed + " lines changed" : "") + "</i><br><i>" + t + " of " + syms.length + " symbols touched</i>";
  } else {
    const s = sym.get(id), f = file.get(s.file);
    tip.innerHTML = "<b>" + s.name + "</b>  <i>" + s.kind + (s.hand ? " (hand-added)" : "") + "</i><br>" + f.path + "<i>:" + s.start + "-" + s.end + "</i>" +
      "<br><i>" + s.lines + " lines" + (s.long ? " &#183; long, over " + G.longThreshold : "") + " &#183; " + inOf.get(s.id).length + " callers &#183; " + outOf.get(s.id).length + " callees" +
      (s.touched ? " &#183; touched, " + s.changed.length + " lines changed" : " &#183; neighbor") + (s.sig ? " &#183; signature changed" : "") + "</i>" +
      (s.diff ? "<br><i>click to open the diff</i>" : "");
  }
  tip.classList.add("on");
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(e.clientX + 14, innerWidth - r.width - 8) + "px";
  tip.style.top = Math.min(e.clientY + 16, innerHeight - r.height - 8) + "px";
});
stage.addEventListener("mouseleave", () => { tip.classList.remove("on"); hotCode(null); litTests(null); if (!pinnedPop) pop.classList.remove("on"); });

function litTests(sel) {
  const S = scenes[variant];
  const fid = !sel ? null : sel.startsWith("file:") ? sel.slice(5) : sym.get(sel) && sym.get(sel).file;
  for (const el of [...S.cells, ...S.groups]) {
    if (!el.classList.contains("tdim")) continue;
    const own = el.dataset.sel || "";
    const f = own.startsWith("file:") ? own.slice(5) : sym.get(own) && sym.get(own).file;
    el.classList.toggle("tlit", !!fid && f === fid);
  }
}

pop.addEventListener("mouseenter", () => { pinnedPop = 1; });
pop.addEventListener("mouseleave", () => { pinnedPop = null; pop.classList.remove("on"); });
pop.addEventListener("click", e => {
  const one = e.target.closest("[data-one]");
  if (one) { discloseOne(one.dataset.one, one.dataset.dir, pop.dataset.anchor); one.classList.add("shown"); select(one.dataset.one, false); return; }
  const all = e.target.closest("[data-all]");
  if (all) { discloseP(all.dataset.all); pinnedPop = null; pop.classList.remove("on"); }
});
function showPop(portKey, x, y) {
  const [dir, fileId] = [portKey.slice(0, portKey.indexOf(":")), portKey.slice(portKey.indexOf(":") + 1)];
  const ids = G.ports[portKey] || [];
  const f = file.get(fileId);
  const byMod = new Map();
  for (const id of ids) {
    const s = sym.get(id), sf = file.get(s.file);
    const k = sf.moduleName + "|" + sf.role;
    if (!byMod.has(k)) byMod.set(k, []);
    byMod.get(k).push(s);
  }
  let html = "<h4>" + (dir === "out" ? "Callees" : "Callers") + " outside the change &#183; " + ids.length + "</h4><div style='font-family:var(--mono);font-size:10px;color:var(--ink-3)'>" + f.path + "</div>";
  for (const [k, list] of [...byMod.entries()].sort()) {
    const [m, role] = k.split("|");
    html += "<div class='grp'><h5 class='" + (role === "test" ? "te" : "") + "'>" + m + " &#183; " + role + (m !== f.moduleName ? " &#183; across a seam" : "") + "</h5>";
    for (const s of list) html += '<button data-one="' + att(s.id) + '" data-dir="' + dir + '">' + esc(s.short) + " <span>" + esc(file.get(s.file).rel) + ":" + s.start + "</span></button>";
    html += "</div>";
  }
  html += '<button class="all" data-all="' + att(portKey) + '">Place all ' + ids.length + " in the lane</button>";
  html += "<div class='foot'>Or click one entry to place only that symbol.</div>";
  pop.innerHTML = html;
  pop.dataset.anchor = fileId;
  pop.classList.add("on");
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.min(x + 14, innerWidth - r.width - 8) + "px";
  pop.style.top = Math.min(y + 14, innerHeight - r.height - 8) + "px";
}

const LANE_W = 244, CHIP_H = 28, CHIP_GAP = 8, LANE_GAP = 120, COL_GAP = 18;

function anchorBox(key, sel) {
  const P = L[key][disclosed ? "full" : "focus"];
  const g = P.groups[key + "-file-" + sel];
  if (g) return g;
  const c = P.cells[key + "-sym-" + sel];
  return c ? [c[0], c[1], 150, 24] : null;
}

function placeChip(key, id, dir, anchorId) {
  const S = scenes[key];
  if (S.chips.some(c => c.id === id)) return false;
  const s = sym.get(id), f = file.get(s.file), b = extent(S);
  const list = S.chips.filter(c => c.dir === dir);
  const rows = Math.max(5, Math.floor((S.bounds.h || 600) / (CHIP_H + CHIP_GAP)));
  const i = list.length, col = Math.floor(i / rows), row = i % rows;
  const laneX = dir === "out"
    ? (S.bounds.w || 0) + LANE_GAP + col * (LANE_W + COL_GAP)
    : -LANE_GAP - LANE_W - col * (LANE_W + COL_GAP);
  const ab0 = anchorBox(key, anchorId);
  if (!list.length) S["top_" + dir] = ab0 ? Math.max(0, ab0[1] - 10) : 30;
  const chip = { id, dir, anchorId, x: laneX, y: (S["top_" + dir] || 30) + row * (CHIP_H + CHIP_GAP) };
  const where = f.moduleName + " \u00b7 " + f.rel + ":" + s.start;
  const html =
    '<g class="cell chip ' + (f.role === "test" ? "is-test" : "is-prod") + '" data-chip="1" data-sel="' + att(id) + '" transform="translate(' + chip.x + " " + chip.y + ')">' +
    '<rect class="box" x="0" y="0" width="' + LANE_W + '" height="' + CHIP_H + '" rx="3"/>' +
    '<rect class="mark" x="0" y="0" width="3" height="' + CHIP_H + '"/>' +
    '<text class="c-kind" x="9" y="12">' + (s.kind === "test" ? "t" : s.kind[0]) + '</text>' +
    '<text class="c-name" x="22" y="12">' + esc(s.short.length > 26 ? s.short.slice(0, 25) + "\u2026" : s.short) + '</text>' +
    '<text class="c-where" x="22" y="23">' + esc(where.length > 34 ? "\u2026" + where.slice(-33) : where) + '</text>' +
    '<text class="x" x="' + (LANE_W - 8) + '" y="13" text-anchor="end" data-drop="' + att(id) + '">\u00d7</text>' +
    '</g>';
  const ab = anchorBox(key, anchorId) || [0, 0, 10, 10];
  const ax = dir === "out" ? ab[0] + ab[2] : ab[0];
  const ay = ab[1] + Math.min(ab[3], 40) / 2;
  const cx = dir === "out" ? chip.x : chip.x + LANE_W;
  const cy = chip.y + CHIP_H / 2;
  const mid = (ax + cx) / 2;
  const edge = '<path class="lane-edge" d="M' + ax + " " + ay + " C" + mid + " " + ay + " " + mid + " " + cy + " " + cx + " " + cy + '" marker-end="url(#arrow)"/>';
  S.laneG.insertAdjacentHTML("beforeend", edge + html);
  chip.el = S.laneG.lastElementChild;
  chip.edgeEl = chip.el.previousElementSibling;
  S.chips.push(chip);
  return true;
}
function dropChip(key, id) {
  const S = scenes[key], i = S.chips.findIndex(c => c.id === id);
  if (i < 0) return;
  S.chips[i].el.remove(); S.chips[i].edgeEl.remove(); S.chips.splice(i, 1);
  afterLane(key);
}
function clearLane(key) {
  const S = scenes[key];
  S.laneG.textContent = ""; S.chips = [];
  afterLane(key);
}
function afterLane(key) {
  const S = scenes[key], caps = S.chips.length;
  laneNote();
  refreshIdents();
  if (selected) select(selected, false, true);
}
function laneNote() {
  const S = scenes[variant], n = S.chips.length;
  const box = document.getElementById("lane-state");
  box.innerHTML = n === 0
    ? '<p class="hint" style="margin:0 0 9px">Nothing disclosed yet.</p>'
    : '<p class="hint" style="margin:0 0 9px"><b>' + n + '</b> neighbor' + (n === 1 ? "" : "s") + ' in the lane. <button class="linky" id="clear-lane">Clear</button></p>';
  const b = document.getElementById("clear-lane");
  if (b) b.addEventListener("click", () => { clearLane(variant); fit(variant, 0.3); });
}

function discloseP(portKey) {
  const ids = G.ports[portKey] || [];
  const dir = portKey.slice(0, portKey.indexOf(":"));
  const fileId = portKey.slice(portKey.indexOf(":") + 1);
  if (disclosed) { setDisclosed(false); }
  let added = 0;
  for (const id of ids) if (placeChip(variant, id, dir, fileId)) added++;
  afterLane(variant);
  if (added) fit(variant, 0.28);
}

function discloseOne(id, dir, anchorId) {
  if (disclosed) setDisclosed(false);
  const ok = placeChip(variant, id, dir, anchorId);
  afterLane(variant);
  if (ok) fit(variant, 0.32);
  return ok;
}


function selectionSet(id) {
  if (!id) return new Set();
  return new Set(id.startsWith("file:") ? symsOfFile(id.slice(5)) : [id]);
}
function select(id, withCode, keep) {
  selected = keep ? id : (selected === id ? null : id);
  const set = selectionSet(selected);
  const ins = new Set(), outs = new Set();
  for (const s of set) { for (const i of inOf.get(s)) if (!set.has(i)) ins.add(i); for (const o of outOf.get(s)) if (!set.has(o)) outs.add(o); }
  for (const key in scenes) {
    const S = scenes[key];
    S.root.classList.toggle("has-sel", !!selected);
    for (const el of [...S.cells, ...S.chips.map(c => c.el), ...S.groups]) {
      el.classList.remove("lit", "lit-in", "lit-out", "sel");
      if (!selected || !el.dataset.sel) continue;
      const mine = selectionSet(el.dataset.sel);
      const all = [...mine];
      if (all.length && all.every(s => set.has(s))) el.classList.add("lit", "sel");
      else if (all.some(s => set.has(s))) el.classList.add("lit");
      else if (all.some(s => ins.has(s))) el.classList.add("lit", "lit-in");
      else if (all.some(s => outs.has(s))) el.classList.add("lit", "lit-out");
    }
    for (const el of S.wires) {
      el.classList.remove("lit", "lit-in", "lit-out");
      if (!selected) continue;
      const pairs = JSON.parse(el.dataset.pairs);
      if (pairs.some(p => set.has(p[1]) && !set.has(p[0]))) el.classList.add("lit", "lit-in");
      else if (pairs.some(p => set.has(p[0]) && !set.has(p[1]))) el.classList.add("lit", "lit-out");
      else if (pairs.some(p => set.has(p[0]) && set.has(p[1]))) el.classList.add("lit");
    }
  }
  inspect();
  if (selected && !selected.startsWith("file:") && sym.get(selected).diff && withCode !== false) openCode(selected);
  else if (!selected && !keep) closeCode();
}


const insp = document.getElementById("inspector");
function row(id, dir, from) {
  const s = sym.get(id), f = file.get(s.file);
  const seam = from && file.get(from).module !== f.module;
  return '<button data-jump="' + id + '">' + (dir === "in" ? "&#8592; " : "&#8594; ") + s.name +
    "<span" + (seam ? " class='seam'" : "") + ">" + (seam ? "across a seam: " + f.moduleName + " &#183; " : "") + f.rel + ":" + s.start + " &#183; " + f.role + (s.touched ? " &#183; touched" : "") + "</span></button>";
}
function inspect() {
  if (!selected) {
    insp.innerHTML = '<h2>Selection</h2><p class="hint" style="margin:0">Click a symbol or a file to trace its callers and callees. Click a touched symbol to open its source. Click a port to disclose the neighbors behind it.</p>';
    return;
  }
  if (selected.startsWith("file:")) {
    const f = file.get(selected.slice(5)), syms = symsOfFile(f.id).map(id => sym.get(id));
    insp.innerHTML = '<h2>Selection</h2><div class="insp-name">' + f.path.slice(f.path.lastIndexOf("/") + 1) + '</div><div class="insp-path">' + f.path + '</div>' +
      '<div class="badges"><span class="badge ' + (f.role === "test" ? "te" : "") + '">' + f.role + '</span><span class="badge">' + f.moduleName + '</span><span class="badge ' + (f.touched ? "st-" + f.status : "") + '">' + f.status + '</span></div>' +
      '<div class="rel"><h3><span>Symbols</span><span>' + syms.length + '</span></h3>' +
      syms.sort((a, b) => a.start - b.start).map(s => '<button data-jump="' + s.id + '">' + s.name + '<span>' + s.kind + ' &#183; ' + s.lines + ' lines' + (s.touched ? ' &#183; touched' : '') + (s.long ? ' &#183; long' : '') + '</span></button>').join("") + '</div>';
    return;
  }
  const s = sym.get(selected), f = file.get(s.file);
  const ins = [...new Set(inOf.get(selected))].sort(), outs = [...new Set(outOf.get(selected))].sort();
  insp.innerHTML = '<h2>Selection</h2>' +
    '<div class="insp-name">' + s.name + '</div>' +
    '<div class="insp-path">' + f.path + ':' + s.start + '-' + s.end + '</div>' +
    '<div class="badges"><span class="badge">' + s.kind + '</span>' +
      (s.touched ? '<span class="badge st-' + s.change + '">' + s.change + '</span>' : '<span class="badge">neighbor</span>') +
      (s.sig ? '<span class="badge s">signature</span>' : '') +
      '<span class="badge ' + (f.role === "test" ? "te" : "") + '">' + f.role + '</span>' +
      '<span class="badge' + (s.long ? ' lo' : '') + '">' + (s.long ? '! ' : '') + s.lines + ' lines</span>' +
      (s.hand ? '<span class="badge">hand-added</span>' : '') + '</div>' +
    (s.diff ? '<button class="open" data-open="' + att(s.id) + '">Open the diff, ' + s.changed.length + ' changed lines</button>' : '') +
    '<div class="rel"><h3><span>Called by</span><span>' + ins.length + '</span></h3>' +
      (ins.length ? ins.map(i => row(i, "in", s.file)).join("") : '<div class="none">Nothing in this graph calls it.</div>') + '</div>' +
    '<div class="rel"><h3><span>Calls</span><span>' + outs.length + '</span></h3>' +
      (outs.length ? outs.map(i => row(i, "out", s.file)).join("") : '<div class="none">It calls nothing in this graph.</div>') + '</div>';
}
insp.addEventListener("click", e => {
  const b = e.target.closest("[data-jump]");
  if (b) { selected = null; select(b.dataset.jump, false); return; }
  const o = e.target.closest("[data-open]");
  if (o) openCode(o.dataset.open);
});


const codePane = document.querySelector(".pane.code");
const diffEl = codePane.querySelector(".diff");
const CTX = 3, STEP = 20;
let expanded = [], names = new Map(), IDRE = null;

const BS = String.fromCharCode(92);
const rxEsc = t => t.replace(/[^A-Za-z0-9_$]/g, c => BS + c);

function buildNames(id) {
  names = new Map(); IDRE = null;
  const add = (n, sid) => { if (!n || n.length < 2) return; if (!names.has(n)) names.set(n, []); if (!names.get(n).includes(sid)) names.get(n).push(sid); };
  for (const o of outOf.get(id) || []) add(sym.get(o).short, o);
  add(sym.get(id).short, id);
  if (!names.size) return;
  const keys = [...names.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  IDRE = new RegExp(BS + "b(?:" + keys.map(rxEsc).join("|") + ")" + BS + "b", "g");
}

function markup(t) {
  if (!IDRE) return esc(t);
  let out = "", last = 0, m;
  IDRE.lastIndex = 0;
  while ((m = IDRE.exec(t))) {
    out += esc(t.slice(last, m.index));
    const ids = names.get(m[0]);
    out += '<span class="id' + (ids.includes(openSym) ? " self" : "") + '" data-sym="' + att(ids[0]) + '">' + esc(m[0]) + "</span>";
    last = m.index + m[0].length;
  }
  return out + esc(t.slice(last));
}
function renderDiff() {
  const s = sym.get(openSym), rows = s.diff || [];
  if (!rows.length) { diffEl.innerHTML = '<div class="empty">No diff for this symbol.</div>'; return; }
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => { if (r.k !== "ctx") for (let j = Math.max(0, i - CTX); j <= Math.min(rows.length - 1, i + CTX); j++) keep[j] = true; });
  for (const [a, b] of expanded) for (let j = a; j <= b; j++) keep[j] = true;
  const sigLines = new Set(s.sig ? [s.start] : []);
  let html = "", i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      const r = rows[i];
      html += '<div class="ln ' + r.k + (r.n && sigLines.has(r.n) ? " sig" : "") + '">' +
        '<span class="n">' + (r.o == null ? "" : r.o) + '</span>' +
        '<span class="n">' + (r.n == null ? "" : r.n) + '</span>' +
        '<span class="s">' + (r.k === "add" ? "+" : r.k === "del" ? "−" : " ") + '</span>' +
        '<span class="t">' + markup(r.t) + "</span></div>";
      i++; continue;
    }
    let j = i; while (j < rows.length && !keep[j]) j++;
    const a = i, b = j - 1, gap = b - a + 1;
    html += '<div class="exp">' +
      (gap > STEP ? '<button data-exp="' + a + "," + Math.min(b, a + STEP - 1) + '" title="Expand ' + STEP + ' lines up">↑</button>' : "") +
      '<button data-exp="' + a + "," + b + '" title="Expand every hidden line">' + (gap > STEP ? "all" : "↕") + "</button>" +
      (gap > STEP ? '<button data-exp="' + Math.max(a, b - STEP + 1) + "," + b + '" title="Expand ' + STEP + ' lines down">↓</button>' : "") +
      "<span>" + gap + " unchanged line" + (gap === 1 ? "" : "s") + "</span></div>";
    i = j;
  }
  diffEl.innerHTML = html;
  refreshIdents();
}
function openCode(id) {
  const s = sym.get(id), f = file.get(s.file);
  if (!s.diff) return;
  openSym = id; expanded = [];
  buildNames(id);
  const plus = s.diff.filter(r => r.k === "add").length, minus = s.diff.filter(r => r.k === "del").length;
  codePane.querySelector(".head").innerHTML =
    '<div class="t"><b>' + esc(s.name) + "</b>" +
      '<span class="badge st-' + s.change + '">' + s.change + "</span>" +
      '<button class="close" data-close>Close</button></div>' +
    '<div class="path">' + esc(f.path) + ":" + s.start + "–" + s.end + "</div>" +
    '<div class="stat"><span class="plus">+' + plus + '</span><span class="minus">−' + minus + "</span>" +
      "<span>" + s.lines + " lines</span><span>" + f.moduleName + "</span><span>" + f.role + "</span>" +
      (s.sig ? '<span style="color:var(--sig);font-weight:700">signature changed</span>' : "") + "</div>" +
    (s.long ? '<div class="warn"><b>! ' + s.lines + " L</b> — over the " + G.longThreshold + " line threshold. A symbol this long hides its own seams.</div>" : "");
  codePane.querySelector(".foot").innerHTML =
    '<span><span class="key">dotted</span> identifiers are symbols in this graph. Hover to find one on the canvas, click to place it.</span>';
  renderDiff();
  document.querySelector('.tabs [data-tab="code"]').disabled = false;
  document.querySelector('.tabs .where').textContent = " " + f.path.slice(f.path.lastIndexOf("/") + 1);
  setTab("code");
  const first = diffEl.querySelector(".ln.add, .ln.del");
  if (first) setTimeout(() => first.scrollIntoView({ block: "center" }), 40);
}
function closeCode() {
  openSym = null; names = new Map(); IDRE = null;
  diffEl.innerHTML = ""; codePane.querySelector(".head").innerHTML = ""; codePane.querySelector(".foot").innerHTML = "";
  document.querySelector('.tabs [data-tab="code"]').disabled = true;
  document.querySelector('.tabs .where').textContent = "";
  setTab("review");
  hotCanvas(null);
}

function placedIds() {
  const S = scenes[variant], out = new Set();
  for (const el of S.cells) if (!el.classList.contains("hidden") && el.dataset.sel && !el.dataset.sel.startsWith("file:")) out.add(el.dataset.sel);
  for (const c of S.chips) out.add(c.id);
  return out;
}
function refreshIdents() {
  if (!openSym) return;
  const on = placedIds();
  for (const el of diffEl.querySelectorAll(".id")) el.classList.toggle("here", on.has(el.dataset.sym));
}

function hotCanvas(ids) {
  for (const key in scenes) {
    const S = scenes[key];
    for (const el of [...S.cells, ...S.chips.map(c => c.el)]) el.classList.toggle("hot", !!ids && ids.has(el.dataset.sel));
  }
}
function hotCode(id) {
  for (const el of diffEl.querySelectorAll(".id")) el.classList.toggle("hot", !!id && el.dataset.sym === id);
}
diffEl.addEventListener("click", e => {
  const x = e.target.closest("[data-exp]");
  if (x) { const [a, b] = x.dataset.exp.split(",").map(Number); expanded.push([a, b]); renderDiff(); return; }
  const id = e.target.closest(".id");
  if (!id) return;
  const sid = id.dataset.sym;
  if (sid === openSym) return;
  if (!placedIds().has(sid)) discloseOne(sid, "out", sym.get(openSym).file);
  select(sid, false);
});
diffEl.addEventListener("mouseover", e => {
  const id = e.target.closest(".id");
  hotCanvas(id ? new Set([id.dataset.sym]) : null);
});
diffEl.addEventListener("mouseleave", () => hotCanvas(null));
codePane.addEventListener("click", e => { if (e.target.closest("[data-close]")) { selected = null; select(null); } });


let railW = 340, codeW = 620;
function setTab(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  for (const pane of document.querySelectorAll(".pane")) pane.classList.toggle("on", pane.dataset.pane === name);
  document.body.style.setProperty("--side-w", (name === "code" ? codeW : railW) + "px");
  for (const k in scenes) scenes[k].fitted = false;
  requestAnimationFrame(() => show(variant, false));
}
document.querySelector(".tabs").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b && !b.disabled) setTab(b.dataset.tab);
});
const grip = document.querySelector(".grip");
grip.addEventListener("pointerdown", e => {
  e.preventDefault();
  const code = document.querySelector('.tabs [data-tab="code"]').classList.contains("on");
  const start = e.clientX, from = code ? codeW : railW;
  document.body.classList.add("resizing");
  grip.setPointerCapture(e.pointerId);
  const move = ev => {
    const w = Math.max(code ? 380 : 260, Math.min(code ? 1000 : 520, from + (start - ev.clientX)));
    if (code) codeW = w; else railW = w;
    document.body.style.setProperty("--side-w", w + "px");
  };
  const up = () => {
    grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up);
    document.body.classList.remove("resizing");
    for (const k in scenes) scenes[k].fitted = false;
    show(variant, false);
  };
  grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
});


const toggle = document.getElementById("disclose-toggle");
function setDisclosed(on) {
  disclosed = on; toggle.checked = on;
  for (const key in scenes) { scenes[key].laneG.textContent = ""; scenes[key].chips = []; }
  laneNote(); refreshIdents();
  for (const key in scenes) { scenes[key].root.classList.add("swapping"); place(key, on ? "full" : "focus"); }
  setTimeout(() => { for (const key in scenes) scenes[key].root.classList.remove("swapping"); }, 360);
  for (const k in scenes) scenes[k].fitted = false;
  show(variant, false);
}
toggle.addEventListener("change", () => setDisclosed(toggle.checked));


function show(key, push) {
  variant = "E1";
  for (const k in scenes) scenes[k].root.classList.toggle("on", k === "E1");
  if (!scenes.E1.fitted) { scenes.E1.fitted = true; fit("E1", 0.42); } else paint("E1");
}
addEventListener("keydown", e => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.key === "Escape") { select(null); closeCode(); }
  else if (e.key === "f") setDisclosed(!disclosed);
  else if (e.key === "d") setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
});
document.querySelector(".zoom .in").addEventListener("click", () => zoomBy(1.25));
document.querySelector(".zoom .out").addEventListener("click", () => zoomBy(0.8));
document.querySelector(".zoom .fit").addEventListener("click", () => fit(variant));

for (const key in scenes) place(key, "focus");
inspect();
laneNote();
const q = new URL(location.href).searchParams;
if (q.get("disclosed") === "1") { disclosed = true; toggle.checked = true; for (const key in scenes) place(key, "full"); }
if (q.get("theme")) setTheme(q.get("theme"));
show("E1", false);
addEventListener("resize", () => { for (const k in scenes) scenes[k].fitted = false; show(variant, false); });
