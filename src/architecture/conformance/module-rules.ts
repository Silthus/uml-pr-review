import type { ChangedFile, PlannedModule } from "../contracts/index.ts";
import type { Change, FileImport, Location } from "./change.ts";
import { type DraftFinding, draftOf, moduleSubject } from "./draft.ts";
import * as feedback from "./feedback.ts";
import { compare, isWithin } from "./paths.ts";

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
  const changedLeaves = unownedByLeaf(change, change.changes, ({ path }) => path);
  const reconfiguredLeaves = unownedByLeaf(change, change.addedImports(), ({ file }) => file);
  return [
    ...[...changedLeaves].map(([leaf, changed]) => changedModuleDraft(change, leaf, changed)),
    ...[...reconfiguredLeaves].filter(([leaf]) => !changedLeaves.has(leaf)).map(([leaf, imports]) => reconfiguredModuleDraft(change, leaf, imports)),
  ];
}

function changedModuleDraft(change: Change, leaf: string, changed: ChangedFile[]): DraftFinding {
  const first = changed.find(({ path }) => !change.isTest(path)) ?? changed[0]!;
  return draftOf({
    rule: "unplanned-module",
    severity: "violation",
    file: first.path,
    line: first.firstChangedLine,
    subject: moduleSubject(leaf),
    test: changed.every(({ path }) => change.isTest(path)),
    ...feedback.unplannedModule(first, leaf, changed.length, existsAtBase(change, leaf), change.plan.status),
  });
}

function reconfiguredModuleDraft(change: Change, leaf: string, imports: FileImport[]): DraftFinding {
  const first = [...imports].sort(byProductionThenLocation)[0]!;
  return draftOf({
    rule: "unplanned-module",
    severity: "violation",
    file: first.file,
    line: first.line,
    subject: moduleSubject(leaf),
    test: imports.every(({ test }) => test),
    ...feedback.reconfiguredModule(first, leaf, imports.length, existsAtBase(change, leaf), change.plan.status),
  });
}

function byProductionThenLocation(a: FileImport, b: FileImport): number {
  return Number(a.test) - Number(b.test) || compare(a.file, b.file) || a.line - b.line;
}

function existsAtBase(change: Change, leaf: string): boolean {
  return change.base.module(leaf) !== undefined;
}

function unownedByLeaf<T>(change: Change, items: T[], fileOf: (item: T) => string): Map<string, T[]> {
  const byLeaf = new Map<string, T[]>();
  for (const item of items) {
    const file = fileOf(item);
    const leaf = change.leaf(file);
    if (leaf === undefined || change.owner(file)) continue;
    const group = byLeaf.get(leaf);
    if (group) group.push(item);
    else byLeaf.set(leaf, [item]);
  }
  return byLeaf;
}
