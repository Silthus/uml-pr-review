import type { PlannedModule, Seam } from "../contracts/index.ts";
import type { Change, FileImport } from "./change.ts";
import { type DraftFinding, draftOf, moduleSubject, seamSubject } from "./draft.ts";
import * as feedback from "./feedback.ts";
import { depthOf, isWithin, regionOf } from "./paths.ts";

export function importFindings(change: Change): DraftFinding[] {
  return [...change.addedImports().flatMap((imported) => addedImportFindings(change, imported)), ...unresolvedImportFindings(change)];
}

function addedImportFindings(change: Change, imported: FileImport): DraftFinding[] {
  const owner = change.owner(imported.file);
  if (!owner || isInternal(change, imported, owner)) return [];
  const matched = mostSpecific(change.plan.seams.filter((seam) => matches(seam, imported)));
  if (matched?.action === "remove") return [againstRemovedSeam(imported, matched)];
  if (matched) return offInterface(imported, matched);
  const bypassed = mostSpecific(change.plan.seams.filter((seam) => seam.action !== "remove" && isWithin(imported.file, seam.from) && isWithin(imported.target, regionOf(seam.from, seam.to))));
  if (bypassed) return [bypassesSeam(change, imported, bypassed)];
  return unplannedDependency(change, imported, owner);
}

function isInternal(change: Change, imported: FileImport, owner: PlannedModule): boolean {
  return isWithin(imported.target, owner.path) || change.leaf(imported.file) === change.leaf(imported.target);
}

function matches(seam: Seam, imported: FileImport): boolean {
  return isWithin(imported.file, seam.from) && isWithin(imported.target, seam.to);
}

function mostSpecific(seams: Seam[]): Seam | undefined {
  return seams.reduce<Seam | undefined>((best, seam) => (!best || isMoreSpecific(seam, best) ? seam : best), undefined);
}

function isMoreSpecific(seam: Seam, other: Seam): boolean {
  const byFrom = depthOf(seam.from) - depthOf(other.from);
  return byFrom > 0 || (byFrom === 0 && depthOf(seam.to) > depthOf(other.to));
}

function againstRemovedSeam(imported: FileImport, seam: Seam): DraftFinding {
  return importDraft(imported, "against-removed-seam", seamSubject(seam), feedback.againstRemovedSeam(imported, seam));
}

function offInterface(imported: FileImport, seam: Seam): DraftFinding[] {
  if (!seam.interface) return [];
  const { files, symbols } = seam.interface;
  if (!files.includes(imported.target)) return [importDraft(imported, "off-interface", seamSubject(seam), feedback.offInterfaceFile(imported, seam))];
  const outside = symbols.length === 0 ? [] : imported.names.filter((name) => !symbols.includes(name));
  if (outside.length === 0) return [];
  return [importDraft(imported, "off-interface", seamSubject(seam), feedback.offInterfaceSymbols(imported, outside, seam, symbols))];
}

function bypassesSeam(change: Change, imported: FileImport, seam: Seam): DraftFinding {
  const targetLeaf = change.leaf(imported.target) ?? imported.target;
  return importDraft(imported, "bypasses-seam", seamSubject(seam), feedback.bypassesSeam(imported, targetLeaf, seam, regionOf(seam.from, seam.to)));
}

function unplannedDependency(change: Change, imported: FileImport, owner: PlannedModule): DraftFinding[] {
  const targetLeaf = change.leaf(imported.target) ?? imported.target;
  const farEnd = change.farEnd(owner.path, targetLeaf);
  if (change.baseDependsOn(owner.path, farEnd)) return [];
  return [importDraft(imported, "unplanned-dependency", moduleSubject(owner.path), feedback.unplannedDependency(imported, owner.path, farEnd, targetLeaf, change.plan.status))];
}

function unresolvedImportFindings(change: Change): DraftFinding[] {
  return change.addedUnresolvedImports().flatMap((unresolved) => {
    const owner = change.owner(unresolved.file);
    if (!owner) return [];
    return [
      draftOf({
        rule: "unresolved-import",
        severity: "warning",
        file: unresolved.file,
        line: unresolved.line,
        subject: moduleSubject(owner.path),
        target: unresolved.specifier,
        test: change.isTest(unresolved.file),
        ...feedback.unresolvedImport(unresolved),
      }),
    ];
  });
}

function importDraft(imported: FileImport, rule: DraftFinding["rule"], subject: DraftFinding["subject"], text: feedback.Feedback): DraftFinding {
  return draftOf({ rule, severity: "violation", file: imported.file, line: imported.line, subject, target: imported.target, test: imported.test, ...text });
}
