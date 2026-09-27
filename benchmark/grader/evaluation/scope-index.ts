import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { measureCoherence } from "../../../coherence/measure.ts";
import type { IsolatedFix } from "../corpus.ts";

export const scopeMoveThreshold = 0.2;
const ScopeResultSchema = z.object({ id: z.string(), scope: z.string(), before: z.number().nullable(), after: z.number().nullable() });
export type ScopeResult = z.infer<typeof ScopeResultSchema>;

function scopeOf(path: string): string {
  const segments = path.split("/");
  if (segments[0] === "products" && segments.length > 2) return segments.slice(0, 2).join("/");
  if (segments[0] === "frontend" && segments[1] === "src" && segments.length > 4) return segments.slice(0, 4).join("/");
  return segments.slice(0, Math.min(2, segments.length - 1)).join("/") || segments[0]!;
}

export async function scopeIndexResults(repository: string, fixes: IsolatedFix[], directory: string): Promise<ScopeResult[]> {
  await mkdir(directory, { recursive: true });
  const results: ScopeResult[] = [];
  for (const fix of fixes) {
    const file = Bun.file(join(directory, `${fix.id.replaceAll(":", "_")}.json`));
    if (await file.exists()) {
      results.push(ScopeResultSchema.parse(await file.json()));
      continue;
    }
    const scope = scopeOf(fix.path);
    const [before, after] = [await compositeAt(repository, scope, fix.before), await compositeAt(repository, scope, fix.fix)];
    const result = { id: fix.id, scope, before, after };
    await Bun.write(file, JSON.stringify(result));
    results.push(result);
  }
  return results;
}

export function movedAsAsked({ before, after }: ScopeResult): boolean {
  return before !== null && after !== null && after - before >= scopeMoveThreshold;
}

async function compositeAt(repository: string, scope: string, commit: string): Promise<number | null> {
  return measureCoherence({ repository, scope, commit }).then(
    (report) => report.index.composite.score,
    () => null,
  );
}
