import { Language, Parser, type Node } from "web-tree-sitter";

export type LanguageId = "python" | "typescript" | "tsx" | "javascript";

const grammarFiles: Record<LanguageId, string> = {
  python: "tree-sitter-python.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
};

const extensions: [RegExp, LanguageId][] = [
  [/\.pyi?$/, "python"],
  [/\.(m|c)?tsx?$/, "tsx"],
  [/\.(m|c)?jsx?$/, "javascript"],
];

export const sourcePathspecs = ["*.py", "*.pyi", "*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs"];

export function languageOf(path: string): LanguageId | null {
  if (/\.d\.[mc]?ts$/.test(path)) return null;
  const match = extensions.find(([pattern]) => pattern.test(path));
  if (!match) return null;
  return match[1] === "tsx" && /\.[mc]?ts$/.test(path) ? "typescript" : match[1];
}

let parsers: Promise<Map<LanguageId, Parser>> | undefined;

function loadParsers(): Promise<Map<LanguageId, Parser>> {
  parsers ??= (async () => {
    const wasmDirectory = new URL("../../node_modules/@vscode/tree-sitter-wasm/wasm/", import.meta.url).pathname;
    await Parser.init();
    const entries = await Promise.all(
      Object.entries(grammarFiles).map(async ([id, file]) => {
        const parser = new Parser();
        parser.setLanguage(await Language.load(wasmDirectory + file));
        return [id as LanguageId, parser] as const;
      }),
    );
    return new Map(entries);
  })();
  return parsers;
}

export async function readSyntaxTree<T>(language: LanguageId, source: string, read: (root: Node) => T): Promise<T | null> {
  const parser = (await loadParsers()).get(language)!;
  const tree = parser.parse(source);
  if (!tree) return null;
  try {
    return read(tree.rootNode);
  } finally {
    tree.delete();
  }
}

export const lineOf = (node: Node) => node.startPosition.row + 1;
export const endLineOf = (node: Node) => node.endPosition.row + 1;
