#!/usr/bin/env bun
/**
 * THROWAWAY ENRICHMENT STEP - github issue #6, rounds 2 and 3. Not production code.
 *
 * The analyzer graph (#5) lacks module, library, test/production, source, and
 * diff information. This script adds those fields from the PR head checkout so
 * the renderer can be designed against them. Every field it adds is listed in
 * the ticket comment; that list feeds the graph JSON schema decision.
 *
 * Usage: bun run prototype/renderer/enrich.ts <graph.json> <worktree> <pr-files.json> <out.json>
 *   graph.json     analyzer output (graph-tsc.json)
 *   worktree       detached checkout of the PR head, e.g. /tmp/uml-pr-review-lonir-4819
 *   pr-files.json  `gh api repos/<owner>/<repo>/pulls/<n>/files --paginate`
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

type FileStatus = "added" | "modified" | "deleted" | "renamed" | "untouched";
type SymbolKind = "function" | "class" | "method" | "arrow" | "const";

type Graph = {
  version: 0;
  pr: { url: string; number: number; headSha: string; title: string };
  files: { id: string; path: string; touched: boolean; status: FileStatus }[];
  symbols: {
    id: string;
    fileId: string;
    name: string;
    kind: SymbolKind;
    parentId?: string;
    line: { start: number; end: number };
    touched: boolean;
    signatureTouched: boolean;
    hop: number;
  }[];
  edges: { from: string; to: string; kind: "call" | "import" }[];
  meta?: Record<string, unknown>;
};

/** A base-side line the PR removed. `anchor` is the head line it sat before. */
export type RemovedLine = { anchor: number; old: number; text: string };
/** One line of a symbol's diff: context, added, or removed. `o` old number, `n` new number. */
export type DiffLine = { k: "ctx" | "add" | "del"; o: number | null; n: number | null; t: string };
/** Git change state as GitHub colors it: green, amber, red, grey. */
export type ChangeState = "added" | "modified" | "deleted" | "renamed" | "unchanged";

/** What the renderer consumes. Every added field is marked with a trailing comment. */
export type EnrichedGraph = {
  version: 1;
  pr: Graph["pr"];
  modules: { id: string; name: string; root: string }[]; // ADDED: workspace packages
  files: (Graph["files"][number] & {
    moduleId: string | null; // ADDED: package that contains the file, null = workspace root
    role: "test" | "production"; // ADDED: two-way split
    library: boolean; // ADDED: true for node_modules
    changedLines: number[]; // ADDED: head line numbers the PR added or edited
    deleteAnchors: number[]; // ADDED: head line numbers where lines were removed before
    removedLines: RemovedLine[]; // ADDED round 3: base-side lines the PR removed, with their old numbers
  })[];
  symbols: (Omit<Graph["symbols"][number], "kind"> & {
    kind: SymbolKind | "test"; // ADDED: "test" for a test case (it/test block)
    lineCount: number; // ADDED: total lines of the symbol
    changedLines: number[]; // ADDED: head line numbers inside the symbol that the PR changed
    source?: string; // ADDED: head source text of touched symbols
    handAdded?: boolean; // ADDED: true where this script, not the analyzer, produced the symbol
    change: ChangeState; // ADDED round 3: Git change state of the symbol, for the standard colors
    diff?: DiffLine[]; // ADDED round 3: unified diff of touched symbols, old and new numbers, removed lines included
  })[];
  edges: (Graph["edges"][number] & { handAdded?: boolean })[];
  meta: Record<string, unknown> & { enrichment: Record<string, unknown> };
};

const [graphPath, worktree, prFilesPath, outPath] = process.argv.slice(2);
if (!graphPath || !worktree || !prFilesPath || !outPath) {
  console.error("usage: bun run prototype/renderer/enrich.ts <graph.json> <worktree> <pr-files.json> <out.json>");
  process.exit(2);
}

const graph = JSON.parse(await Bun.file(graphPath).text()) as Graph;
const prFiles = JSON.parse(await Bun.file(prFilesPath).text()) as { filename: string; patch?: string }[];

// ---------------------------------------------------------------------------
// Modules: the folders the workspace declares as packages.
// pnpm-workspace.yaml `packages:` globs, else package.json `workspaces`.
// ---------------------------------------------------------------------------

async function workspaceGlobs(): Promise<{ globs: string[]; source: string }> {
  const yamlPath = join(worktree!, "pnpm-workspace.yaml");
  if (existsSync(yamlPath)) {
    const text = await Bun.file(yamlPath).text();
    const globs: string[] = [];
    let inPackages = false;
    for (const raw of text.split("\n")) {
      const line = raw.replace(/#.*$/, "").trimEnd();
      if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
      if (inPackages) {
        const m = /^\s+-\s*['"]?([^'"]+)['"]?\s*$/.exec(line);
        if (m) globs.push(m[1]!);
        else if (line.trim() !== "") inPackages = false;
      }
    }
    return { globs, source: "pnpm-workspace.yaml" };
  }
  const pkg = JSON.parse(await Bun.file(join(worktree!, "package.json")).text()) as { workspaces?: string[] | { packages?: string[] } };
  const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
  return { globs: ws, source: "package.json workspaces" };
}

const { globs, source: discoverySource } = await workspaceGlobs();
const modules: EnrichedGraph["modules"] = [];
for (const pattern of globs) {
  const glob = new Bun.Glob(pattern.replace(/\/$/, "") + "/package.json");
  for await (const rel of glob.scan({ cwd: worktree!, onlyFiles: true })) {
    const root = dirname(rel);
    const pkg = JSON.parse(await Bun.file(join(worktree!, rel)).text()) as { name?: string };
    modules.push({ id: root, name: pkg.name ?? root, root });
  }
}
modules.sort((a, b) => (a.root < b.root ? -1 : 1));

const moduleOf = (path: string) => {
  // Longest root wins, so a nested package beats its parent.
  let best: EnrichedGraph["modules"][number] | undefined;
  for (const m of modules) if (path.startsWith(m.root + "/") && (!best || m.root.length > best.root.length)) best = m;
  return best?.id ?? null;
};

// ---------------------------------------------------------------------------
// Test vs production. Ambiguity: `testing.ts` is a test support file, not a test
// itself. For the two-way split it counts as test code, because production
// code never imports it.
// ---------------------------------------------------------------------------

const TEST_PATTERNS = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)__tests__\//,
  /(^|\/)testing\.[cm]?[jt]sx?$/,
  /(^|\/)testing\//,
  /(^|\/)tests?\//,
  /(^|\/)fixtures?\//,
];
const roleOf = (path: string): "test" | "production" => (TEST_PATTERNS.some((p) => p.test(path)) ? "test" : "production");
const isLibrary = (path: string) => /(^|\/)node_modules\//.test(path);

// ---------------------------------------------------------------------------
// Changed head lines per file, from the unified diff patch.
// ---------------------------------------------------------------------------

/**
 * Walk a unified diff. Returns the head lines the PR added, the removed base
 * lines anchored at the head line they sat before, and a map from head line to
 * base line for unchanged lines (also outside hunks, via the running offset).
 */
function parsePatch(patch: string | undefined) {
  const added = new Set<number>();
  const oldOfCtx = new Map<number, number>();
  const removed: RemovedLine[] = [];
  const after: { newEnd: number; delta: number }[] = [];
  let o = 0;
  let n = 0;
  for (const line of (patch ?? "").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { if (n) after.push({ newEnd: n, delta: o - n }); o = Number(hunk[1]); n = Number(hunk[2]); continue; }
    if (line.startsWith("+")) { added.add(n); n++; }
    else if (line.startsWith("-")) { removed.push({ anchor: n, old: o, text: line.slice(1) }); o++; }
    else if (line.startsWith("\\")) { /* no newline marker */ }
    else if (n) { oldOfCtx.set(n, o); o++; n++; }
  }
  if (n) after.push({ newEnd: n, delta: o - n });
  const oldOf = (head: number): number | null => {
    if (added.has(head)) return null;
    const ctx = oldOfCtx.get(head);
    if (ctx !== undefined) return ctx;
    let delta = 0;
    for (const a of after) if (a.newEnd <= head) delta = a.delta;
    return head + delta;
  };
  const changed = [...added].sort((a, b) => a - b);
  const anchors = [...new Set(removed.map((r) => r.anchor))].sort((a, b) => a - b);
  return { changed, anchors, removed, oldOf };
}

/** The symbol's diff: head lines start..end with the removed lines spliced in before their anchor. */
function symbolDiff(headLines: string[], start: number, end: number, patch: ReturnType<typeof parsePatch>, fileDeleted: boolean): DiffLine[] {
  const out: DiffLine[] = [];
  if (fileDeleted) return patch.removed.map((r) => ({ k: "del", o: r.old, n: null, t: r.text }));
  for (let head = start; head <= end; head++) {
    for (const r of patch.removed) if (r.anchor === head) out.push({ k: "del", o: r.old, n: null, t: r.text });
    const old = patch.oldOf(head);
    out.push({ k: old === null ? "add" : "ctx", o: old, n: head, t: headLines[head - 1] ?? "" });
  }
  return out;
}

function changeOf(status: FileStatus, touched: boolean, diff: DiffLine[]): ChangeState {
  if (status === "deleted") return "deleted";
  if (status === "added") return "added";
  if (!touched) return "unchanged";
  if (diff.length && diff.every((l) => l.k === "add")) return "added";
  if (diff.some((l) => l.k !== "ctx")) return "modified";
  return status === "renamed" ? "renamed" : "modified";
}

const patchByPath = new Map(prFiles.map((f) => [f.filename, f.patch]));

const fileText = new Map<string, string[]>();
async function linesOf(path: string) {
  const cached = fileText.get(path);
  if (cached) return cached;
  const full = join(worktree!, path);
  const lines = existsSync(full) ? (await Bun.file(full).text()).split("\n") : [];
  fileText.set(path, lines);
  return lines;
}

const patchOf = new Map<string, ReturnType<typeof parsePatch>>();
const parsedPatch = (path: string) => {
  let p = patchOf.get(path);
  if (!p) { p = parsePatch(patchByPath.get(path)); patchOf.set(path, p); }
  return p;
};

const files: EnrichedGraph["files"] = [];
for (const f of graph.files) {
  const { changed, anchors, removed } = parsedPatch(f.path);
  files.push({
    ...f,
    moduleId: moduleOf(f.path),
    role: roleOf(f.path),
    library: isLibrary(f.path),
    changedLines: changed,
    deleteAnchors: anchors,
    removedLines: removed,
  });
}
const fileById = new Map(files.map((f) => [f.id, f]));

const symbols: EnrichedGraph["symbols"] = [];
for (const s of graph.symbols) {
  const f = fileById.get(s.fileId)!;
  const inRange = (n: number) => n >= s.line.start && n <= s.line.end;
  const lines = await linesOf(f.path);
  const diff = s.touched ? symbolDiff(lines, s.line.start, s.line.end, parsedPatch(f.path), f.status === "deleted") : undefined;
  symbols.push({
    ...s,
    lineCount: s.line.end - s.line.start + 1,
    changedLines: [...f.changedLines.filter(inRange), ...f.deleteAnchors.filter(inRange)].sort((a, b) => a - b),
    source: s.touched ? lines.slice(s.line.start - 1, s.line.end).join("\n") : undefined,
    change: changeOf(f.status, s.touched, diff ?? []),
    diff,
  });
}
const edges: EnrichedGraph["edges"] = [...graph.edges];

// ---------------------------------------------------------------------------
// Test cases as symbols. A sibling ticket proves this properly in the analyzer.
// Here: every `it(` / `test(` block in a test file of the graph, plus the one
// file comparison.md names, becomes a `kind: "test"` symbol with a call edge to
// each touched symbol its body names. Marked handAdded.
// ---------------------------------------------------------------------------

const touchedByName = new Map<string, string[]>();
for (const s of symbols) if (s.touched && !s.parentId) touchedByName.set(s.name, [...(touchedByName.get(s.name) ?? []), s.id]);

const candidateTestFiles = new Set(files.filter((f) => f.role === "test" && /\.(test|spec)\.[cm]?[jt]sx?$/.test(f.path)).map((f) => f.path));
for (const extra of ["packages/backend/convex/sendAction.truncation.test.ts", "packages/backend/convex/chats/sendAction.truncation.test.ts"]) {
  if (existsSync(join(worktree!, extra))) candidateTestFiles.add(extra);
}

let addedTests = 0;
let addedEdges = 0;
for (const path of [...candidateTestFiles].sort()) {
  const lines = await linesOf(path);
  if (lines.length === 0) continue;
  let file = files.find((f) => f.path === path);
  if (!file) {
    const { changed, anchors, removed } = parsedPatch(path);
    file = { id: path, path, touched: changed.length > 0, status: changed.length > 0 ? "modified" : "untouched", moduleId: moduleOf(path), role: "test", library: false, changedLines: changed, deleteAnchors: anchors, removedLines: removed };
    files.push(file);
    fileById.set(file.id, file);
  }
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:it|test)\((['"`])(.*?)\2/.exec(lines[i]!);
    if (!m) continue;
    // The block ends at the first line that closes the call at the same indentation.
    const indent = m[1]!;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j]!.startsWith(indent + "})") || lines[j]!.startsWith(indent + "});")) { end = j; break; }
      if (new RegExp(`^${indent}(?:it|test|describe)\\(`).test(lines[j]!)) { end = j - 1; break; }
      end = j;
    }
    const body = lines.slice(i, end + 1).join("\n");
    const targets = new Set<string>();
    for (const [name, ids] of touchedByName) {
      if (!new RegExp(`\\b${name}\\b`).test(body)) continue;
      // Prefer the touched symbol declared in this file, else the unique one.
      const local = ids.find((id) => id.startsWith(path + "#"));
      if (local) targets.add(local);
      else if (ids.length === 1) targets.add(ids[0]!);
    }
    if (targets.size === 0) continue;
    const id = `${path}#it:${m[3]}`;
    if (symbols.some((s) => s.id === id)) continue;
    const start = i + 1;
    const stop = end + 1;
    const inRange = (n: number) => n >= start && n <= stop;
    const changed = [...file.changedLines.filter(inRange), ...file.deleteAnchors.filter(inRange)].sort((a, b) => a - b);
    const diff = changed.length > 0 ? symbolDiff(lines, start, stop, parsedPatch(path), false) : undefined;
    symbols.push({
      id,
      fileId: file.id,
      name: m[3]!,
      kind: "test",
      line: { start, end: stop },
      touched: changed.length > 0,
      signatureTouched: false,
      hop: changed.length > 0 ? 0 : 1,
      lineCount: stop - start + 1,
      changedLines: changed,
      source: changed.length > 0 ? body : undefined,
      handAdded: true,
      change: changeOf(file.status, changed.length > 0, diff ?? []),
      diff,
    });
    addedTests++;
    for (const t of [...targets].sort()) {
      if (t === id) continue;
      edges.push({ from: id, to: t, kind: "call", handAdded: true });
      addedEdges++;
    }
  }
}

const out: EnrichedGraph = {
  version: 1,
  pr: graph.pr,
  modules,
  files: files.sort((a, b) => (a.id < b.id ? -1 : 1)),
  symbols: symbols.sort((a, b) => (a.id < b.id ? -1 : 1)),
  edges: edges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1)),
  meta: {
    ...(graph.meta ?? {}),
    enrichment: {
      packageDiscovery: `${discoverySource}: ${globs.join(", ")} -> ${modules.length} packages`,
      libraryFilesInGraph: files.filter((f) => f.library).length,
      testFiles: files.filter((f) => f.role === "test").length,
      productionFiles: files.filter((f) => f.role === "production").length,
      handAddedTestSymbols: addedTests,
      handAddedEdges: addedEdges,
      testPatterns: TEST_PATTERNS.map(String),
    },
  },
};

await Bun.write(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.error(JSON.stringify(out.meta.enrichment, null, 2));
console.error(`wrote ${outPath}: ${out.modules.length} modules, ${out.files.length} files, ${out.symbols.length} symbols, ${out.edges.length} edges`);
