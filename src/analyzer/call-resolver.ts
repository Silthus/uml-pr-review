import type { ModuleResolver } from "./modules.ts";
import { isContainer, isTestStructure, type CallSite, type ExtractedSymbol, type ImportBinding, type SourceFile } from "./source-file.ts";

type Target = { path: string; qualifiedName: string | null };

export const commonNames: ReadonlySet<string> = new Set(
  (
    "get set add all any has map len str int list dict tuple bool type super print range filter format join split strip " +
    "keys items values append extend update pop remove create delete save call apply bind then catch find push slice " +
    "sort next open close read write run start stop init main test setup reset clear copy parse render emit send " +
    "log info warn error debug exists count first last value data name id key self cls this default constructor " +
    "toString valueOf isinstance getattr setattr hasattr require describe it expect assert"
  ).split(" "),
);

export class CallResolver {
  private readonly indexes = new Map<string, Map<string, ExtractedSymbol>>();

  constructor(
    private readonly modules: ModuleResolver,
    private readonly files: ReadonlyMap<string, SourceFile>,
  ) {}

  filesNeededFor(file: SourceFile, calls: CallSite[]): string[] {
    const needed = new Set<string>();
    for (const call of calls) {
      const binding = this.bindingFor(file, call.receiver.kind === "name" ? call.receiver.name : call.name);
      if (call.receiver.kind === "self" || call.receiver.kind === "other" || !binding) continue;
      for (const target of this.bindingTargets(file, binding)) needed.add(target.path);
    }
    return [...needed].filter((path) => !this.files.has(path));
  }

  resolve(file: SourceFile, call: CallSite): ExtractedSymbol | null {
    if (call.receiver.kind === "self") return this.resolveOnOwnContainer(file, call);
    if (call.receiver.kind === "name") {
      return this.resolveMember(file, call.receiver.name, call.name) ?? this.resolveOnImportedClass(file, call.name);
    }
    if (call.receiver.kind === "other") return this.resolveOnImportedClass(file, call.name);
    return this.resolveBareName(file, call.name);
  }

  private resolveBareName(file: SourceFile, name: string): ExtractedSymbol | null {
    const local = this.lookup(file.path, name);
    if (local && !local.parentId) return local;
    const binding = this.bindingFor(file, name);
    if (!binding) return null;
    for (const target of this.bindingTargets(file, binding)) {
      const found = this.lookup(target.path, target.qualifiedName ?? name);
      if (found) return found;
    }
    return null;
  }

  private resolveOnOwnContainer(file: SourceFile, call: CallSite): ExtractedSymbol | null {
    const symbolById = (id: string | undefined) => file.symbols.find((symbol) => symbol.id === id);
    let container = symbolById(call.ownerId);
    while (container && !isContainer(container)) container = symbolById(container.parentId);
    return container ? this.lookup(file.path, `${container.qualifiedName}.${call.name}`) : null;
  }

  private resolveMember(file: SourceFile, receiver: string, name: string): ExtractedSymbol | null {
    const local = this.lookup(file.path, receiver);
    if (local) return this.lookup(file.path, `${receiver}.${name}`);
    const binding = this.bindingFor(file, receiver);
    if (!binding) return null;
    for (const target of this.bindingTargets(file, binding)) {
      const found = this.lookup(target.path, target.qualifiedName ? `${target.qualifiedName}.${name}` : name);
      if (found) return found;
    }
    return null;
  }

  private resolveOnImportedClass(file: SourceFile, name: string): ExtractedSymbol | null {
    if (commonNames.has(name) || name.startsWith("__")) return null;
    const candidates = new Set<ExtractedSymbol>();
    for (const binding of file.imports) {
      for (const target of this.bindingTargets(file, binding)) {
        const owner = target.qualifiedName && this.lookup(target.path, target.qualifiedName);
        const method = owner && isContainer(owner) ? this.lookup(target.path, `${owner.qualifiedName}.${name}`) : null;
        if (method) candidates.add(method);
      }
    }
    return candidates.size === 1 ? [...candidates][0]! : null;
  }

  private bindingFor(file: SourceFile, local: string): ImportBinding | undefined {
    return file.imports.find((binding) => binding.local === local);
  }

  private bindingTargets(file: SourceFile, binding: ImportBinding): Target[] {
    const targets: Target[] = [];
    const modulePath = this.modules.resolve(file.path, file.language, binding.module);
    const importedName = binding.imported === "default" ? binding.local : binding.imported;
    if (modulePath) targets.push({ path: modulePath, qualifiedName: importedName });
    if (file.language === "python" && binding.imported) {
      const separator = binding.module.endsWith(".") ? "" : ".";
      const submodule = this.modules.resolve(file.path, file.language, `${binding.module}${separator}${binding.imported}`);
      if (submodule) targets.push({ path: submodule, qualifiedName: null });
    }
    return targets;
  }

  private lookup(path: string, qualifiedName: string): ExtractedSymbol | null {
    return this.indexOf(path).get(qualifiedName) ?? null;
  }

  private indexOf(path: string): Map<string, ExtractedSymbol> {
    let index = this.indexes.get(path);
    if (!index) {
      index = new Map();
      for (const symbol of this.files.get(path)?.symbols ?? []) {
        if (!isTestStructure(symbol.kind) && !index.has(symbol.qualifiedName)) index.set(symbol.qualifiedName, symbol);
      }
      if (this.files.has(path)) this.indexes.set(path, index);
    }
    return index;
  }
}
