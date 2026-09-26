import type { Finding, Seam } from "../contracts/index.ts";
import type { Feedback } from "./feedback.ts";
import type { Location } from "./change.ts";

export type DraftFinding = Omit<Finding, "id" | "severity"> & { severity: "violation" | "planned" | "warning" };

type DraftSpec = Location & Feedback & { rule: Finding["rule"]; severity: DraftFinding["severity"]; subject: Finding["subject"]; target?: string; test?: boolean };

export function draftOf({ test = false, target, ...spec }: DraftSpec): DraftFinding {
  return target === undefined ? { ...spec, test } : { ...spec, target, test };
}

export function moduleSubject(path: string): Finding["subject"] {
  return { kind: "module", path };
}

export function seamSubject({ from, to }: Pick<Seam, "from" | "to">): Finding["subject"] {
  return { kind: "seam", from, to };
}
