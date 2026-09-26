import type { Node } from "web-tree-sitter";
import { lineOf, readSyntaxTree, type LanguageId } from "../../analyzer/parser.ts";
import type { ImportKind } from "../contracts/index.ts";

export type ImportRef = { specifier: string; line: number; kind: ImportKind; names: string[] };

export const extractorVersion = "imports-v3";

export async function extractImports(language: LanguageId, source: string): Promise<ImportRef[] | null> {
  return readSyntaxTree(language, source, (root) => (language === "python" ? pythonImports(root) : scriptImports(root)));
}

function pythonImports(root: Node): ImportRef[] {
  return root.descendantsOfType(["import_statement", "import_from_statement"]).flatMap((statement) => {
    const line = lineOf(statement);
    const kind = pythonImportKind(statement);
    if (statement.type === "import_statement") {
      return statement.childrenForFieldName("name").map((name) => ({ specifier: importedName(name), line, kind, names: [] }));
    }
    const module = statement.childForFieldName("module_name")?.text;
    if (!module) return [];
    const wildcard = statement.namedChildren.some((child) => child.type === "wildcard_import");
    const names = wildcard ? ["*"] : statement.childrenForFieldName("name").map(importedName).filter(Boolean);
    return [{ specifier: module, line, kind, names }];
  });
}

function importedName(name: Node): string {
  return name.type === "aliased_import" ? (name.childForFieldName("name")?.text ?? "") : name.text;
}

function pythonImportKind(statement: Node): ImportKind {
  for (let child: Node = statement, parent = statement.parent; parent; child = parent, parent = parent.parent) {
    if (parent.type === "function_definition") return "lazy";
    if (isTypeCheckingBranch(parent, child)) return "type";
  }
  return "static";
}

function isTypeCheckingBranch(parent: Node, child: Node): boolean {
  return (
    parent.type === "if_statement" &&
    parent.childForFieldName("consequence")?.id === child.id &&
    /^(typing\.)?TYPE_CHECKING$/.test(parent.childForFieldName("condition")?.text ?? "")
  );
}

function scriptImports(root: Node): ImportRef[] {
  return [...root.namedChildren.flatMap(moduleStatementImport), ...root.descendantsOfType("call_expression").flatMap(callImport)];
}

function moduleStatementImport(statement: Node): ImportRef[] {
  if (statement.type === "import_statement") {
    const requireClause = statement.namedChildren.find((child) => child.type === "import_require_clause");
    if (requireClause) return importRef(requireClause.childForFieldName("source"), statement, "require", []);
    const kind = /^import\s+type\b/.test(statement.text) ? "type" : "static";
    return importRef(statement.childForFieldName("source"), statement, kind, importedBindings(statement));
  }
  if (statement.type === "export_statement") return importRef(statement.childForFieldName("source"), statement, "reexport", exportedBindings(statement));
  return [];
}

function callImport(call: Node): ImportRef[] {
  const callee = call.childForFieldName("function");
  const specifier = call.childForFieldName("arguments")?.namedChildren[0];
  if (callee?.type === "import") return importRef(specifier, call, "dynamic", []);
  if (callee?.type === "identifier" && callee.text === "require") return importRef(specifier, call, "require", []);
  return [];
}

function importedBindings(statement: Node): string[] {
  const clause = statement.namedChildren.find((child) => child.type === "import_clause");
  const bindings = clause?.namedChildren ?? [];
  const named = bindings.find((binding) => binding.type === "named_imports");
  if (!named || bindings.length > 1) return [];
  return specifierNames(named, "import_specifier");
}

function exportedBindings(statement: Node): string[] {
  const clause = statement.namedChildren.find((child) => child.type === "export_clause");
  return clause ? specifierNames(clause, "export_specifier") : [];
}

function specifierNames(list: Node, specifierType: string): string[] {
  return list.namedChildren
    .filter((child) => child.type === specifierType)
    .map((specifier) => withoutQuotes(specifier.childForFieldName("name")?.text ?? ""))
    .filter(Boolean);
}

function withoutQuotes(name: string): string {
  return /^["']/.test(name) ? name.slice(1, -1) : name;
}

function importRef(specifierNode: Node | null | undefined, at: Node, kind: ImportKind, names: string[]): ImportRef[] {
  const literal = specifierNode?.text;
  if (!literal || !/^["'`]/.test(literal) || literal.includes("${")) return [];
  return [{ specifier: literal.slice(1, -1), line: lineOf(at), kind, names }];
}
