import { extractSourceFile } from "../../src/analyzer/extract.ts";
import { readBlobsBySha } from "./git-objects.ts";
import { extractImports, type ImportRef } from "./imports.ts";

export type ExtractMode = "imports" | "v1";

export type ExtractRequest = { repoDir: string; mode: ExtractMode; files: { sha: string; path: string }[] };

export type ExtractResult =
  | { sha: string; ok: true; imports: ImportRef[]; symbols?: number; bytes: number }
  | { sha: string; ok: false; bytes: number };

declare const self: Worker;

self.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  const { repoDir, mode, files } = event.data;
  const blobs = await readBlobsBySha(repoDir, [...new Set(files.map((file) => file.sha))]);
  const results: ExtractResult[] = [];
  for (const { sha, path } of files) {
    const source = blobs.get(sha);
    const bytes = source?.length ?? 0;
    if (source === undefined) {
      results.push({ sha, ok: false, bytes });
      continue;
    }
    if (mode === "v1") {
      const extracted = await extractSourceFile(path, source);
      results.push(
        extracted
          ? {
              sha,
              ok: true,
              bytes,
              symbols: extracted.symbols.length,
              imports: [...new Set(extracted.imports.map((binding) => binding.module))].map((specifier) => ({
                specifier,
                line: 0,
                kind: "static" as const,
              })),
            }
          : { sha, ok: false, bytes },
      );
      continue;
    }
    const imports = await extractImports(path, source);
    results.push(imports ? { sha, ok: true, bytes, imports } : { sha, ok: false, bytes });
  }
  postMessage(results);
};
