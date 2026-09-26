import type { ArchitecturePlan, ChangedFile, PlannedModule, Seam } from "../contracts/index.ts";
import type { FileImport, ReconfiguredImport, UnresolvedImport } from "./change.ts";

export type Feedback = { message: string; fix: string };

type PlanStatus = ArchitecturePlan["status"];
type PlanEdit = { draft: string; operation: object; locked: string };

const changeVerbs: Record<ChangedFile["status"], string> = {
  added: "adds a file to",
  modified: "changes",
  deleted: "deletes a file from",
};

export function unplannedModule(first: ChangedFile, leaf: string, changedFiles: number, existsAtBase: boolean, status: PlanStatus): Feedback {
  return {
    message: `${at(first.path, first.firstChangedLine)} ${changeVerbs[first.status]} module ${code(leaf)}, which the plan does not touch (${counted(changedFiles, "changed file")} there).`,
    fix: `Revert the changes in ${code(leaf)}, or ${addModuleHint(leaf, existsAtBase, status)}.`,
  };
}

export function reconfiguredModule(first: ReconfiguredImport, leaf: string, reconfiguredImports: number, existsAtBase: boolean, status: PlanStatus): Feedback {
  return {
    message: `${at(first.file, first.line)} in module ${code(leaf)}, which the plan does not touch, now imports ${code(first.target)}: a new dependency on ${code(first.farEnd)} through a configuration change, not a source change (${counted(reconfiguredImports, "reconfigured import")} there).`,
    fix: `Revert the configuration change behind the import, or ${addModuleHint(leaf, existsAtBase, status)}.`,
  };
}

export function unplannedDependency(imported: FileImport, owner: string, farEnd: string, targetLeaf: string, status: PlanStatus): Feedback {
  return {
    message: unplannedDependencyMessage(imported, owner, farEnd),
    fix: `Remove the import, or ${planEditHint(status, {
      draft: "add it to the plan",
      operation: { op: "upsert_seam", from: owner, to: targetLeaf, action: "add" },
      locked: `add seam ${seamName({ from: owner, to: targetLeaf })}`,
    })}.`,
  };
}

export function unplannedDependencyOnEnclosingModule(imported: FileImport, owner: string, farEnd: string): Feedback {
  return {
    message: unplannedDependencyMessage(imported, owner, farEnd),
    fix: `Remove the import, or move ${code(imported.target)} into a module of its own so the plan can name the dependency.`,
  };
}

export function bypassesSeam(imported: FileImport, targetLeaf: string, seam: Seam, region: string): Feedback {
  return {
    message: `${at(imported.file, imported.line)} imports ${code(imported.target)} from ${code(targetLeaf)} directly, but the plan routes ${code(seam.from)} to ${code(region)} through ${code(seam.to)}.`,
    fix: `Import it through ${interfaceText(seam)} instead. If that interface does not offer it yet, add it there first.`,
  };
}

export function offInterfaceFile(imported: FileImport, seam: Seam): Feedback {
  return {
    message: `${at(imported.file, imported.line)} imports ${code(imported.target)}, which is not part of the interface of seam ${seamName(seam)}.`,
    fix: `Import from ${interfaceText(seam)} instead.`,
  };
}

export function offInterfaceSymbols(imported: FileImport, outside: string[], seam: Seam, symbols: string[]): Feedback {
  return {
    message: `${at(imported.file, imported.line)} imports ${code(outside.join(", "))} from ${code(imported.target)}, but seam ${seamName(seam)} allows only ${symbols.join(", ")}.`,
    fix: `Use ${symbols.join(", ")}, or expose what you need through ${interfaceText(seam)}.`,
  };
}

export function againstRemovedSeam(imported: FileImport, seam: Seam): Feedback {
  return {
    message: `${at(imported.file, imported.line)} imports ${code(imported.target)} along seam ${seamName(seam)}, which the plan removes.`,
    fix: `Remove this import; the plan takes ${code(seam.from)} off ${code(seam.to)}.`,
  };
}

export function seamNotRemoved(imported: FileImport, seam: Seam): Feedback {
  return {
    message: `${at(imported.file, imported.line)} still imports ${code(imported.target)} along seam ${seamName(seam)}, which the plan removes.`,
    fix: "Remove this import or route it the way the plan's other seams allow.",
  };
}

export function missingAddedSeam(seam: Seam, anchorFile: string): Feedback {
  return {
    message: `No file in ${code(seam.from)} imports ${interfaceText(seam)} yet; the plan adds seam ${seamName(seam)}.`,
    fix: `Import ${interfaceText(seam)} where ${code(seam.from)} needs it, for example in ${code(anchorFile)}.`,
  };
}

export function missingKeptSeam(seam: Seam, status: PlanStatus): Feedback {
  return {
    message: `No file in ${code(seam.from)} imports ${code(seam.to)} any more; the plan keeps seam ${seamName(seam)}.`,
    fix: `Restore an import of ${interfaceText(seam)} in ${code(seam.from)}, or ${planEditHint(status, {
      draft: "change the plan",
      operation: { op: "upsert_seam", from: seam.from, to: seam.to, action: "remove" },
      locked: `mark seam ${seamName(seam)} as removed`,
    })}.`,
  };
}

export function missingCreatedModule(module: PlannedModule): Feedback {
  return {
    message: `${code(module.path)} does not exist yet; the plan creates it to ${clauseOf(module.responsibility)}.`,
    fix: `Create ${code(module.path)} with its first source file.`,
  };
}

export function missingModifiedModule(module: PlannedModule, status: PlanStatus): Feedback {
  return {
    message: `${code(module.path)} is unchanged; the plan modifies it to ${clauseOf(module.responsibility)}.`,
    fix: `Make the planned change in ${code(module.path)}, or ${planEditHint(status, {
      draft: "change the plan",
      operation: { op: "drop_module", path: module.path },
      locked: `drop ${code(module.path)} from it`,
    })}.`,
  };
}

export function moduleNotRemoved(module: PlannedModule, remainingFiles: number): Feedback {
  return {
    message: `${code(module.path)} still holds ${counted(remainingFiles, "source file")}; the plan removes it.`,
    fix: `Delete the remaining files in ${code(module.path)} and move their importers as the plan's seams say.`,
  };
}

export function unresolvedImport(unresolved: UnresolvedImport): Feedback {
  return {
    message: `${at(unresolved.file, unresolved.line)} imports ${code(unresolved.specifier)}, which resolves to no file in the repository and no dependency.`,
    fix: "Fix the specifier, or create the file it names.",
  };
}

function unplannedDependencyMessage(imported: FileImport, owner: string, farEnd: string): string {
  return `${at(imported.file, imported.line)} imports ${code(imported.target)}: a new dependency from ${code(owner)} on ${code(farEnd)} that the plan does not name.`;
}

function seamName({ from, to }: Pick<Seam, "from" | "to">): string {
  return `${code(from)} -> ${code(to)}`;
}

function addModuleHint(leaf: string, existsAtBase: boolean, status: PlanStatus): string {
  return planEditHint(status, {
    draft: "add it to the plan",
    operation: { op: "upsert_module", path: leaf, action: existsAtBase ? "modify" : "create", responsibility: "…" },
    locked: `add ${code(leaf)} as a ${existsAtBase ? "modified" : "created"} module`,
  });
}

function planEditHint(status: PlanStatus, edit: PlanEdit): string {
  return status === "draft" ? `${edit.draft} with edit_plan: ${JSON.stringify(edit.operation)}` : `ask the human to unlock the plan and ${edit.locked}`;
}

function interfaceText(seam: Seam): string {
  if (!seam.interface) return `the interface ${code(seam.to)}`;
  const files = seam.interface.files.map(code).join(" or ");
  return seam.interface.symbols.length > 0 ? `${files} (symbols ${seam.interface.symbols.join(", ")})` : files;
}

function clauseOf(responsibility: string): string {
  const clause = responsibility.trim().replace(/[.\s]+$/, "");
  return /^[A-Z][a-z]/.test(clause) ? clause[0]!.toLowerCase() + clause.slice(1) : clause;
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function at(file: string, line: number): string {
  return `${file}:${line}`;
}

function code(text: string): string {
  return `\`${text}\``;
}
