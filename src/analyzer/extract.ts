import { languageOf, readSyntaxTree } from "./parser.ts";
import { extractPython } from "./python.ts";
import { SymbolCollector, type SourceFile } from "./source-file.ts";
import { extractTypeScript } from "./typescript.ts";

export function isTestPath(path: string): boolean {
  return (
    /(^|\/)(tests?|__tests__|__snapshots__)\//.test(path) ||
    /(^|\/)test_[^/]*\.py$/.test(path) ||
    /_test\.py$/.test(path) ||
    /\.(test|spec)\.[mc]?[jt]sx?$/.test(path)
  );
}

export async function extractSourceFile(path: string, source: string): Promise<SourceFile | null> {
  const language = languageOf(path);
  if (!language) return null;
  const collector = new SymbolCollector(path);
  const extracted = await readSyntaxTree(language, source, (root) => {
    if (language === "python") extractPython(root, collector, isTestPath(path));
    else extractTypeScript(root, collector);
    return true;
  });
  if (!extracted) return null;
  return { path, language, symbols: collector.symbols, calls: collector.calls, imports: collector.imports };
}
