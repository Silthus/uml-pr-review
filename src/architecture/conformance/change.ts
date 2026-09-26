import type { ArchitecturePayload, ArchitecturePlan, ChangedFile, PlannedModule, Seam } from "../contracts/index.ts";
import type { ArchitectureModel } from "../model/index.ts";
import { compare, depthOf, isWithin } from "./paths.ts";
import { mostSpecificMatch } from "./seams.ts";
import { counterpartImports, fileIndexOf, filesWithin, holds, type ImportTuple, importsFrom, type Range } from "./sorted-payload.ts";

export type Location = { file: string; line: number };
export type FileImport = { file: string; line: number; target: string; names: string[]; test: boolean };
export type UnresolvedImport = { file: string; line: number; specifier: string };

export class Change {
  readonly plan: ArchitecturePlan;
  readonly head: ArchitectureModel;
  readonly base: ArchitectureModel;
  readonly changes: ChangedFile[];
  readonly #ownersDeepestFirst: PlannedModule[];
  readonly #presentPaths: string[];
  readonly #seamImports = new Map<Seam, FileImport[]>();
  readonly #baseTargetsOf = new Map<string, string[]>();

  constructor({ plan, base, head, changes }: { plan: ArchitecturePlan; base: ArchitectureModel; head: ArchitectureModel; changes: ChangedFile[] }) {
    this.plan = plan;
    this.head = head;
    this.base = base;
    this.changes = [...changes].sort((a, b) => compare(a.path, b.path));
    this.#ownersDeepestFirst = [...plan.modules].sort((a, b) => depthOf(b.path) - depthOf(a.path));
    this.#presentPaths = this.changes.filter(({ status }) => status !== "deleted").map(({ path }) => path);
  }

  owner(file: string): PlannedModule | undefined {
    return this.#ownersDeepestFirst.find(({ path }) => isWithin(file, path));
  }

  leaf(file: string): string | undefined {
    return (this.head.moduleOfFile(file) ?? this.base.moduleOfFile(file))?.path;
  }

  isTest(file: string): boolean {
    return roleOf(this.head.payload, file) ?? roleOf(this.base.payload, file) ?? false;
  }

  headFilesWithin(path: string): string[] {
    const { start, end } = filesWithin(this.head.payload, path);
    return this.head.payload.files.slice(start, end).map(([file]) => file);
  }

  addedImports(): FileImport[] {
    const { payload } = this.head;
    const atBase = counterpartImports(payload, this.base.payload);
    return payload.imports.flatMap((tuple, index) => {
      const names = namesIfAdded(tuple[4], atBase[index]?.[4]);
      return names ? [{ ...fileImportOf(payload, tuple), names }] : [];
    });
  }

  addedUnresolvedImports(): UnresolvedImport[] {
    const present = new Set(this.#presentPaths);
    const atBase = new Set(unresolvedIn(this.base.payload, present).map(({ file, specifier }) => `${file}\n${specifier}`));
    return unresolvedIn(this.head.payload, present).filter(({ file, specifier }) => !atBase.has(`${file}\n${specifier}`));
  }

  seamImports(seam: Seam): FileImport[] {
    const cached = this.#seamImports.get(seam);
    if (cached) return cached;
    const { payload } = this.head;
    const targets = filesWithin(payload, seam.to);
    const along = tuplesFrom(payload, filesWithin(payload, seam.from))
      .filter(([, target]) => holds(targets, target))
      .map((tuple) => fileImportOf(payload, tuple))
      .filter((imported) => mostSpecificMatch(this.plan.seams, imported) === seam)
      .sort((a, b) => compare(a.file, b.file) || a.line - b.line || compare(a.target, b.target));
    this.#seamImports.set(seam, along);
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

  baseDependsOn(owner: string, farEnd: string, { includeTests }: { includeTests: boolean }): boolean {
    const targets = this.#baseTargetsLeaving(owner, includeTests);
    if (!isWithin(owner, farEnd)) return targets.some((target) => isWithin(target, farEnd));
    return targets.some((target) => this.base.moduleOfFile(target)?.path === farEnd);
  }

  anchorIn(path: string): Location {
    const file =
      this.#presentPaths.find((changed) => isWithin(changed, path) && !this.isTest(changed)) ??
      this.headFilesWithin(path).find((candidate) => !this.isTest(candidate));
    return file ? { file, line: this.head.lastImportLine(file) + 1 } : this.placeholderFor(path);
  }

  placeholderFor(path: string): Location {
    const interfaceFile = this.plan.seams.find(({ to, interface: planned }) => planned && isWithin(to, path))?.interface?.files[0];
    return { file: interfaceFile ?? `${path}/`, line: 1 };
  }

  #baseTargetsLeaving(owner: string, includeTests: boolean): string[] {
    const key = `${owner}\n${includeTests}`;
    const cached = this.#baseTargetsOf.get(key);
    if (cached) return cached;
    const { payload } = this.base;
    const inside = filesWithin(payload, owner);
    const targets = tuplesFrom(payload, inside)
      .filter(([source, target]) => !holds(inside, target) && (includeTests || payload.files[source]![3] === "production"))
      .map(([, target]) => payload.files[target]![0]);
    this.#baseTargetsOf.set(key, targets);
    return targets;
  }
}

function namesIfAdded(headNames: string[], baseNames: string[] | undefined): string[] | undefined {
  if (baseNames === undefined) return headNames;
  const gained = headNames.filter((name) => !baseNames.includes(name));
  return gained.length > 0 ? gained : undefined;
}

function tuplesFrom(payload: ArchitecturePayload, sources: Range): ImportTuple[] {
  const { start, end } = importsFrom(payload, sources);
  return payload.imports.slice(start, end);
}

function unresolvedIn(payload: ArchitecturePayload, paths: Set<string>): UnresolvedImport[] {
  return payload.unresolved.flatMap(([source, line, specifier]) => {
    const file = payload.files[source]![0];
    return paths.has(file) ? [{ file, line, specifier }] : [];
  });
}

function fileImportOf({ files }: ArchitecturePayload, [source, target, , line, names]: ImportTuple): FileImport {
  const [file, , , role] = files[source]!;
  return { file, line, target: files[target]![0], names, test: role === "test" };
}

function roleOf(payload: ArchitecturePayload, file: string): boolean | undefined {
  const index = fileIndexOf(payload, file);
  return index === undefined ? undefined : payload.files[index]![3] === "test";
}
