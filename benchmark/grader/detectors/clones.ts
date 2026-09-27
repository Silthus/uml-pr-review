import { isProductionSource, renamesOf, type Change, type ChangedFile, type Side } from "../change.ts";
import type { GradeContext } from "../context.ts";
import type { Fingerprint, RepositoryFingerprints } from "../fingerprints.ts";
import type { DetectorName, Finding, Violation } from "../violations.ts";

export type CloneScope = { detector: DetectorName; rule: string; eligible(path: string): boolean; counts(otherPath: string): boolean; message: string };

type Located = Fingerprint & { others: string[] };

export async function cloneFindings(context: GradeContext, scope: CloneScope): Promise<Finding> {
  const repository = await context.fingerprintsAtBase();
  const files = context.change.files.filter((file) => isProductionSource(file.path) && scope.eligible(file.path));
  const fingerprintsOf = (file: ChangedFile, side: Side) => (file[side] ? context.fingerprintCache.ofText(file[side].sha, file[side].text) : []);
  const changedOn = (side: Side) => new Map(context.change.files.flatMap((file) => (file[side] && isProductionSource(file[side].path) ? [[file[side].path, new Set(fingerprintsOf(file, side).map(({ hash }) => hash))] as const] : [])));
  const sides = { before: changedOn("before"), after: changedOn("after") };
  const replaced = new Set(changedPaths(context.change));
  const introduced: Violation[] = [];
  const removed: Violation[] = [];
  for (const file of files) {
    const duplicatedOn = (side: Side) => duplicated(fingerprintsOf(file, side), file[side]?.path ?? "", side === "before" ? new Set() : replaced, sides[side], repository, context, scope);
    const [was, now] = [duplicatedOn("before"), duplicatedOn("after")];
    introduced.push(...blocks(unmatched(now, was), file.path, context, scope, "copies"));
    removed.push(...blocks(unmatched(was, now), renamesOf(context.change).get(file.previousPath) ?? file.path, context, scope, "no longer copies"));
  }
  return { introduced, removed };
}

function duplicated(fingerprints: Fingerprint[], path: string, replaced: Set<string>, changed: Map<string, Set<number>>, repository: RepositoryFingerprints, context: GradeContext, scope: CloneScope): Located[] {
  const occurrences = Map.groupBy(fingerprints, ({ hash }) => hash);
  return fingerprints.flatMap((fingerprint) => {
    const elsewhere = repository.filesWith(fingerprint.hash).filter((other) => other !== path && !replaced.has(other));
    const changedElsewhere = [...changed].flatMap(([other, hashes]) => (other !== path && hashes.has(fingerprint.hash) ? [other] : []));
    const selfCopies = (occurrences.get(fingerprint.hash)?.length ?? 0) > 1 ? [path] : [];
    const others = [...new Set([...elsewhere, ...changedElsewhere, ...selfCopies])];
    if (others.length === 0 || others.length > context.config.clones.maxFiles) return [];
    const counted = others.filter(scope.counts);
    return counted.length > 0 ? [{ ...fingerprint, others: counted }] : [];
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

function blocks(located: Located[], file: string, context: GradeContext, scope: CloneScope, verb: string): Violation[] {
  const { gapLines, minFingerprints } = context.config.clones;
  const sorted = [...located].sort((a, b) => a.line - b.line);
  const groups: Located[][] = [];
  for (const fingerprint of sorted) {
    const current = groups.at(-1);
    if (current && fingerprint.line - current.at(-1)!.line <= gapLines) current.push(fingerprint);
    else groups.push([fingerprint]);
  }
  return groups
    .filter((group) => group.length >= minFingerprints)
    .map((group): Violation => {
      const other = mostCommon(group.flatMap(({ others }) => others));
      return { detector: scope.detector, rule: scope.rule, file, line: group[0]!.line, subject: `${group[0]!.line}:${other}`, message: `${file}:${group[0]!.line}-${group.at(-1)!.line} ${verb} code from ${other} (${scope.message})` };
    });
}

function mostCommon(paths: string[]): string {
  const counts = new Map<string, number>();
  for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
}

function changedPaths(change: Change): string[] {
  return change.files.flatMap(({ path, previousPath }) => [path, previousPath]);
}
