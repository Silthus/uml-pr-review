// PROTOTYPE - throwaway. The syntax-only extractor.
//
// Native tree-sitter plus tree-sitter-typescript. No type information, no
// module resolution beyond what the text of an import statement says.
//
// Symbol listing mirrors extract-tsc.ts rule for rule, so the comparison is
// about edges and not about which symbols each side chose to list.
//
// Edge resolution, in order. Every route is recorded in meta.counters:
//   1. local     - a symbol with that name in the same file.
//   2. relative  - the file imports the name from './x' or '../x', and that
//                  specifier resolves on disk to a workspace file.
//   3. bareGlobal- the file imports the name from a package specifier such as
//                  '@omnigame/errors'. Lexical resolution cannot follow that,
//                  so it falls back to every symbol of that name in the
//                  repository. This is the route that invents edges.
//   4. blind     - the name is neither local nor imported. No edge at all.

import Parser from "tree-sitter";
import TreeSitterTypeScript from "tree-sitter-typescript";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  AnalyzeInput,
  Graph,
  GraphEdge,
  GraphFile,
  GraphSymbol,
  SymbolKind,
} from "./interface.ts";
import { dedupeEdges, sortGraph } from "./interface.ts";
import {
  isTestPath,
  listWorkspaceFiles,
  overlaps,
  repoRelative,
  toPosix,
} from "./workspace.ts";

type TsNode = Parser.SyntaxNode;

type Sym = {
  id: string;
  relPath: string;
  name: string;
  qualified: string;
  kind: SymbolKind;
  parentId?: string;
  startLine: number;
  endLine: number;
  sigStartLine: number;
  sigEndLine: number;
  /** Byte offsets, used to find the innermost symbol around a call site. */
  from: number;
  to: number;
};

type CallSite = {
  name: string;
  ownerId: string | undefined;
  /** True for `obj.foo()`. The receiver type is what tree-sitter cannot see. */
  viaMember: boolean;
};

type FileFacts = {
  relPath: string;
  symbols: Sym[];
  /** Imported name -> resolved workspace file, or null for a bare specifier. */
  imports: Map<string, string | null>;
  calls: CallSite[];
};

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx", ""];

/** Lexical specifier resolution. Relative paths only. No tsconfig, no exports. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (candidate.endsWith(".ts") || candidate.endsWith(".tsx")) {
      if (existsSync(candidate)) return toPosix(candidate);
    }
  }
  // A '.js' specifier that means a '.ts' file on disk.
  if (spec.endsWith(".js")) {
    const swapped = `${base.slice(0, -3)}.ts`;
    if (existsSync(swapped)) return toPosix(swapped);
  }
  return null;
}

function nameOf(node: TsNode | null): string | undefined {
  if (!node) return undefined;
  if (node.type === "identifier" || node.type === "property_identifier")
    return node.text;
  if (node.type === "private_property_identifier") return node.text;
  if (node.type === "string") return node.namedChildren[0]?.text ?? node.text;
  return undefined;
}

function containsFunction(node: TsNode): boolean {
  const stack = [...node.namedChildren];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type === "arrow_function" || n.type === "function_expression")
      return true;
    stack.push(...n.namedChildren);
  }
  return false;
}

/**
 * Start row of a declaration including any doc comment that sits directly
 * above it. This matches getStart(sourceFile, true) in the compiler API.
 */
function startRowWithDoc(node: TsNode): number {
  let top = node;
  while (
    top.parent &&
    (top.parent.type === "export_statement" ||
      top.parent.type === "lexical_declaration" ||
      top.parent.type === "variable_declaration")
  ) {
    top = top.parent;
  }
  let row = top.startPosition.row;
  let prev = top.previousSibling;
  while (prev && prev.type === "comment" && prev.endPosition.row >= row - 1) {
    row = prev.startPosition.row;
    prev = prev.previousSibling;
  }
  return row + 1;
}

/** Row of the declaration keyword, without the doc comment. */
function sigStartRow(node: TsNode): number {
  let top = node;
  while (
    top.parent &&
    (top.parent.type === "export_statement" ||
      top.parent.type === "lexical_declaration" ||
      top.parent.type === "variable_declaration")
  ) {
    top = top.parent;
  }
  return top.startPosition.row + 1;
}

/** Last row of the name plus parameter list. */
function sigEndRow(node: TsNode, nameNode: TsNode): number {
  const params = node.childForFieldName("parameters");
  if (params) return params.endPosition.row + 1;
  return nameNode.endPosition.row + 1;
}

function listSymbols(root: TsNode, relPath: string): Sym[] {
  const out: Sym[] = [];

  const push = (args: {
    name: string;
    kind: SymbolKind;
    parent?: Sym;
    node: TsNode;
    nameNode: TsNode;
    sigNode: TsNode;
  }): Sym => {
    const qualified = args.parent
      ? `${args.parent.qualified}.${args.name}`
      : args.name;
    const sym: Sym = {
      id: `${relPath}#${qualified}`,
      relPath,
      name: args.name,
      qualified,
      kind: args.kind,
      ...(args.parent ? { parentId: args.parent.id } : {}),
      startLine: startRowWithDoc(args.node),
      endLine: args.node.endPosition.row + 1,
      sigStartLine: sigStartRow(args.node),
      sigEndLine: sigEndRow(args.sigNode, args.nameNode),
      from: args.node.startIndex,
      to: args.node.endIndex,
    };
    out.push(sym);
    return sym;
  };

  const visit = (node: TsNode, parent: Sym | undefined) => {
    let next = parent;

    if (
      node.type === "function_declaration" ||
      node.type === "generator_function_declaration"
    ) {
      const nameNode = node.childForFieldName("name");
      const name = nameOf(nameNode) ?? "default";
      next = push({
        name,
        kind: "function",
        ...(parent ? { parent } : {}),
        node,
        nameNode: nameNode ?? node,
        sigNode: node,
      });
    } else if (node.type === "class_declaration") {
      const nameNode = node.childForFieldName("name");
      const cls = push({
        name: nameOf(nameNode) ?? "default",
        kind: "class",
        ...(parent ? { parent } : {}),
        node,
        nameNode: nameNode ?? node,
        sigNode: node,
      });
      const body = node.childForFieldName("body");
      for (const member of body?.namedChildren ?? []) {
        if (member.type === "method_definition") {
          const mNameNode = member.childForFieldName("name");
          const mName = nameOf(mNameNode);
          if (!mName || !mNameNode) continue;
          const method = push({
            name: mName,
            kind: "method",
            parent: cls,
            node: member,
            nameNode: mNameNode,
            sigNode: member,
          });
          const mBody = member.childForFieldName("body");
          if (mBody) for (const c of mBody.namedChildren) visit(c, method);
        } else if (member.type === "public_field_definition") {
          const value = member.childForFieldName("value");
          if (
            !value ||
            (value.type !== "arrow_function" &&
              value.type !== "function_expression")
          )
            continue;
          const mNameNode = member.childForFieldName("name");
          const mName = nameOf(mNameNode);
          if (!mName || !mNameNode) continue;
          push({
            name: mName,
            kind: "method",
            parent: cls,
            node: member,
            nameNode: mNameNode,
            sigNode: value,
          });
        }
      }
      return;
    } else if (node.type === "variable_declarator") {
      const nameNode = node.childForFieldName("name");
      const name = nameOf(nameNode);
      const value = node.childForFieldName("value");
      if (!name || !nameNode || !value) {
        for (const c of node.namedChildren) visit(c, next);
        return;
      }
      if (value.type === "arrow_function" || value.type === "function_expression") {
        next = push({
          name,
          kind: "arrow",
          ...(parent ? { parent } : {}),
          node,
          nameNode,
          sigNode: value,
        });
      } else if (value.type === "object") {
        if (!containsFunction(value)) return;
        const obj = push({
          name,
          kind: "const",
          ...(parent ? { parent } : {}),
          node,
          nameNode,
          sigNode: nameNode,
        });
        for (const prop of value.namedChildren) {
          if (prop.type === "method_definition") {
            const mNameNode = prop.childForFieldName("name");
            const mName = nameOf(mNameNode);
            if (!mName || !mNameNode) continue;
            const method = push({
              name: mName,
              kind: "method",
              parent: obj,
              node: prop,
              nameNode: mNameNode,
              sigNode: prop,
            });
            const mBody = prop.childForFieldName("body");
            if (mBody) for (const c of mBody.namedChildren) visit(c, method);
          } else if (prop.type === "pair") {
            const pValue = prop.childForFieldName("value");
            if (
              !pValue ||
              (pValue.type !== "arrow_function" &&
                pValue.type !== "function_expression")
            )
              continue;
            const mNameNode = prop.childForFieldName("key");
            const mName = nameOf(mNameNode);
            if (!mName || !mNameNode) continue;
            const method = push({
              name: mName,
              kind: "method",
              parent: obj,
              node: prop,
              nameNode: mNameNode,
              sigNode: pValue,
            });
            const pBody = pValue.childForFieldName("body");
            if (pBody) for (const c of pBody.namedChildren) visit(c, method);
          }
        }
        return;
      } else if (isModuleTopLevel(node) && containsFunction(value)) {
        // The convex factory shape. Top level only, same rule as the tsc side.
        next = push({
          name,
          kind: "const",
          ...(parent ? { parent } : {}),
          node,
          nameNode,
          sigNode: nameNode,
        });
      } else {
        return;
      }
    }

    for (const child of node.namedChildren) visit(child, next);
  };

  for (const child of root.namedChildren) visit(child, undefined);
  return out;
}

function isModuleTopLevel(declarator: TsNode): boolean {
  let n: TsNode | null = declarator.parent;
  while (
    n &&
    (n.type === "lexical_declaration" ||
      n.type === "variable_declaration" ||
      n.type === "export_statement")
  ) {
    n = n.parent;
  }
  return n?.type === "program";
}

function readImports(root: TsNode, absPath: string): Map<string, string | null> {
  const imports = new Map<string, string | null>();
  const record = (name: string, spec: string) => {
    if (imports.has(name)) return;
    imports.set(name, resolveSpecifier(absPath, spec));
  };
  for (const node of root.namedChildren) {
    if (node.type !== "import_statement") continue;
    const source = nameOf(node.childForFieldName("source"));
    if (!source) continue;
    for (const child of node.namedChildren) {
      if (child.type === "import_clause") {
        for (const part of child.namedChildren) {
          if (part.type === "identifier") record(part.text, source);
          else if (part.type === "namespace_import") {
            const id = part.namedChildren.find((c) => c.type === "identifier");
            if (id) record(id.text, source);
          } else if (part.type === "named_imports") {
            for (const spec of part.namedChildren) {
              if (spec.type !== "import_specifier") continue;
              const alias = spec.childForFieldName("alias");
              const original = spec.childForFieldName("name");
              // The local binding is what a later call can name.
              const local = nameOf(alias) ?? nameOf(original);
              if (local) record(local, source);
              // Keep the original name too, so a resolved target can be found
              // by the name it carries in the other file.
              const orig = nameOf(original);
              if (orig && alias && !imports.has(orig))
                imports.set(orig, resolveSpecifier(absPath, source));
            }
          }
        }
      }
    }
  }
  return imports;
}

/** The innermost listed symbol whose byte range holds an offset. */
function innermostAt(symbols: readonly Sym[], offset: number): Sym | undefined {
  let best: Sym | undefined;
  for (const s of symbols) {
    if (offset < s.from || offset > s.to) continue;
    if (!best || s.from >= best.from) best = s;
  }
  return best;
}

function collectCalls(root: TsNode, symbols: readonly Sym[]): CallSite[] {
  const calls: CallSite[] = [];
  const stack: TsNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "call_expression" || node.type === "new_expression") {
      const fn =
        node.childForFieldName("function") ?? node.childForFieldName("constructor");
      let name: string | undefined;
      if (fn) {
        if (fn.type === "identifier") name = fn.text;
        else if (fn.type === "member_expression")
          name = nameOf(fn.childForFieldName("property"));
      }
      if (name) {
        const owner = innermostAt(symbols, node.startIndex);
        calls.push({
          name,
          ownerId: owner?.id,
          viaMember: fn?.type === "member_expression",
        });
      }
    }
    stack.push(...node.namedChildren);
  }
  return calls;
}

export async function analyze(input: AnalyzeInput): Promise<Graph> {
  const worktree = toPosix(realpathSync(input.worktree));
  const notes: string[] = [];
  const counters: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counters[k] = (counters[k] ?? 0) + n);

  const parser = new Parser();
  const files = listWorkspaceFiles(worktree);
  bump("workspaceFiles", files.length);

  const facts = new Map<string, FileFacts>();
  const byName = new Map<string, Sym[]>();
  const symbolById = new Map<string, Sym>();

  for (const abs of files) {
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    parser.setLanguage(
      abs.endsWith(".tsx")
        ? TreeSitterTypeScript.tsx
        : TreeSitterTypeScript.typescript,
    );
    let tree;
    try {
      tree = parser.parse(text);
    } catch {
      bump("parseFailures");
      continue;
    }
    const relPath = repoRelative(worktree, abs);
    const symbols = listSymbols(tree.rootNode, relPath);
    facts.set(abs, {
      relPath,
      symbols,
      imports: readImports(tree.rootNode, abs),
      calls: collectCalls(tree.rootNode, symbols),
    });
    for (const s of symbols) {
      symbolById.set(s.id, s);
      const list = byName.get(s.name);
      if (list) list.push(s);
      else byName.set(s.name, [s]);
    }
  }
  bump("symbolsInWorkspace", symbolById.size);
  // The latent risk of name matching. Every one of these names is a coin flip
  // for this extractor, whatever this one pull request happens to touch.
  bump("distinctSymbolNames", byName.size);
  for (const [, list] of byName) {
    if (new Set(list.map((s) => s.relPath)).size > 1)
      bump("symbolNamesDeclaredInMoreThanOneFile");
  }

  type Route =
    | "local"
    | "relative"
    | "relativeDeadEnd"
    | "bareGlobal"
    | "bareNoMatch"
    | "blind";

  /** Name matching only. No type ever decides which `foo` this is. */
  const resolve = (
    file: FileFacts,
    name: string,
  ): { route: Route; targets: Sym[] } => {
    const local = file.symbols.filter((s) => s.name === name && !s.parentId);
    if (local.length > 0) return { route: "local", targets: local };
    if (file.imports.has(name)) {
      const target = file.imports.get(name)!;
      if (target) {
        const hits =
          facts.get(target)?.symbols.filter((s) => s.name === name && !s.parentId) ??
          [];
        // The specifier resolved, but the name is not declared there. A barrel
        // file that re-exports it. Lexical resolution stops at the barrel.
        if (hits.length === 0)
          return { route: "relativeDeadEnd", targets: [] };
        return { route: "relative", targets: hits };
      }
      // A package specifier. No lexical route exists, so fall back to every
      // symbol of that name in the repository.
      const global = byName.get(name) ?? [];
      if (global.length === 0) return { route: "bareNoMatch", targets: [] };
      return { route: "bareGlobal", targets: global };
    }
    return { route: "blind", targets: [] };
  };

  const graphFiles = new Map<string, GraphFile>();
  const graphSymbols = new Map<string, GraphSymbol>();
  const edges: GraphEdge[] = [];

  const addSymbol = (s: Sym, info: {
    touched: boolean;
    signatureTouched: boolean;
    hop: number;
  }) => {
    const existing = graphSymbols.get(s.id);
    if (existing) {
      if (info.hop < existing.hop) existing.hop = info.hop;
      existing.touched ||= info.touched;
      existing.signatureTouched ||= info.signatureTouched;
      return;
    }
    graphSymbols.set(s.id, {
      id: s.id,
      fileId: s.relPath,
      name: s.name,
      kind: s.kind,
      ...(s.parentId ? { parentId: s.parentId } : {}),
      line: { start: s.startLine, end: s.endLine },
      touched: info.touched,
      signatureTouched: info.signatureTouched,
      hop: info.hop,
    });
  };

  // --- Touched files and touched symbols -----------------------------------
  const touchedIds = new Set<string>();
  const touchedAbs = new Map<string, FileFacts>();
  for (const file of input.touched) {
    const abs = `${worktree}/${file.path}`;
    graphFiles.set(file.path, {
      id: file.path,
      path: file.path,
      touched: true,
      status: file.status,
      isTest: isTestPath(file.path),
    });
    if (file.status === "deleted") continue;
    const f = facts.get(abs);
    if (!f) {
      notes.push(`touched file not parsed: ${file.path}`);
      continue;
    }
    touchedAbs.set(abs, f);
    const lines = [...file.touchedLines, ...file.deleteAnchors];
    for (const s of f.symbols) {
      const touched = overlaps(lines, s.startLine, s.endLine);
      const signatureTouched =
        touched && overlaps(lines, s.sigStartLine, s.sigEndLine);
      addSymbol(s, { touched, signatureTouched, hop: 0 });
      if (touched) touchedIds.add(s.id);
    }
  }
  bump("touchedSymbols", touchedIds.size);

  const neighbors: Sym[] = [];
  const noteNeighbor = (s: Sym) => {
    neighbors.push(s);
    if (!graphFiles.has(s.relPath)) {
      graphFiles.set(s.relPath, {
        id: s.relPath,
        path: s.relPath,
        touched: false,
        status: "untouched",
        isTest: isTestPath(s.relPath),
      });
    }
  };

  // --- Callees: the calls a touched symbol makes ----------------------------
  for (const [abs, f] of touchedAbs) {
    for (const call of f.calls) {
      if (!call.ownerId || !touchedIds.has(call.ownerId)) continue;
      bump("calleeCallSites");
      const { route, targets } = resolve(f, call.name);
      bump(`calleeRoute_${route}`);
      if (targets.length === 0) bump("calleeUnresolved");
      if (route === "bareGlobal" && targets.length > 1)
        bump("calleeEdgesFromAmbiguousGlobalName", targets.length);
      for (const t of targets) {
        // A member call resolved by name alone is right only by luck: no
        // receiver type was ever consulted.
        if (call.viaMember) bump("calleeEdgesFromMemberCallNameMatch");
        edges.push({ from: call.ownerId, to: t.id, kind: "call" });
        if (!touchedIds.has(t.id)) noteNeighbor(t);
      }
    }
  }

  // --- Callers: every file in the workspace that names a touched symbol -----
  // Tree-sitter has no incoming call query, so this is a full scan.
  for (const [abs, f] of facts) {
    for (const call of f.calls) {
      if (!call.ownerId) {
        bump("callersAtModuleTopLevel");
        continue;
      }
      if (touchedAbs.has(abs) && touchedIds.has(call.ownerId)) continue;
      const { route, targets } = resolve(f, call.name);
      for (const t of targets) {
        if (!touchedIds.has(t.id)) continue;
        bump(`callerRoute_${route}`);
        if (call.viaMember) bump("callerEdgesFromMemberCallNameMatch");
        if (route === "bareGlobal" && targets.length > 1)
          bump("callerEdgesFromAmbiguousGlobalName");
        edges.push({ from: call.ownerId, to: t.id, kind: "call" });
        const owner = symbolById.get(call.ownerId);
        if (owner && !touchedIds.has(owner.id)) noteNeighbor(owner);
      }
    }
  }

  for (const n of neighbors) {
    addSymbol(n, { touched: false, signatureTouched: false, hop: 1 });
  }

  notes.push(
    "no type information: obj.foo() links by the name foo only",
    "a package specifier cannot be resolved, so an imported name falls back to every symbol of that name in the repository",
    "a barrel re-export is a dead end: the specifier resolves but the name is not declared there",
  );

  return sortGraph({
    version: 0,
    pr: input.pr,
    files: [...graphFiles.values()],
    symbols: [...graphSymbols.values()],
    edges: dedupeEdges(edges),
    meta: { extractor: "treesitter", notes, counters },
  });
}

if (import.meta.main) {
  const [inputPath, outputPath] = process.argv.slice(2);
  const input = JSON.parse(readFileSync(inputPath!, "utf8")) as AnalyzeInput;
  const graph = await analyze(input);
  await Bun.write(outputPath!, `${JSON.stringify(graph, null, 2)}\n`);
  console.error(JSON.stringify(graph.meta.counters));
}
