// PROTOTYPE - throwaway. The precise extractor.
//
// One ts.createLanguageService over every workspace source file of the
// checkout. No projectReferences, because a referenced project resolves to its
// dist/*.d.ts output and that hides every callee edge inside the package.
// Callers come from provideCallHierarchyIncomingCalls. Callees come from a
// syntax tree walk of the touched symbol body, resolved through the checker.
// See docs/research/typescript-call-graph.md on research/typescript-call-graph.

import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
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
  isExternalPath,
  listWorkspaceFiles,
  overlaps,
  repoRelative,
  toPosix,
} from "./workspace.ts";

/**
 * Use the TypeScript that the analyzed checkout installs, not ours. lonir runs
 * 6.0.3; a different compiler would resolve its modules differently.
 */
function loadTypeScript(worktree: string): typeof import("typescript") {
  const require = createRequire(join(worktree, "package.json"));
  try {
    return require("typescript");
  } catch {
    return createRequire(import.meta.url)("typescript");
  }
}

type ts = typeof import("typescript");
type TsNode = import("typescript").Node;
type TsSourceFile = import("typescript").SourceFile;

/** A symbol found in one file, with the nodes the extractor still needs. */
type Decl = {
  id: string;
  name: string;
  qualified: string;
  kind: SymbolKind;
  parentId?: string;
  startLine: number;
  endLine: number;
  sigStartLine: number;
  sigEndLine: number;
  /** Position of the declaration name. Both call hierarchy calls need it. */
  namePos: number;
  node: TsNode;
  /** The node whose body holds the calls this symbol makes. */
  bodyNode: TsNode;
  relPath: string;
};

function containsFunction(ts: ts, node: TsNode): boolean {
  let found = false;
  const visit = (n: TsNode) => {
    if (found) return;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  };
  node.forEachChild(visit);
  return found;
}

function memberName(ts: ts, node: TsNode): string | undefined {
  const named = node as { name?: TsNode };
  if (!named.name) return undefined;
  if (ts.isIdentifier(named.name)) return named.name.text;
  if (ts.isStringLiteral(named.name)) return named.name.text;
  if (ts.isPrivateIdentifier(named.name)) return named.name.text;
  return undefined;
}

/**
 * Every symbol declared in one file, innermost last within a parent.
 *
 * Kind rules that the lonir shapes force:
 * - `const f = () => {}` is an arrow. Its symbol lives on the
 *   VariableDeclaration, and its flags are BlockScopedVariable, not Function,
 *   so a flag filter would drop most of the functions in the repository.
 * - `export const send = internalAction({ handler: async () => {} })` is one
 *   symbol of kind const. The convex action is the reviewable unit, so the
 *   handler is not split out and every call in it belongs to `send`.
 * - `const api = { a() {}, b: () => {} }` is a const with two method members,
 *   because the initializer is an object literal directly.
 * - A const whose initializer holds no function at all is not a symbol.
 */
function listSymbols(ts: ts, sf: TsSourceFile, relPath: string): Decl[] {
  const out: Decl[] = [];
  const lineOf = (pos: number) =>
    sf.getLineAndCharacterOfPosition(pos).line + 1;

  const push = (args: {
    name: string;
    kind: SymbolKind;
    parent?: Decl;
    node: TsNode;
    rangeNode: TsNode;
    nameNode: TsNode;
    sigEndNode: TsNode;
    bodyNode: TsNode;
  }): Decl => {
    const qualified = args.parent
      ? `${args.parent.qualified}.${args.name}`
      : args.name;
    const decl: Decl = {
      id: `${relPath}#${qualified}`,
      name: args.name,
      qualified,
      kind: args.kind,
      ...(args.parent ? { parentId: args.parent.id } : {}),
      // Include the doc comment in the range. A pull request that only edits a
      // doc comment then still marks the symbol touched.
      startLine: lineOf(args.rangeNode.getStart(sf, true)),
      endLine: lineOf(args.rangeNode.getEnd()),
      sigStartLine: lineOf(args.node.getStart(sf, false)),
      sigEndLine: lineOf(args.sigEndNode.getEnd()),
      namePos: args.nameNode.getStart(sf, false),
      node: args.node,
      bodyNode: args.bodyNode,
      relPath,
    };
    out.push(decl);
    return decl;
  };

  const sigEnd = (node: TsNode, fallback: TsNode): TsNode => {
    const sig = node as { parameters?: readonly TsNode[] };
    const params = sig.parameters;
    if (params && params.length > 0) return params[params.length - 1]!;
    return fallback;
  };

  const visit = (node: TsNode, parent: Decl | undefined) => {
    let next = parent;

    if (ts.isFunctionDeclaration(node)) {
      const name = node.name ? node.name.text : "default";
      next = push({
        name,
        kind: "function",
        ...(parent ? { parent } : {}),
        node,
        rangeNode: node,
        nameNode: node.name ?? node,
        sigEndNode: sigEnd(node, node.name ?? node),
        bodyNode: node.body ?? node,
      });
    } else if (ts.isClassDeclaration(node)) {
      // `export default class {}` has no name. The binder calls it `default`.
      const name = node.name ? node.name.text : "default";
      const cls = push({
        name,
        kind: "class",
        ...(parent ? { parent } : {}),
        node,
        rangeNode: node,
        nameNode: node.name ?? node,
        sigEndNode: node.name ?? node,
        bodyNode: node,
      });
      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) ||
          ts.isGetAccessor(member) ||
          ts.isSetAccessor(member) ||
          ts.isConstructorDeclaration(member)
        ) {
          const mName = ts.isConstructorDeclaration(member)
            ? "constructor"
            : memberName(ts, member);
          if (!mName) continue;
          const nameNode = ts.isConstructorDeclaration(member)
            ? member
            : ((member as { name: TsNode }).name ?? member);
          const method = push({
            name: mName,
            kind: "method",
            parent: cls,
            node: member,
            rangeNode: member,
            nameNode,
            sigEndNode: sigEnd(member, nameNode),
            bodyNode: member.body ?? member,
          });
          if (member.body) visit(member.body, method);
        } else if (
          ts.isPropertyDeclaration(member) &&
          member.initializer &&
          (ts.isArrowFunction(member.initializer) ||
            ts.isFunctionExpression(member.initializer))
        ) {
          const mName = memberName(ts, member);
          if (!mName) continue;
          const nameNode = (member as { name: TsNode }).name;
          push({
            name: mName,
            kind: "method",
            parent: cls,
            node: member,
            rangeNode: member,
            nameNode,
            sigEndNode: sigEnd(member.initializer, nameNode),
            bodyNode: member.initializer,
          });
        }
      }
      return; // Members handled. Do not walk the class body twice.
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const init = node.initializer;
      const statement =
        node.parent && node.parent.parent && ts.isVariableStatement(node.parent.parent)
          ? node.parent.parent
          : node;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        next = push({
          name: node.name.text,
          kind: "arrow",
          ...(parent ? { parent } : {}),
          node,
          rangeNode: statement,
          nameNode: node.name,
          sigEndNode: sigEnd(init, node.name),
          bodyNode: init.body,
        });
      } else if (init && ts.isObjectLiteralExpression(init)) {
        if (!containsFunction(ts, init)) return;
        const obj = push({
          name: node.name.text,
          kind: "const",
          ...(parent ? { parent } : {}),
          node,
          rangeNode: statement,
          nameNode: node.name,
          sigEndNode: node.name,
          bodyNode: init,
        });
        for (const prop of init.properties) {
          const mName = memberName(ts, prop);
          if (!mName) continue;
          if (ts.isMethodDeclaration(prop)) {
            const method = push({
              name: mName,
              kind: "method",
              parent: obj,
              node: prop,
              rangeNode: prop,
              nameNode: (prop as { name: TsNode }).name,
              sigEndNode: sigEnd(prop, (prop as { name: TsNode }).name),
              bodyNode: prop.body ?? prop,
            });
            if (prop.body) visit(prop.body, method);
          } else if (
            ts.isPropertyAssignment(prop) &&
            (ts.isArrowFunction(prop.initializer) ||
              ts.isFunctionExpression(prop.initializer))
          ) {
            const method = push({
              name: mName,
              kind: "method",
              parent: obj,
              node: prop,
              rangeNode: prop,
              nameNode: (prop as { name: TsNode }).name,
              sigEndNode: sigEnd(
                prop.initializer,
                (prop as { name: TsNode }).name,
              ),
              bodyNode: prop.initializer.body ?? prop.initializer,
            });
            visit(prop.initializer, method);
          }
        }
        return;
      } else if (
        init &&
        ts.isSourceFile(statement.parent) &&
        containsFunction(ts, init)
      ) {
        // The convex shape: a factory call that wraps a handler function, such
        // as `export const send = internalAction({ handler: async () => {} })`.
        // Only at module top level. Inside a body, `const x = rows.find(r =>
        // r.ok)` also holds a function and is plainly not a symbol.
        next = push({
          name: node.name.text,
          kind: "const",
          ...(parent ? { parent } : {}),
          node,
          rangeNode: statement,
          nameNode: node.name,
          sigEndNode: node.name,
          bodyNode: init,
        });
      } else {
        return; // A plain data const. Not a symbol.
      }
    }

    node.forEachChild((child) => visit(child, next));
  };

  sf.forEachChild((child) => visit(child, undefined));
  return out;
}

/** The listed symbol that most tightly encloses a position. */
function innermostAt(decls: readonly Decl[], pos: number): Decl | undefined {
  let best: Decl | undefined;
  for (const d of decls) {
    if (pos < d.node.getStart(d.node.getSourceFile(), true)) continue;
    if (pos > d.node.getEnd()) continue;
    if (!best || d.node.getStart(d.node.getSourceFile(), true) >= best.node.getStart(best.node.getSourceFile(), true))
      best = d;
  }
  return best;
}

/**
 * Is `node` the thing being invoked, and not just an argument of a call?
 * `arr.map(foo)` puts foo under a CallExpression too, so the identity test on
 * `.expression` is what separates a real call from a plain reference.
 */
function isCallee(ts: ts, node: TsNode): boolean {
  let current = node;
  while (
    current.parent &&
    ts.isPropertyAccessExpression(current.parent) &&
    current.parent.name === current
  ) {
    current = current.parent;
  }
  const p = current.parent;
  if (!p) return false;
  if (ts.isCallExpression(p) && p.expression === current) return true;
  if (ts.isNewExpression(p) && p.expression === current) return true;
  if (ts.isTaggedTemplateExpression(p) && p.tag === current) return true;
  if (ts.isDecorator(p) && p.expression === current) return true;
  return false;
}

/** The identifier that starts at a position. ts.getTokenAtPosition is internal. */
function identifierAt(
  ts: ts,
  sf: TsSourceFile,
  pos: number,
): TsNode | undefined {
  let found: TsNode | undefined;
  const visit = (node: TsNode) => {
    if (pos < node.getStart(sf, false) || pos >= node.getEnd()) return;
    if (
      (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) &&
      node.getStart(sf, false) === pos
    ) {
      found = node;
      return;
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

export async function analyze(input: AnalyzeInput): Promise<Graph> {
  const ts = loadTypeScript(input.worktree);
  // Resolve symlinks. On macOS /tmp is a link to /private/tmp, and the
  // compiler reports realpaths, so repository relative ids would escape.
  const worktree = toPosix(realpathSync(input.worktree));
  const notes: string[] = [`typescript ${ts.version}`];
  const counters: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counters[k] = (counters[k] ?? 0) + n);

  const rootNames = listWorkspaceFiles(worktree);
  bump("workspaceFiles", rootNames.length);

  const options: import("typescript").CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    allowJs: true,
    resolveJsonModule: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true,
    noEmit: true,
    baseUrl: worktree,
    // apps/web is the only workspace project with path aliases. A single
    // program has a single paths map, so its aliases go in globally.
    paths: {
      "@/*": ["apps/web/src/*"],
      "@/stores": ["apps/web/src/stores"],
      "@/stores/*": ["apps/web/src/stores/*"],
      "@/features/*": ["apps/web/src/features/*"],
      "@/hooks/*": ["apps/web/src/hooks/*"],
      "@/components/*": ["apps/web/src/components/*"],
      "@/routes/*": ["apps/web/src/routes/*"],
    },
  };

  const versions = new Map<string, string>();
  const host: import("typescript").LanguageServiceHost = {
    getScriptFileNames: () => rootNames,
    getScriptVersion: () => "1",
    getScriptSnapshot(fileName) {
      let text = versions.get(fileName);
      if (text === undefined) {
        try {
          text = readFileSync(fileName, "utf8");
        } catch {
          return undefined;
        }
        versions.set(fileName, text);
      }
      return ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => worktree,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const program = service.getProgram();
  if (!program) throw new Error("no program");
  const checker = program.getTypeChecker();
  bump("programSourceFiles", program.getSourceFiles().length);

  // Confirm the claim from the research: every root file lands in the program,
  // so there is never a program to choose.
  const missingRoots = rootNames.filter((f) => !program.getSourceFile(f));
  bump("rootFilesMissingFromProgram", missingRoots.length);

  const symbolsByFile = new Map<string, Decl[]>();
  const declsFor = (abs: string): Decl[] => {
    const cached = symbolsByFile.get(abs);
    if (cached) return cached;
    const sf = program.getSourceFile(abs);
    const decls = sf ? listSymbols(ts, sf, repoRelative(worktree, abs)) : [];
    symbolsByFile.set(abs, decls);
    return decls;
  };

  const graphSymbols = new Map<string, GraphSymbol>();
  const graphFiles = new Map<string, GraphFile>();
  const edges: GraphEdge[] = [];

  const addSymbol = (d: Decl, touchedInfo: {
    touched: boolean;
    signatureTouched: boolean;
    hop: number;
  }) => {
    const existing = graphSymbols.get(d.id);
    if (existing) {
      if (touchedInfo.hop < existing.hop) existing.hop = touchedInfo.hop;
      existing.touched ||= touchedInfo.touched;
      existing.signatureTouched ||= touchedInfo.signatureTouched;
      return;
    }
    graphSymbols.set(d.id, {
      id: d.id,
      fileId: d.relPath,
      name: d.name,
      kind: d.kind,
      ...(d.parentId ? { parentId: d.parentId } : {}),
      line: { start: d.startLine, end: d.endLine },
      touched: touchedInfo.touched,
      signatureTouched: touchedInfo.signatureTouched,
      hop: touchedInfo.hop,
    });
  };

  // --- Touched files and touched symbols ------------------------------------
  const touchedDecls: Decl[] = [];
  for (const file of input.touched) {
    const abs = `${worktree}/${file.path}`;
    graphFiles.set(file.path, {
      id: file.path,
      path: file.path,
      touched: true,
      status: file.status,
    });
    if (file.status === "deleted") {
      notes.push(`${file.path} is deleted on the head side, so it has no symbols`);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(file.path)) continue;
    if (!program.getSourceFile(abs)) {
      notes.push(`touched file not in the program: ${file.path}`);
      bump("touchedFilesNotInProgram");
      continue;
    }
    const lines = [...file.touchedLines, ...file.deleteAnchors];
    for (const d of declsFor(abs)) {
      const touched = overlaps(lines, d.startLine, d.endLine);
      const signatureTouched =
        touched && overlaps(lines, d.sigStartLine, d.sigEndLine);
      addSymbol(d, { touched, signatureTouched, hop: 0 });
      if (touched) touchedDecls.push(d);
    }
  }
  bump("touchedSymbols", touchedDecls.length);

  const neighborDecls: Decl[] = [];
  const noteNeighbor = (d: Decl) => {
    neighborDecls.push(d);
    if (!graphFiles.has(d.relPath)) {
      graphFiles.set(d.relPath, {
        id: d.relPath,
        path: d.relPath,
        touched: false,
        status: "untouched",
      });
    }
  };

  // --- Callees: walk the body, resolve each call through the checker ---------
  const resolveTarget = (nameNode: TsNode): Decl | undefined => {
    let symbol = checker.getSymbolAtLocation(nameNode);
    if (!symbol) return undefined;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      try {
        symbol = checker.getAliasedSymbol(symbol);
      } catch {
        // Keep the alias.
      }
    }
    const declarations = symbol.declarations ?? [];
    if (declarations.length === 0) return undefined;
    // Prefer an implementation over an overload signature.
    const ordered = [...declarations].sort((a, b) => {
      const aBody = (a as { body?: unknown }).body ? 0 : 1;
      const bBody = (b as { body?: unknown }).body ? 0 : 1;
      return aBody - bBody;
    });
    for (const decl of ordered) {
      const declFile = toPosix(decl.getSourceFile().fileName);
      if (isExternalPath(declFile)) {
        bump("calleesOutsideWorkspace");
        continue;
      }
      // The declaration must BE a listed symbol. An enclosing-range match
      // would attribute `const inner = model.doStream.bind(model)` to the
      // function that holds it and invent an edge that nobody wrote.
      const found = declsFor(declFile).find((d) => d.node === decl);
      if (found) return found;
      bump("calleeDeclarationNotAListedSymbol");
    }
    return undefined;
  };

  for (const file of input.touched) {
    const abs = `${worktree}/${file.path}`;
    const sf = program.getSourceFile(abs);
    if (!sf) continue;
    const decls = declsFor(abs);
    const touchedIds = new Set(touchedDecls.filter((d) => d.relPath === repoRelative(worktree, abs)).map((d) => d.id));
    if (touchedIds.size === 0) continue;

    const walk = (node: TsNode) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const expr = node.expression;
        const nameNode = ts.isPropertyAccessExpression(expr) ? expr.name : expr;
        if (ts.isIdentifier(nameNode) || ts.isPrivateIdentifier(nameNode)) {
          const owner = innermostAt(decls, node.getStart(sf, false));
          if (owner && touchedIds.has(owner.id)) {
            bump("calleeCallSites");
            const target = resolveTarget(nameNode);
            if (target) {
              edges.push({ from: owner.id, to: target.id, kind: "call" });
              if (!touchedIds.has(target.id)) noteNeighbor(target);
            } else {
              bump("calleeUnresolved");
            }
          }
        }
      }
      node.forEachChild(walk);
    };
    sf.forEachChild(walk);
  }

  // --- Callers: the call hierarchy incoming calls ---------------------------
  for (const d of touchedDecls) {
    const abs = `${worktree}/${d.relPath}`;
    let incoming;
    try {
      incoming = service.provideCallHierarchyIncomingCalls(abs, d.namePos);
    } catch {
      bump("callHierarchyThrew");
      continue;
    }
    for (const call of incoming ?? []) {
      const fromFile = toPosix(call.from.file);
      if (isExternalPath(fromFile)) {
        bump("callersOutsideWorkspace");
        continue;
      }
      const fromSf = program.getSourceFile(fromFile);
      if (!fromSf) continue;
      // Incoming calls over-report for a member: `const f = obj.method` counts
      // as an incoming call. Re-check every span against the syntax tree.
      const realSpans = call.fromSpans.filter((span) => {
        const token = identifierAt(ts, fromSf, span.start);
        if (!token) return true; // Nothing at the position. Trust the API.
        return isCallee(ts, token);
      });
      if (realSpans.length === 0) {
        bump("callerSpansRejectedAsNotCalls", call.fromSpans.length);
        continue;
      }
      const callerDecls = declsFor(fromFile);
      const caller = innermostAt(callerDecls, call.from.selectionSpan.start);
      if (!caller) {
        // A call at module top level. The item is the source file itself.
        bump("callersAtModuleTopLevel");
        continue;
      }
      edges.push({ from: caller.id, to: d.id, kind: "call" });
      if (!touchedDecls.some((t) => t.id === caller.id)) noteNeighbor(caller);
    }
  }

  for (const n of neighborDecls) {
    addSymbol(n, { touched: false, signatureTouched: false, hop: 1 });
  }

  notes.push(
    "callees resolved through the checker; callees outside the workspace are dropped",
    "one symbol per convex action: the handler arrow is not split out",
  );

  return sortGraph({
    version: 0,
    pr: input.pr,
    files: [...graphFiles.values()],
    symbols: [...graphSymbols.values()],
    edges: dedupeEdges(edges),
    meta: { extractor: "tsc", notes, counters },
  });
}

if (import.meta.main) {
  const [inputPath, outputPath] = process.argv.slice(2);
  const input = JSON.parse(readFileSync(inputPath!, "utf8")) as AnalyzeInput;
  const graph = await analyze(input);
  await Bun.write(outputPath!, `${JSON.stringify(graph, null, 2)}\n`);
  console.error(JSON.stringify(graph.meta.counters));
}
