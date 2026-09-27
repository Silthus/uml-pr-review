import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { measureCoherence } from "../../../coherence/measure.ts";
import { diffLocal } from "../../../coherence/validation/diff-local.ts";
import type { IsolatedFix } from "../corpus.ts";

export const scopeMoveThreshold = 0.2;
const ScopeResultSchema = z.object({ id: z.string(), scope: z.string(), before: z.number().nullable(), after: z.number().nullable(), diffLocal: z.number().nullable() });
export type ScopeResult = z.infer<typeof ScopeResultSchema>;

function scopeOf(path: string): string {
  const segments = path.split("/");
  if (segments[0] === "products" && segments.length > 2) return segments.slice(0, 2).join("/");
  if (segments[0] === "frontend" && segments[1] === "src" && segments.length > 4) return segments.slice(0, 4).join("/");
  return segments.slice(0, Math.min(2, segments.length - 1)).join("/") || segments[0]!;
}

export async function scopeIndexResults(repository: string, fixes: IsolatedFix[], directory: string): Promise<ScopeResult[]> {
  const reports = join(directory, "reports");
  await mkdir(reports, { recursive: true });
  const results: ScopeResult[] = [];
  for (const fix of fixes) {
    const file = Bun.file(join(directory, `${fix.id.replaceAll(":", "_")}.json`));
    const stored = (await file.exists()) ? ScopeResultSchema.partial({ diffLocal: true }).parse(await file.json()) : undefined;
    const scope = scopeOf(fix.path);
    const composites = stored ?? { before: await compositeAt(repository, scope, fix.before), after: await compositeAt(repository, scope, fix.fix) };
    const result = { id: fix.id, scope, before: composites.before, after: composites.after, diffLocal: stored?.diffLocal ?? (await diffLocalScore(repository, scope, fix, reports)) };
    await Bun.write(file, JSON.stringify(result));
    results.push(result);
  }
  return results;
}

export function movedAsAsked({ before, after }: ScopeResult): boolean {
  return before !== null && after !== null && after - before >= scopeMoveThreshold;
}

export function movedTheOtherWay({ before, after }: ScopeResult): boolean {
  return before !== null && after !== null && before - after >= scopeMoveThreshold;
}

async function compositeAt(repository: string, scope: string, commit: string): Promise<number | null> {
  return measureCoherence({ repository, scope, commit }).then(
    (report) => report.index.composite.score,
    () => null,
  );
}

async function diffLocalScore(repository: string, scope: string, fix: IsolatedFix, reports: string): Promise<number | null> {
  const directory = join(reports, fix.id.replaceAll(":", "_"));
  await mkdir(directory, { recursive: true });
  return diffLocal(repository, scope, fix.before, fix.fix, directory).then(
    ({ score }) => score,
    () => null,
  );
}
