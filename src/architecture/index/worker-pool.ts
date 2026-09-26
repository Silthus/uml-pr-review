import type { BlobToExtract, Extraction, ExtractionReply, ExtractionRequest } from "./extract-worker.ts";

const chunkSize = 100;

export async function extractInWorkers(cwd: string, blobs: BlobToExtract[], workerCount: number): Promise<Extraction[]> {
  const chunks = chunksOf(blobs);
  const extractions: Extraction[] = [];
  const drain = async () => {
    const worker = new Worker(new URL("./extract-worker.ts", import.meta.url).href);
    try {
      for (let chunk = chunks.shift(); chunk; chunk = chunks.shift()) {
        extractions.push(...(await extractChunk(worker, { cwd, blobs: chunk })));
      }
    } catch (error) {
      chunks.length = 0;
      throw error;
    } finally {
      worker.terminate();
    }
  };
  await Promise.all(Array.from({ length: Math.min(workerCount, chunks.length) }, drain));
  return extractions;
}

function chunksOf(blobs: BlobToExtract[]): BlobToExtract[][] {
  return Array.from({ length: Math.ceil(blobs.length / chunkSize) }, (_, index) => blobs.slice(index * chunkSize, (index + 1) * chunkSize));
}

function extractChunk(worker: Worker, request: ExtractionRequest): Promise<Extraction[]> {
  return new Promise((resolve, reject) => {
    const stopped = () => reject(new Error("An import extraction worker stopped before it answered."));
    const settle = (outcome: () => void) => {
      worker.removeEventListener("close", stopped);
      outcome();
    };
    worker.addEventListener("close", stopped);
    worker.onmessage = ({ data }: MessageEvent<ExtractionReply>) => settle(() => (data.ok ? resolve(data.extractions) : reject(new Error(data.message))));
    worker.onerror = (event) => settle(() => reject(new Error(event.message)));
    worker.postMessage(request);
  });
}
