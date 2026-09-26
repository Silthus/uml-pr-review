import type { ArchitecturePayload, ArchitecturePlan, ChangedFile, PlannedModule, Seam } from "../contracts/index.ts";
import type { ArchitectureModel } from "../model/index.ts";
import { compare, depthOf, isWithin } from "./paths.ts";

export type Location = { file: string; line: number };
export type FileImport = { file: string; line: number; target: string; names: string[]; test: boolean };
export type UnresolvedImport = { file: string; line: number; specifier: string };

export class Change {
  readonly plan: ArchitecturePlan;
  readonly head: ArchitectureModel;
  readonly changes: ChangedFile[];
  readonly #base: ArchitectureModel;
  readonly #ownersDeepestFirst: PlannedModule[];
  readonly #changedPaths: Set<string>;
  readonly #headRoles: Map<string, boolean>;
  readonly #baseRoles: Map<string, boolean>;
  readonly #importsAlong = new Map<string, FileImport[]>();
  readonly #baseTargetsOf = new Map<string, string[]>();

  constructor({ plan, base, head, changes }: { plan: ArchitecturePlan; base: ArchitectureModel; head: ArchitectureModel; changes: ChangedFile[] }) {
    this.plan = plan;
    this.head = head;
    this.#base = base;
    this.changes = [...changes].sort((a, b) => compare(a.path, b.path));
    this.#ownersDeepestFirst = [...plan.modules].sort((a, b) => depthOf(b.path) - depthOf(a.path));
    this.#changedPaths = new Set(changes.filter(({ status }) => status !== "deleted").map(({ path }) => path));
    this.#headRoles = testRolesOf(head.payload);
    this.#baseRoles = testRolesOf(base.payload);
  }

  owner(file: string): PlannedModule | undefined {
    return this.#ownersDeepestFirst.find(({ path }) => isWithin(file, path));
  }

  leaf(file: string): string | undefined {
    return (this.head.moduleOfFile(file) ?? this.#base.moduleOfFile(file))?.path;
  }

  isTest(file: string): boolean {
    return this.#headRoles.get(file) ?? this.#baseRoles.get(file) ?? false;
  }

  headFilesWithin(path: string): string[] {
    return this.head.payload.files.flatMap(([file]) => (isWithin(file, path) ? [file] : []));
  }

  addedImports(): FileImport[] {
    const basePairs = new Set(importsFrom(this.#base.payload, this.#changedPaths).map(({ file, target }) => pairKey(file, target)));
    return importsFrom(this.head.payload, this.#changedPaths).filter(({ file, target }) => !basePairs.has(pairKey(file, target)));
  }

  addedUnresolvedImports(): UnresolvedImport[] {
    const baseEntries = new Set(unresolvedFrom(this.#base.payload, this.#changedPaths).map(({ file, specifier }) => pairKey(file, specifier)));
    return unresolvedFrom(this.head.payload, this.#changedPaths).filter(({ file, specifier }) => !baseEntries.has(pairKey(file, specifier)));
  }

  importsAlong({ from, to }: Pick<Seam, "from" | "to">): FileImport[] {
    const key = pairKey(from, to);
    const cached = this.#importsAlong.get(key);
    if (cached) return cached;
    const { files, imports } = this.head.payload;
    const sources = files.map(([file]) => isWithin(file, from));
    const targets = files.map(([file]) => isWithin(file, to));
    const along = imports
      .filter(([source, target]) => sources[source] && targets[target])
      .map((tuple) => fileImportOf(this.head.payload, tuple))
      .sort((a, b) => compare(a.file, b.file) || a.line - b.line || compare(a.target, b.target));
    this.#importsAlong.set(key, along);
    return along;
  }

  farEnd(owner: string, targetLeaf: string): string {
    let child = targetLeaf;
    for (let ancestor: string | null = targetLeaf; ancestor !== null; ancestor = this.head.module(ancestor)?.parent ?? null) {
      if (isWithin(owner, ancestor)) return child;
      child = ancestor;
    }
    return child;
  }

  baseDependsOn(owner: string, farEnd: string): boolean {
    return this.#baseTargetsLeaving(owner).some((target) => isWithin(target, farEnd));
  }

  anchorIn(path: string): Location {
    const file =
      this.changes.find(({ path: changed, status }) => status !== "deleted" && isWithin(changed, path) && !this.isTest(changed))?.path ??
      this.headFilesWithin(path).find((candidate) => !this.isTest(candidate));
    return file ? { file, line: this.head.lastImportLine(file) + 1 } : this.placeholderFor(path);
  }

  placeholderFor(path: string): Location {
    const interfaceFile = this.plan.seams.find(({ to, interface: planned }) => planned && isWithin(to, path))?.interface?.files[0];
    return { file: interfaceFile ?? `${path}/`, line: 1 };
  }

  #baseTargetsLeaving(owner: string): string[] {
    const cached = this.#baseTargetsOf.get(owner);
    if (cached) return cached;
    const { files, imports } = this.#base.payload;
    const inside = files.map(([file]) => isWithin(file, owner));
    const targets = imports.flatMap(([source, target]) => (inside[source] && !inside[target] ? [files[target]![0]] : []));
    this.#baseTargetsOf.set(owner, targets);
    return targets;
  }
}

function importsFrom(payload: ArchitecturePayload, paths: Set<string>): FileImport[] {
  const sources = payload.files.map(([file]) => paths.has(file));
  return payload.imports.filter(([source]) => sources[source]).map((tuple) => fileImportOf(payload, tuple));
}

function unresolvedFrom(payload: ArchitecturePayload, paths: Set<string>): UnresolvedImport[] {
  return payload.unresolved.flatMap(([source, line, specifier]) => {
    const file = payload.files[source]![0];
    return paths.has(file) ? [{ file, line, specifier }] : [];
  });
}

function fileImportOf({ files }: ArchitecturePayload, [source, target, , line, names]: ArchitecturePayload["imports"][number]): FileImport {
  const [file, , , role] = files[source]!;
  return { file, line, target: files[target]![0], names, test: role === "test" };
}

function testRolesOf({ files }: ArchitecturePayload): Map<string, boolean> {
  return new Map(files.map(([file, , , role]) => [file, role === "test"]));
}

function pairKey(a: string, b: string): string {
  return `${a}\n${b}`;
}
