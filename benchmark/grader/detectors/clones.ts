import { isProductionSource, renamesOf, type ChangedFile, type Side } from "../change.ts";
import type { Detector, GradeContext } from "../context.ts";
import type { Fingerprint } from "../fingerprints.ts";
import { sideLookup, type SideLookup } from "../side-lookup.ts";
import type { Violation } from "../violations.ts";

type Located = Fingerprint & { others: string[] };

export const duplication: Detector = async (context) => {
  const base = await context.fingerprintsAtBase();
  const fingerprintsOf = (file: ChangedFile, side: Side) => (file[side] ? context.fingerprintCache.ofText(file[side].sha, file[side].text) : []);
  const hashesOf = (file: ChangedFile, side: Side) => fingerprintsOf(file, side).map(({ hash }) => hash);
  const lookups = { before: sideLookup(base, context.change, "before", hashesOf), after: sideLookup(base, context.change, "after", hashesOf) };
  const renames = renamesOf(context.change);
  const introduced: Violation[] = [];
  const removed: Violation[] = [];
  for (const file of context.change.files.filter(({ path }) => isProductionSource(path))) {
    const duplicatedOn = (side: Side) => duplicated(fingerprintsOf(file, side), file[side]?.path ?? "", lookups[side], context);
    const [was, now] = [duplicatedOn("before"), duplicatedOn("after")];
    introduced.push(...blocks(unmatched(now, was), file.path, context, "copies"));
    removed.push(...blocks(unmatched(was, now), renames.get(file.previousPath) ?? file.path, context, "no longer copies"));
  }
  return { introduced, removed };
};

function duplicated(fingerprints: Fingerprint[], path: string, elsewhere: SideLookup<number>, context: GradeContext): Located[] {
  const occurrences = Map.groupBy(fingerprints, ({ hash }) => hash);
  return fingerprints.flatMap((fingerprint) => {
    const selfCopies = (occurrences.get(fingerprint.hash)?.length ?? 0) > 1 ? [path] : [];
    const others = [...new Set([...elsewhere(fingerprint.hash, path), ...selfCopies])];
    return others.length === 0 || others.length > context.config.clones.maxFiles ? [] : [{ ...fingerprint, others }];
  });
}

function unmatched(items: Located[], others: Located[]): Located[] {
  const remaining = new Map<number, number>();
  for (const { hash } of others) remaining.set(hash, (remaining.get(hash) ?? 0) + 1);
  return items.filter(({ hash }) => {
    const count = remaining.get(hash) ?? 0;
    if (count > 0) remaining.set(hash, count - 1);
    return count === 0;
  });
}

function blocks(located: Located[], file: string, context: GradeContext, verb: string): Violation[] {
  const { gapLines, minFingerprints } = context.config.clones;
  const groups: Located[][] = [];
  for (const fingerprint of [...located].sort((a, b) => a.line - b.line)) {
    const current = groups.at(-1);
    if (current && fingerprint.line - current.at(-1)!.line <= gapLines) current.push(fingerprint);
    else groups.push([fingerprint]);
  }
  return groups
    .filter((group) => group.length >= minFingerprints)
    .map((group): Violation => {
      const [first, last] = [group[0]!.line, group.at(-1)!.line];
      const other = mostCommon(group.flatMap(({ others }) => others));
      return { detector: "duplication", rule: "clone", file, line: first, subject: `${first}:${other}`, message: `${file}:${first}-${last} ${verb} code from ${other}` };
    });
}

function mostCommon(paths: string[]): string {
  const counts = new Map<string, number>();
  for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
}
