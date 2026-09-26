import type { ChangedFile, PlannedModule } from "../contracts/index.ts";
import type { Change, FileImport, Location, ReconfiguredImport } from "./change.ts";
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

type Evidence = Location & feedback.Feedback;

function unplannedModuleFindings(change: Change): DraftFinding[] {
  const changedByLeaf = unownedByLeaf(change, change.changes, ({ path }) => path);
  const reconfiguredByLeaf = reconfiguredDependenciesByLeaf(change);
  const leaves = new Set([...changedByLeaf.keys(), ...reconfiguredByLeaf.keys()]);
  return [...leaves].map((leaf) => unplannedModuleDraft(change, leaf, changedByLeaf.get(leaf) ?? [], reconfiguredByLeaf.get(leaf) ?? []));
}

function unplannedModuleDraft(change: Change, leaf: string, changed: ChangedFile[], reconfigured: ReconfiguredImport[]): DraftFinding {
  const test = changed.every(({ path }) => change.isTest(path)) && reconfigured.every(({ test: fromTest }) => fromTest);
  const changedFile = changed.find(({ path }) => test || !change.isTest(path));
  const evidence = changedFile ? sourceChangeEvidence(change, leaf, changedFile, changed.length) : reconfigurationEvidence(change, leaf, reconfigured);
  return draftOf({ rule: "unplanned-module", severity: "violation", subject: moduleSubject(leaf), test, ...evidence });
}

function sourceChangeEvidence(change: Change, leaf: string, first: ChangedFile, changedFiles: number): Evidence {
  return {
    file: first.path,
    line: first.firstChangedLine,
    ...feedback.unplannedModule(first, leaf, changedFiles, existsAtBase(change, leaf), change.plan.status),
  };
}

function reconfigurationEvidence(change: Change, leaf: string, reconfigured: ReconfiguredImport[]): Evidence {
  const first = reconfigured.reduce((earliest, candidate) => (byProductionThenLocation(candidate, earliest) < 0 ? candidate : earliest));
  return {
    file: first.file,
    line: first.line,
    ...feedback.reconfiguredModule(first, leaf, reconfigured.length, existsAtBase(change, leaf), change.plan.status),
  };
}

function reconfiguredDependenciesByLeaf(change: Change): Map<string, ReconfiguredImport[]> {
  const byLeaf = new Map<string, ReconfiguredImport[]>();
  for (const [leaf, imports] of unownedByLeaf(change, importsNoSourceChangeExplains(change), ({ file }) => file)) {
    const dependencies = newDependenciesOf(change, leaf, imports);
    if (dependencies.length > 0) byLeaf.set(leaf, dependencies);
  }
  return byLeaf;
}

function importsNoSourceChangeExplains(change: Change): FileImport[] {
  const changedFiles = new Set(change.changes.map(({ path }) => path));
  const addedFiles = new Set(change.changes.filter(({ status }) => status === "added").map(({ path }) => path));
  return change.addedImports().filter(({ file, target }) => !changedFiles.has(file) && !addedFiles.has(target));
}

function newDependenciesOf(change: Change, leaf: string, imports: FileImport[]): ReconfiguredImport[] {
  return imports.flatMap((imported) => {
    if (isWithin(imported.target, leaf)) return [];
    const farEnd = change.newDependencyOn(leaf, imported);
    return farEnd === undefined ? [] : [{ ...imported, farEnd }];
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
