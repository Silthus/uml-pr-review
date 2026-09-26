import { readBlobs } from "./git.ts";
import type { LanguageId } from "../../analyzer/parser.ts";
import { extractImports, type ImportRef } from "./imports.ts";

export type BlobToExtract = { sha: string; language: LanguageId };
export type ExtractionRequest = { cwd: string; blobs: BlobToExtract[] };
export type Extraction = { blob: BlobToExtract; refs: ImportRef[] | null };
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
  for (const blob of blobs) {
    const source = sources.get(blob.sha);
    extractions.push({ blob, refs: source === undefined ? null : await extractOrNull(blob.language, source) });
  }
  return extractions;
}

async function extractOrNull(language: LanguageId, source: string): Promise<ImportRef[] | null> {
  try {
    return await extractImports(language, source);
  } catch {
    return null;
  }
}
