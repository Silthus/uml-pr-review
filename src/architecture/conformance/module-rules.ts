import type { ChangedFile, PlannedModule } from "../contracts/index.ts";
import type { Change, Location } from "./change.ts";
import { type DraftFinding, draftOf, moduleSubject } from "./draft.ts";
import * as feedback from "./feedback.ts";
import { isWithin } from "./paths.ts";

export function moduleFindings(change: Change): DraftFinding[] {
  return [...change.plan.modules.flatMap((module) => plannedModuleFindings(change, module)), ...unplannedModuleFindings(change)];
}

function plannedModuleFindings(change: Change, module: PlannedModule): DraftFinding[] {
  const files = change.headFilesWithin(module.path);
  switch (module.action) {
    case "create":
      if (files.length > 0) return [];
      return [plannedDraft(change, "missing-module", module, change.placeholderFor(module.path), feedback.missingCreatedModule(module))];
    case "modify":
      if (change.changes.some(({ path }) => isWithin(path, module.path))) return [];
      return [plannedDraft(change, "missing-module", module, firstFileOf(change, files, module.path), feedback.missingModifiedModule(module, change.plan.status))];
    case "remove":
      if (files.length === 0) return [];
      return [plannedDraft(change, "module-not-removed", module, firstFileOf(change, files, module.path), feedback.moduleNotRemoved(module, files.length))];
  }
}

function firstFileOf(change: Change, files: string[], path: string): Location {
  const file = files.find((candidate) => !change.isTest(candidate)) ?? files[0];
  return file ? { file, line: 1 } : change.placeholderFor(path);
}

function plannedDraft(change: Change, rule: DraftFinding["rule"], module: PlannedModule, location: Location, text: feedback.Feedback): DraftFinding {
  return draftOf({ rule, severity: "planned", ...location, subject: moduleSubject(module.path), test: change.isTest(location.file), ...text });
}

function unplannedModuleFindings(change: Change): DraftFinding[] {
  return [...unownedChangesByLeaf(change)].map(([leaf, changed]) => {
    const first = changed.find(({ path }) => !change.isTest(path)) ?? changed[0]!;
    return draftOf({
      rule: "unplanned-module",
      severity: "violation",
      file: first.path,
      line: first.firstChangedLine,
      subject: moduleSubject(leaf),
      test: changed.every(({ path }) => change.isTest(path)),
      ...feedback.unplannedModule(first, leaf, changed.length, change.base.module(leaf) !== undefined, change.plan.status),
    });
  });
}

function unownedChangesByLeaf(change: Change): Map<string, ChangedFile[]> {
  const byLeaf = new Map<string, ChangedFile[]>();
  for (const changed of change.changes) {
    const leaf = change.leaf(changed.path);
    if (leaf === undefined || change.owner(changed.path)) continue;
    const group = byLeaf.get(leaf);
    if (group) group.push(changed);
    else byLeaf.set(leaf, [changed]);
  }
  return byLeaf;
}
