import type { ChangedFile, PlannedModule } from "../contracts/index.ts";
import type { Change } from "./change.ts";
import { type DraftFinding, draftOf, moduleSubject } from "./draft.ts";
import * as feedback from "./feedback.ts";
import { isWithin } from "./paths.ts";

export function moduleFindings(change: Change): DraftFinding[] {
  return [...change.plan.modules.flatMap((module) => plannedModuleFindings(change, module)), ...unplannedModuleFindings(change)];
}

function plannedModuleFindings(change: Change, module: PlannedModule): DraftFinding[] {
  const files = change.headFilesWithin(module.path);
  const status = change.plan.status;
  switch (module.action) {
    case "create":
      return files.length > 0 ? [] : [plannedDraft(module, change.placeholderFor(module.path), feedback.missingCreatedModule(module))];
    case "modify":
      return change.changes.some(({ path }) => isWithin(path, module.path))
        ? []
        : [plannedDraft(module, firstFileOf(change, files, module.path), feedback.missingModifiedModule(module, status))];
    case "remove":
      return files.length === 0 ? [] : [plannedDraft(module, { file: files[0]!, line: 1 }, feedback.moduleNotRemoved(module, files.length), "module-not-removed")];
  }
}

function firstFileOf(change: Change, files: string[], path: string) {
  const file = files.find((candidate) => !change.isTest(candidate)) ?? files[0];
  return file ? { file, line: 1 } : change.placeholderFor(path);
}

function plannedDraft(module: PlannedModule, location: { file: string; line: number }, text: feedback.Feedback, rule: DraftFinding["rule"] = "missing-module"): DraftFinding {
  return draftOf({ rule, severity: "planned", ...location, subject: moduleSubject(module.path), ...text });
}

function unplannedModuleFindings(change: Change): DraftFinding[] {
  const unowned = new Map<string, ChangedFile[]>();
  for (const changed of change.changes) {
    const leaf = change.leaf(changed.path);
    if (leaf === undefined || change.owner(changed.path)) continue;
    unowned.set(leaf, [...(unowned.get(leaf) ?? []), changed]);
  }
  return [...unowned].map(([leaf, changed]) => {
    const first = changed.find(({ path }) => !change.isTest(path)) ?? changed[0]!;
    return draftOf({
      rule: "unplanned-module",
      severity: "violation",
      file: first.path,
      line: first.firstChangedLine,
      subject: moduleSubject(leaf),
      test: changed.every(({ path }) => change.isTest(path)),
      ...feedback.unplannedModule(first, leaf, changed.length, change.plan.status),
    });
  });
}
