import { readBlobs } from "./git.ts";
import { extractImports, type ImportRef } from "./imports.ts";

export type BlobToExtract = { sha: string; path: string };
export type ExtractionRequest = { cwd: string; blobs: BlobToExtract[] };
export type Extraction = { sha: string; refs: ImportRef[] | null };
export type ExtractionReply = { ok: true; extractions: Extraction[] } | { ok: false; message: string };

declare const self: Worker;

self.onmessage = async (event: MessageEvent<ExtractionRequest>) => {
  postMessage(await replyTo(event.data));
};

async function replyTo(request: ExtractionRequest): Promise<ExtractionReply> {
  try {
    return { ok: true, extractions: await extractChunk(request) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function extractChunk({ cwd, blobs }: ExtractionRequest): Promise<Extraction[]> {
  const sources = await readBlobs(cwd, blobs.map(({ sha }) => sha));
  const extractions: Extraction[] = [];
  for (const { sha, path } of blobs) {
    const source = sources.get(sha);
    extractions.push({ sha, refs: source === undefined ? null : await extractOrNull(path, source) });
  }
  return extractions;
}

async function extractOrNull(path: string, source: string): Promise<ImportRef[] | null> {
  try {
    return await extractImports(path, source);
  } catch {
    return null;
  }
}
