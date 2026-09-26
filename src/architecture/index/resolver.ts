import type { ImportRef } from "./imports.ts";
import { PythonResolver } from "./python-resolver.ts";
import { repositoryFiles, type Resolution } from "./resolution.ts";
import { ScriptResolver } from "./script-resolver.ts";

export type ImportResolver = (fromPath: string, ref: ImportRef) => Resolution;

export function createImportResolver(paths: string[], readText: (path: string) => string | undefined): ImportResolver {
  const repository = repositoryFiles(paths, readText);
  const python = new PythonResolver(repository, paths);
  const script = new ScriptResolver(repository, paths);
  return (fromPath, ref) => (/\.pyi?$/.test(fromPath) ? python.resolve(fromPath, ref) : script.resolve(fromPath, ref));
}
