import type { PlannedModule, Seam } from "../contracts/index.ts";
import type { Change, FileImport } from "./change.ts";
import { type DraftFinding, draftOf, moduleSubject, seamSubject } from "./draft.ts";
import * as feedback from "./feedback.ts";
import { isWithin } from "./paths.ts";
import { mostSpecific, mostSpecificMatch, regionOf } from "./seams.ts";

export function importFindings(change: Change): DraftFinding[] {
  return [...change.addedImports().flatMap((imported) => addedImportFindings(change, imported)), ...unresolvedImportFindings(change)];
}

function addedImportFindings(change: Change, imported: FileImport): DraftFinding[] {
  const owner = change.owner(imported.file);
  if (!owner || isInternal(change, imported, owner)) return [];
  const matched = mostSpecificMatch(change.plan.seams, imported);
  if (matched?.action === "remove") return [againstRemovedSeam(imported, matched)];
  if (matched) return offInterface(imported, matched);
  const bypassed = mostSpecific(change.plan.seams.filter((seam) => routesTowards(seam, imported)));
  if (bypassed) return [bypassesSeam(change, imported, bypassed)];
  return unplannedDependency(change, imported, owner);
}

function isInternal(change: Change, imported: FileImport, owner: PlannedModule): boolean {
  return isWithin(imported.target, owner.path) || change.leaf(imported.file) === change.leaf(imported.target);
}

function routesTowards(seam: Seam, imported: FileImport): boolean {
  return seam.action !== "remove" && isWithin(imported.file, seam.from) && isWithin(imported.target, regionOf(seam));
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
  return importDraft(imported, "bypasses-seam", seamSubject(seam), feedback.bypassesSeam(imported, change.targetLeaf(imported), seam, regionOf(seam)));
}

function unplannedDependency(change: Change, imported: FileImport, owner: PlannedModule): DraftFinding[] {
  const farEnd = change.newDependencyOn(owner.path, imported);
  if (farEnd === undefined) return [];
  const targetLeaf = change.targetLeaf(imported);
  const text = isWithin(owner.path, targetLeaf)
    ? feedback.unplannedDependencyOnEnclosingModule(imported, owner.path, farEnd)
    : feedback.unplannedDependency(imported, owner.path, farEnd, targetLeaf, change.plan.status);
  return [importDraft(imported, "unplanned-dependency", moduleSubject(owner.path), text)];
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
