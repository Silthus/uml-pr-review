import type { BlobCache } from "../../coherence/blob-cache.ts";
import type { Change } from "./change.ts";
import type { GraderConfig } from "./config.ts";
import type { FingerprintCache } from "./fingerprints.ts";
import type { ImportGraph } from "./graph.ts";
import type { TreeLookup } from "./tree-index.ts";
import type { Finding } from "./violations.ts";

export type TouchedFunction = { file: string; name: string; line: number; before: { ccn: number; nloc: number } | null; after: { ccn: number; nloc: number } | null };

export type DetectorResult = Finding & { touched?: TouchedFunction[] };

export type GradeContext = {
  change: Change;
  config: GraderConfig;
  graphs(): Promise<{ before: ImportGraph; after: ImportGraph }>;
  fingerprintsAtBase(): Promise<TreeLookup<number>>;
  symbolsAtBase(): Promise<TreeLookup<string>>;
  fingerprintCache: FingerprintCache;
  resultCache: BlobCache;
};

export type Detector = (context: GradeContext) => Promise<DetectorResult>;
