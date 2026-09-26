import type { Node } from "web-tree-sitter";
import type { SymbolKind } from "../graph.ts";
import { endLineOf, lineOf } from "./parser.ts";
import { SymbolCollector, type ExtractedSymbol, type Receiver } from "./source-file.ts";

const functionValueTypes = new Set(["arrow_function", "function_expression", "function", "generator_function"]);
const classTypes = new Set(["class_declaration", "abstract_class_declaration", "class"]);
const testStructureKinds: Record<string, SymbolKind> = {
  describe: "describe",
  suite: "describe",
  context: "describe",
  it: "test",
  test: "test",
  specify: "test",
  beforeEach: "hook",
  afterEach: "hook",
  beforeAll: "hook",
  afterAll: "hook",
};

export function extractTypeScript(root: Node, collector: SymbolCollector): void {
  const visitStatements = (statements: Node[], parent?: ExtractedSymbol) => {
    for (const statement of statements) visitStatement(statement, parent);
  };

  const visitStatement = (statement: Node, parent?: ExtractedSymbol) => {
    const node = unwrapExport(statement);
    if (node.type === "function_declaration" || node.type === "generator_function_declaration") {
      return addFunction(statement, node, nameOf(node), parent);
    }
    if (classTypes.has(node.type)) return visitClass(statement, node, parent);
    if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      return visitDeclarations(statement, node, parent);
    }
    if (node.type === "expression_statement" && visitTestStructure(node, parent)) return;
    if (parent) collectCalls(node, parent.id, collector);
  };

  const addFunction = (outer: Node, node: Node, name: string, parent?: ExtractedSymbol) => {
    const kind: SymbolKind = parent && parent.kind !== "describe" ? "method" : "function";
    const symbol = collector.add({ name, kind, ...rangeOf(outer, node.childForFieldName("body")) }, parent);
    collectCalls(node, symbol.id, collector);
  };

  const visitClass = (outer: Node, node: Node, parent?: ExtractedSymbol) => {
    const body = node.childForFieldName("body");
    const symbol = collector.add({ name: nameOf(node), kind: "class", ...rangeOf(outer, body) }, parent);
    for (const heritage of node.namedChildren.filter((child) => child.type === "class_heritage")) {
      collectCalls(heritage, symbol.id, collector);
    }
    for (const member of body?.namedChildren ?? []) visitClassMember(member, symbol);
  };

  const visitClassMember = (member: Node, owner: ExtractedSymbol) => {
    if (member.type === "method_definition") return addFunction(member, member, nameOf(member), owner);
    const value = member.childForFieldName("value");
    if (member.type === "public_field_definition" && value && functionValueTypes.has(value.type)) {
      return addFunction(member, value, nameOf(member), owner);
    }
    collectCalls(member, owner.id, collector);
  };

  const visitDeclarations = (outer: Node, declaration: Node, parent?: ExtractedSymbol) => {
    const declarators = declaration.namedChildren.filter((child) => child.type === "variable_declarator");
    const span = declarators.length === 1 ? outer : undefined;
    for (const declarator of declarators) visitDeclarator(span ?? declarator, declarator, parent);
  };

  const visitDeclarator = (outer: Node, declarator: Node, parent?: ExtractedSymbol) => {
    const name = declarator.childForFieldName("name");
    const value = declarator.childForFieldName("value");
    if (!value || name?.type !== "identifier") {
      if (parent && value) collectCalls(value, parent.id, collector);
      return;
    }
    if (functionValueTypes.has(value.type)) return addFunction(outer, value, name.text, parent);
    if (classTypes.has(value.type)) return visitClass(outer, value, parent);
    if (value.type === "object") return visitObject(outer, value, name.text, parent);
    if (containsFunction(value)) {
      const symbol = collector.add({ name: name.text, kind: "object", ...rangeOf(outer, value) }, parent);
      return collectCalls(value, symbol.id, collector);
    }
    if (parent) collectCalls(value, parent.id, collector);
  };

  const visitObject = (outer: Node, object: Node, name: string, parent?: ExtractedSymbol) => {
    if (!containsFunction(object)) {
      if (parent) collectCalls(object, parent.id, collector);
      return;
    }
    const symbol = collector.add({ name, kind: "object", ...rangeOf(outer, object) }, parent);
    for (const member of object.namedChildren) {
      const value = member.type === "pair" ? member.childForFieldName("value") : null;
      if (member.type === "method_definition") addFunction(member, member, nameOf(member), symbol);
      else if (value && functionValueTypes.has(value.type)) addFunction(member, value, keyOf(member), symbol);
      else collectCalls(member, symbol.id, collector);
    }
  };

  const visitTestStructure = (statement: Node, parent?: ExtractedSymbol): boolean => {
    const call = statement.namedChildren[0];
    if (call?.type !== "call_expression") return false;
    const kind = testStructureKinds[baseCalleeName(call.childForFieldName("function"))];
    if (!kind) return false;
    const args = call.childForFieldName("arguments")?.namedChildren ?? [];
    const callback = args.findLast((arg) => functionValueTypes.has(arg.type));
    const title = kind === "hook" ? baseCalleeName(call.childForFieldName("function")) : titleOf(args[0]);
    const symbol = collector.add({ name: title, kind, ...rangeOf(statement, callback?.childForFieldName("body") ?? null) }, parent);
    const body = callback?.childForFieldName("body");
    if (kind === "describe" && body?.type === "statement_block") visitStatements(body.namedChildren, symbol);
    else if (callback) collectCalls(callback, symbol.id, collector);
    return true;
  };

  collectImports(root, collector);
  visitStatements(root.namedChildren);
}

function unwrapExport(statement: Node): Node {
  if (statement.type !== "export_statement") return statement;
  return statement.childForFieldName("declaration") ?? statement.childForFieldName("value") ?? statement;
}

function rangeOf(outer: Node, body: Node | null) {
  const start = lineOf(outer);
  return { range: { start, end: endLineOf(outer) }, signatureEnd: body ? Math.max(start, lineOf(body)) : start };
}

const nameOf = (node: Node) => node.childForFieldName("name")?.text ?? "default";

const keyOf = (pair: Node) => pair.childForFieldName("key")?.text.replace(/^["'`]|["'`]$/g, "") ?? "anonymous";

const containsFunction = (node: Node) => node.descendantsOfType([...functionValueTypes]).length > 0;

function baseCalleeName(callee: Node | null): string {
  if (!callee) return "";
  if (callee.type === "identifier") return callee.text;
  if (callee.type === "member_expression") return baseCalleeName(callee.childForFieldName("object"));
  if (callee.type === "call_expression") return baseCalleeName(callee.childForFieldName("function"));
  return "";
}

function titleOf(node: Node | undefined): string {
  if (!node) return "anonymous";
  if (node.type === "string" || node.type === "template_string") return node.text.slice(1, -1);
  return node.text;
}

function collectCalls(node: Node, ownerId: string, collector: SymbolCollector) {
  const push = (target: { name: string; receiver: Receiver } | null, at: Node) => {
    if (target) collector.calls.push({ ownerId, ...target, line: lineOf(at) });
  };
  for (const call of node.descendantsOfType(["call_expression", "new_expression"])) {
    push(callTarget(call.childForFieldName(call.type === "new_expression" ? "constructor" : "function")), call);
  }
  for (const element of node.descendantsOfType(["jsx_opening_element", "jsx_self_closing_element"])) {
    const target = callTarget(element.childForFieldName("name"));
    if (target && /^[A-Z]/.test(target.name)) push(target, element);
  }
}

function callTarget(target: Node | null): { name: string; receiver: Receiver } | null {
  if (!target) return null;
  if (target.type === "identifier") return { name: target.text, receiver: { kind: "none" } };
  if (target.type !== "member_expression") return null;
  const name = target.childForFieldName("property")?.text;
  const object = target.childForFieldName("object");
  if (!name || !object) return null;
  return { name, receiver: receiverOf(object) };
}

function receiverOf(object: Node): Receiver {
  if (object.type === "this") return { kind: "self" };
  if (object.type === "identifier") return { kind: "name", name: object.text };
  return { kind: "other" };
}

function collectImports(root: Node, collector: SymbolCollector) {
  for (const statement of root.namedChildren.filter((child) => child.type === "import_statement")) {
    const module = statement.childForFieldName("source")?.text.slice(1, -1);
    const clause = statement.namedChildren.find((child) => child.type === "import_clause");
    if (!module || !clause) continue;
    for (const part of clause.namedChildren) {
      if (part.type === "identifier") collector.imports.push({ module, imported: "default", local: part.text });
      if (part.type === "namespace_import") {
        const local = part.namedChildren.find((child) => child.type === "identifier")?.text;
        if (local) collector.imports.push({ module, imported: null, local });
      }
      if (part.type === "named_imports") {
        for (const specifier of part.namedChildren.filter((child) => child.type === "import_specifier")) {
          const name = specifier.childForFieldName("name")?.text;
          const alias = specifier.childForFieldName("alias")?.text;
          if (name) collector.imports.push({ module, imported: name, local: alias ?? name });
        }
      }
    }
  }
}
