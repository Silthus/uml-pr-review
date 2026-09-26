import type { ImportRef } from "./imports.ts";
import { PythonResolver } from "./python-resolver.ts";
import { repositoryFiles, type Resolution } from "./resolution.ts";
import { loadScriptConfiguration, type ReadTexts } from "./script-configuration.ts";
import { ScriptResolver } from "./script-resolver.ts";

export type ImportResolver = (fromPath: string, ref: ImportRef) => Resolution;

export async function createImportResolver(paths: string[], readTexts: ReadTexts): Promise<ImportResolver> {
  const repository = repositoryFiles(paths);
  const python = new PythonResolver(repository, paths);
  const script = new ScriptResolver(repository, await loadScriptConfiguration(repository.files, readTexts));
  return (fromPath, ref) => (/\.pyi?$/.test(fromPath) ? python.resolve(fromPath, ref) : script.resolve(fromPath, ref));
}
