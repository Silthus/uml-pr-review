import type { Node } from "web-tree-sitter";
import type { SymbolKind } from "../graph.ts";
import { endLineOf, lineOf } from "./parser.ts";
import { SymbolCollector, type ExtractedSymbol, type Receiver } from "./source-file.ts";

const hookNames = new Set([
  "setUp",
  "tearDown",
  "setUpClass",
  "tearDownClass",
  "setUpTestData",
  "setup_method",
  "teardown_method",
  "setup_class",
  "teardown_class",
]);

export function extractPython(root: Node, collector: SymbolCollector, isTestFile: boolean): void {
  const visitStatements = (statements: Node[], parent?: ExtractedSymbol) => {
    for (const statement of statements) visitStatement(statement, parent);
  };

  const visitStatement = (statement: Node, parent?: ExtractedSymbol) => {
    const definition = unwrapDecorated(statement);
    if (definition.type === "class_definition") return visitClass(statement, definition, parent);
    if (definition.type === "function_definition") return visitFunction(statement, definition, parent);
    if (parent) collectCalls(statement, parent.id, collector);
  };

  const visitClass = (outer: Node, definition: Node, parent?: ExtractedSymbol) => {
    const name = definition.childForFieldName("name")?.text ?? "anonymous";
    const kind: SymbolKind = isTestFile && name.startsWith("Test") ? "describe" : "class";
    const body = definition.childForFieldName("body");
    const symbol = collector.add(
      { name, kind, range: { start: lineOf(outer), end: endLineOf(outer) }, signatureEnd: signatureEndOf(definition, body) },
      parent,
    );
    collectDecoratorCalls(outer, symbol.id, collector);
    visitStatements(body?.namedChildren ?? [], symbol);
  };

  const visitFunction = (outer: Node, definition: Node, parent?: ExtractedSymbol) => {
    const name = definition.childForFieldName("name")?.text ?? "anonymous";
    const body = definition.childForFieldName("body");
    const symbol = collector.add(
      {
        name,
        kind: functionKind(name, parent),
        range: { start: lineOf(outer), end: endLineOf(outer) },
        signatureEnd: signatureEndOf(definition, body),
      },
      parent,
    );
    collectDecoratorCalls(outer, symbol.id, collector);
    if (body) collectCalls(body, symbol.id, collector);
  };

  const functionKind = (name: string, parent?: ExtractedSymbol): SymbolKind => {
    const inTestScope = parent?.kind === "describe" || (!parent && isTestFile);
    if (inTestScope && name.startsWith("test")) return "test";
    if (parent?.kind === "describe" && hookNames.has(name)) return "hook";
    return parent ? "method" : "function";
  };

  collectImports(root, collector);
  visitStatements(root.namedChildren);
}

function unwrapDecorated(node: Node): Node {
  return node.type === "decorated_definition" ? (node.childForFieldName("definition") ?? node) : node;
}

function signatureEndOf(definition: Node, body: Node | null): number {
  return body ? Math.max(lineOf(definition), lineOf(body) - 1) : lineOf(definition);
}

function collectDecoratorCalls(outer: Node, ownerId: string, collector: SymbolCollector) {
  if (outer.type !== "decorated_definition") return;
  for (const decorator of outer.namedChildren.filter((child) => child.type === "decorator")) {
    collectCalls(decorator, ownerId, collector);
  }
}

function collectCalls(node: Node, ownerId: string, collector: SymbolCollector) {
  for (const call of node.descendantsOfType("call")) {
    const target = call.childForFieldName("function");
    const site = target && callTarget(target);
    if (site) collector.calls.push({ ownerId, ...site, line: lineOf(call) });
  }
}

function callTarget(target: Node): { name: string; receiver: Receiver } | null {
  if (target.type === "identifier") return { name: target.text, receiver: { kind: "none" } };
  if (target.type !== "attribute") return null;
  const name = target.childForFieldName("attribute")?.text;
  const object = target.childForFieldName("object");
  if (!name || !object) return null;
  return { name, receiver: receiverOf(object) };
}

function receiverOf(object: Node): Receiver {
  if (object.type !== "identifier") return { kind: "other" };
  if (object.text === "self" || object.text === "cls") return { kind: "self" };
  return { kind: "name", name: object.text };
}

function collectImports(root: Node, collector: SymbolCollector) {
  for (const statement of root.descendantsOfType(["import_statement", "import_from_statement"])) {
    collectImport(statement, collector);
  }
}

function collectImport(statement: Node, collector: SymbolCollector) {
  if (statement.type === "import_from_statement") {
    const module = statement.childForFieldName("module_name")?.text;
    if (!module) return;
    for (const imported of statement.childrenForFieldName("name")) {
      const binding = importedName(imported);
      if (binding) collector.imports.push({ module, imported: binding.name, local: binding.local });
    }
  }
  if (statement.type === "import_statement") {
    for (const imported of statement.childrenForFieldName("name")) {
      const binding = importedName(imported);
      if (binding) collector.imports.push({ module: binding.name, imported: null, local: binding.local });
    }
  }
}

function importedName(node: Node): { name: string; local: string } | null {
  if (node.type === "dotted_name") return { name: node.text, local: node.text };
  if (node.type !== "aliased_import") return null;
  const name = node.childForFieldName("name")?.text;
  const alias = node.childForFieldName("alias")?.text;
  return name && alias ? { name, local: alias } : null;
}
