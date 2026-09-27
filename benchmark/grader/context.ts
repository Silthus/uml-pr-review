import type { Change } from "./change.ts";
import type { GraderConfig } from "./config.ts";
import type { RepositoryFingerprints, FingerprintCache } from "./fingerprints.ts";
import type { ImportGraph } from "./graph.ts";
import type { SharedSymbols } from "./symbols.ts";
import type { BlobCache } from "../../coherence/blob-cache.ts";
import type { Finding } from "./violations.ts";

export type TouchedFunction = { file: string; name: string; line: number; before: { ccn: number; nloc: number } | null; after: { ccn: number; nloc: number } | null };

export type DetectorResult = Finding & { touched?: TouchedFunction[] };

export type GradeContext = {
  change: Change;
  config: GraderConfig;
  graphs(): Promise<{ before: ImportGraph; after: ImportGraph }>;
  fingerprintsAtBase(): Promise<RepositoryFingerprints>;
  fingerprintCache: FingerprintCache;
  sharedSymbols(): Promise<SharedSymbols>;
  resultCache: BlobCache;
};

export type Detector = (context: GradeContext) => Promise<DetectorResult>;
