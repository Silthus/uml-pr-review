import { readBlobs } from "./git.ts";
import { loadParsers, type LanguageId } from "../../analyzer/parser.ts";
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
    return { ok: false, message: messageOf(error) };
  }
}

async function extractChunk({ cwd, blobs }: ExtractionRequest): Promise<Extraction[]> {
  await loadGrammars();
  const sources = await readBlobs(cwd, blobs.map(({ sha }) => sha));
  const extractions: Extraction[] = [];
  for (const blob of blobs) {
    extractions.push({ blob, refs: await extractOrNull(blob.language, sourceOf(sources, blob)) });
  }
  return extractions;
}

async function loadGrammars() {
  try {
    await loadParsers();
  } catch (error) {
    throw new Error(`The indexer could not load the tree-sitter grammars, so it indexed nothing. Run bun install. ${messageOf(error)}`);
  }
}

function sourceOf(sources: Map<string, string>, { sha }: BlobToExtract): string {
  const source = sources.get(sha);
  if (source === undefined) throw new Error(`Git could not read blob ${sha}, so the indexer indexed nothing.`);
  return source;
}

async function extractOrNull(language: LanguageId, source: string): Promise<ImportRef[] | null> {
  try {
    return await extractImports(language, source);
  } catch {
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
