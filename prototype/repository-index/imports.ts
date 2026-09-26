import type { Node } from "web-tree-sitter";
import { languageOf, readSyntaxTree } from "../../src/analyzer/parser.ts";

export type ImportKind = "static" | "type" | "lazy" | "reexport" | "dynamic" | "require";

export type ImportRef = { specifier: string; line: number; kind: ImportKind; names?: string[] };

export async function extractImports(path: string, source: string): Promise<ImportRef[] | null> {
  const language = languageOf(path);
  if (!language) return null;
  return readSyntaxTree(language, source, (root) => (language === "python" ? pythonImports(root) : scriptImports(root)));
}

function pythonImports(root: Node): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const statement of root.descendantsOfType(["import_statement", "import_from_statement"])) {
    const line = statement.startPosition.row + 1;
    const kind = pythonImportKind(statement);
    if (statement.type === "import_statement") {
      for (const name of statement.childrenForFieldName("name")) {
        const dotted = name.type === "aliased_import" ? name.childForFieldName("name")?.text : name.text;
        if (dotted) refs.push({ specifier: dotted, line, kind });
      }
      continue;
    }
    const module = statement.childForFieldName("module_name")?.text;
    if (!module) continue;
    const names = statement.childrenForFieldName("name").map((name) =>
      name.type === "aliased_import" ? (name.childForFieldName("name")?.text ?? "") : name.text,
    );
    const wildcard = statement.namedChildren.some((child) => child.type === "wildcard_import");
    refs.push({ specifier: module, line, kind, names: wildcard ? ["*"] : names.filter(Boolean) });
  }
  return refs;
}

function pythonImportKind(statement: Node): ImportKind {
  for (let node = statement.parent; node; node = node.parent) {
    if (node.type === "function_definition") return "lazy";
    if (node.type === "if_statement" && /TYPE_CHECKING/.test(node.childForFieldName("condition")?.text ?? "")) return "type";
  }
  return "static";
}

function scriptImports(root: Node): ImportRef[] {
  const refs: ImportRef[] = [];
  const push = (specifierNode: Node | null | undefined, at: Node, kind: ImportKind) => {
    const text = specifierNode?.text;
    if (!text || !/^["'`]/.test(text) || text.includes("${")) return;
    refs.push({ specifier: text.slice(1, -1), line: at.startPosition.row + 1, kind });
  };
  for (const statement of root.namedChildren) {
    if (statement.type === "import_statement") {
      push(statement.childForFieldName("source"), statement, /^import\s+type\b/.test(statement.text) ? "type" : "static");
    }
    if (statement.type === "export_statement") push(statement.childForFieldName("source"), statement, "reexport");
  }
  for (const call of root.descendantsOfType("call_expression")) {
    const callee = call.childForFieldName("function");
    const firstArgument = call.childForFieldName("arguments")?.namedChildren[0];
    if (callee?.type === "import") push(firstArgument, call, "dynamic");
    else if (callee?.type === "identifier" && callee.text === "require") push(firstArgument, call, "require");
  }
  return refs;
}
