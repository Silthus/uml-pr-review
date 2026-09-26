import type {
  ArchitecturePayload,
  Dependency,
  FarDependency,
  ImportEvidence,
  ModuleView,
  SearchHit,
} from "../contracts/index.ts";

export type TestOptions = { includeTests?: boolean };

type Direction = "out" | "in";

const viaLimit = 5;
const filesPerSearchHit = 3;
const searchRanks = { exactLabel: 0, labelPrefix: 1, basename: 2, path: 3, files: 4 } as const;

export class ArchitectureModel {
  readonly payload: ArchitecturePayload;
  readonly #paths: string[];
  readonly #moduleIndex: Map<string, number>;
  readonly #fileIndex: Map<string, number>;
  readonly #parents: Int32Array;
  readonly #children: number[][];
  readonly #fileModule: Int32Array;
  readonly #importFromModule: Int32Array;
  readonly #importToModule: Int32Array;
  readonly #importFromTest: Uint8Array;
  readonly #importTouchesTest: Uint8Array;
  readonly #holdsProduction: Uint8Array;
  readonly #lastImportLine: Int32Array;
  readonly #views = new Map<number, ModuleView>();

  constructor(payload: ArchitecturePayload) {
    const { modules, files, imports } = payload;
    this.payload = payload;
    this.#paths = modules.map(([path]) => path);
    this.#moduleIndex = new Map(this.#paths.map((path, index) => [path, index]));
    this.#fileIndex = new Map(files.map(([path], index) => [path, index]));
    this.#parents = Int32Array.from(modules, ([, , parent]) => parent);
    this.#children = childrenOf(this.#parents);
    this.#fileModule = Int32Array.from(files, ([, module]) => module);
    this.#importFromModule = Int32Array.from(imports, ([from]) => this.#fileModule[from]!);
    this.#importToModule = Int32Array.from(imports, ([, to]) => this.#fileModule[to]!);
    this.#importFromTest = Uint8Array.from(imports, ([from]) => Number(this.#isTestFile(from)));
    this.#importTouchesTest = Uint8Array.from(imports, ([from, to]) => Number(this.#isTestFile(from) || this.#isTestFile(to)));
    this.#holdsProduction = this.#modulesHoldingProduction();
    this.#lastImportLine = this.#lastImportLines();
  }

  module(path: string): ModuleView | undefined {
    const index = this.#moduleIndex.get(path);
    return index === undefined ? undefined : this.#view(index);
  }

  moduleOfFile(file: string): ModuleView | undefined {
    const index = this.#fileIndex.get(file);
    return index === undefined ? undefined : this.#view(this.#fileModule[index]!);
  }

  hasFile(file: string): boolean {
    return this.#fileIndex.has(file);
  }

  children(path: string): ModuleView[] {
    const index = this.#moduleIndex.get(path);
    return index === undefined ? [] : this.#children[index]!.map((child) => this.#view(child));
  }

  lift(expanded: ReadonlySet<string>, { includeTests = false }: TestOptions = {}): { modules: ModuleView[]; dependencies: Dependency[] } {
    const visible = this.#visibleAncestors(expanded);
    const moduleCount = this.#paths.length;
    const counts = new Map<number, number>();
    for (let index = 0; index < this.#importFromModule.length; index++) {
      if (!includeTests && this.#importTouchesTest[index]) continue;
      const from = visible[this.#importFromModule[index]!]!;
      const to = visible[this.#importToModule[index]!]!;
      if (from === to) continue;
      const key = from * moduleCount + to;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      modules: this.#paths.flatMap((_, module) => (visible[module] === module && this.#shows(module, includeTests) ? [this.#view(module)] : [])),
      dependencies: [...counts]
        .sort(([a], [b]) => a - b)
        .map(([key, imports]) => ({ from: this.#paths[Math.floor(key / moduleCount)]!, to: this.#paths[key % moduleCount]!, imports })),
    };
  }

  dependencies(path: string, direction: Direction, { includeTests = false }: TestOptions = {}): FarDependency[] {
    const inside = this.#filesWithin(path);
    const farEnds = new Map<number, number>();
    const groups = new Map<number, Map<number, number>>();
    this.payload.imports.forEach(([from, to], index) => {
      if (!includeTests && this.#importFromTest[index]) return;
      const [near, far] = direction === "out" ? [from, to] : [to, from];
      if (!inside[near] || inside[far]) return;
      const leaf = this.#fileModule[far]!;
      const farEnd = farEnds.get(leaf) ?? this.#farEnd(path, leaf);
      farEnds.set(leaf, farEnd);
      const leaves = groups.get(farEnd) ?? new Map<number, number>();
      leaves.set(leaf, (leaves.get(leaf) ?? 0) + 1);
      groups.set(farEnd, leaves);
    });
    return [...groups]
      .map(([farEnd, leaves]) => ({
        module: this.#paths[farEnd]!,
        imports: sum(leaves.values()),
        via: byImportsThenModule([...leaves].map(([leaf, imports]) => ({ module: this.#paths[leaf]!, imports }))).slice(0, viaLimit),
      }))
      .sort((a, b) => b.imports - a.imports || compare(a.module, b.module));
  }

  evidence(from: string, to: string, { includeTests = false, limit = 20 }: TestOptions & { limit?: number } = {}): ImportEvidence[] {
    const sources = this.#filesWithin(from);
    const targets = this.#filesWithin(to);
    const { files, imports } = this.payload;
    return imports
      .flatMap(([source, target, kind, line, names], index): ImportEvidence[] => {
        const test = this.#importFromTest[index] === 1;
        if (!sources[source] || !targets[target] || (test && !includeTests)) return [];
        return [{ file: files[source]![0], line, target: files[target]![0], kind, names, test }];
      })
      .sort((a, b) => compare(a.file, b.file) || a.line - b.line || compare(a.target, b.target))
      .slice(0, limit);
  }

  lastImportLine(file: string): number {
    const index = this.#fileIndex.get(file);
    return index === undefined ? 0 : this.#lastImportLine[index]!;
  }

  search(query: string, limit = 20): SearchHit[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const matches = (text: string) => tokens.every((token) => text.includes(token));
    const moduleHits = this.#paths.flatMap((path, module) =>
      matches(path.toLowerCase()) ? [{ module, rank: this.#searchRank(module, tokens), files: [] as string[] }] : [],
    );
    const hitModules = new Set(moduleHits.map(({ module }) => module));
    const fileHits = new Map<number, string[]>();
    for (const [file, module] of this.payload.files) {
      const files = fileHits.get(module) ?? [];
      if (hitModules.has(module) || files.length === filesPerSearchHit || !matches(file.toLowerCase())) continue;
      fileHits.set(module, [...files, file]);
    }
    return [...moduleHits, ...[...fileHits].map(([module, files]) => ({ module, rank: searchRanks.files, files }))]
      .sort((a, b) => a.rank - b.rank || compare(this.#paths[a.module]!, this.#paths[b.module]!))
      .slice(0, limit)
      .map(({ module, files }) => ({ module: this.#view(module), files }));
  }

  #searchRank(module: number, tokens: string[]): number {
    const phrase = tokens.join(" ");
    const label = this.payload.modules[module]![1].toLowerCase();
    const path = this.#paths[module]!.toLowerCase();
    const basename = path.slice(path.lastIndexOf("/") + 1);
    if (label === phrase) return searchRanks.exactLabel;
    if (label.startsWith(phrase)) return searchRanks.labelPrefix;
    if (tokens.every((token) => basename.includes(token))) return searchRanks.basename;
    return searchRanks.path;
  }

  #shows(module: number, includeTests: boolean): boolean {
    return includeTests || this.#parents[module] === -1 || this.#holdsProduction[module] === 1;
  }

  #view(module: number): ModuleView {
    const cached = this.#views.get(module);
    if (cached) return cached;
    const [path, label, parent, kind, directFiles, totalFiles] = this.payload.modules[module]!;
    const view = Object.freeze({ path, label, kind, parent: parent === -1 ? null : this.#paths[parent]!, childCount: this.#children[module]!.length, directFiles, totalFiles });
    this.#views.set(module, view);
    return view;
  }

  #visibleAncestors(expanded: ReadonlySet<string>): Int32Array {
    const visible = new Int32Array(this.#paths.length);
    for (let module = 0; module < visible.length; module++) {
      const parent = this.#parents[module]!;
      const parentOpen = parent === -1 || (visible[parent] === parent && (this.#parents[parent] === -1 || expanded.has(this.#paths[parent]!)));
      visible[module] = parentOpen ? module : visible[parent]!;
    }
    return visible;
  }

  #farEnd(path: string, leaf: number): number {
    let child = leaf;
    for (let ancestor = leaf; ancestor !== -1; ancestor = this.#parents[ancestor]!) {
      const ancestorPath = this.#paths[ancestor]!;
      if (path === ancestorPath || isWithin(path, ancestorPath)) return child;
      child = ancestor;
    }
    return child;
  }

  #filesWithin(path: string): Uint8Array {
    return Uint8Array.from(this.payload.files, ([file]) => Number(isWithin(file, path)));
  }

  #isTestFile(file: number): boolean {
    return this.payload.files[file]![3] === "test";
  }

  #modulesHoldingProduction(): Uint8Array {
    const holds = new Uint8Array(this.#paths.length);
    this.payload.files.forEach(([, module], file) => {
      if (this.#isTestFile(file)) return;
      for (let ancestor = module; ancestor !== -1 && !holds[ancestor]; ancestor = this.#parents[ancestor]!) holds[ancestor] = 1;
    });
    return holds;
  }

  #lastImportLines(): Int32Array {
    const lines = new Int32Array(this.payload.files.length);
    const record = (file: number, line: number) => (lines[file] = Math.max(lines[file]!, line));
    for (const [file, , , line] of this.payload.imports) record(file, line);
    for (const [file, line] of this.payload.unresolved) record(file, line);
    return lines;
  }
}

function childrenOf(parents: Int32Array): number[][] {
  const children = Array.from(parents, (): number[] => []);
  parents.forEach((parent, module) => {
    if (parent !== -1) children[parent]!.push(module);
  });
  return children;
}

function isWithin(path: string, module: string): boolean {
  return module === "." || path.startsWith(`${module}/`);
}

function byImportsThenModule<T extends { module: string; imports: number }>(entries: T[]): T[] {
  return entries.sort((a, b) => b.imports - a.imports || compare(a.module, b.module));
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
