import type { ArchitecturePayload } from "../../src/architecture/contracts/index.ts";

export type FileImport = { from: string; to: string; fromTest: boolean };
export type UnresolvedImport = { file: string; specifier: string };

export type IndexView = {
  imports: FileImport[];
  unresolved: UnresolvedImport[];
  moduleOf(path: string): string | undefined;
};

export function indexViewOf(payload: ArchitecturePayload): IndexView {
  const modulePaths = payload.modules.map(([path]) => path);
  const files = payload.files.map(([path, module, , role]) => ({ path, module: modulePaths[module]!, test: role === "test" }));
  const moduleByPath = new Map(files.map(({ path, module }) => [path, module]));
  return {
    imports: payload.imports.map(([from, to]) => ({ from: files[from]!.path, to: files[to]!.path, fromTest: files[from]!.test })),
    unresolved: payload.unresolved.map(([file, , specifier]) => ({ file: files[file]!.path, specifier })),
    moduleOf: (path) => moduleByPath.get(path),
  };
}

export function pairKey(from: string, to: string): string {
  return `${from}\0${to}`;
}
