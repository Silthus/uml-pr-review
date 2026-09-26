import { posix } from "node:path";

export type ModuleKind =
  | "root"
  | "product"
  | "package"
  | "django-app"
  | "scene"
  | "layer"
  | "tests"
  | "migrations"
  | "generated"
  | "python-package"
  | "directory";

export type Language = "python" | "typescript" | "javascript" | "rust";

export type Module = {
  id: string;
  label: string;
  parent: number | null;
  kind: ModuleKind;
  children: number[];
  directFiles: number;
  totalFiles: number;
  languages: Partial<Record<Language, number>>;
};

const kindPriority: ModuleKind[] = [
  "root",
  "product",
  "package",
  "layer",
  "django-app",
  "scene",
  "tests",
  "migrations",
  "generated",
  "python-package",
  "directory",
];
const genericLayoutNames = new Set(["src", "lib", "tests", "test", "__tests__", "scripts", "components", "hooks", "stores", "utils", "types"]);
const manifestNames = new Set(["package.json", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod"]);

export function languageOfPath(path: string): Language | null {
  if (/\.d\.[mc]?ts$/.test(path)) return null;
  if (/\.pyi?$/.test(path)) return "python";
  if (/\.[mc]?tsx?$/.test(path)) return "typescript";
  if (/\.[mc]?jsx?$/.test(path)) return "javascript";
  if (/\.rs$/.test(path)) return "rust";
  return null;
}

export function isTreeSource(path: string): boolean {
  return languageOfPath(path) !== null && !/(^|\/)(\.[^/]+|node_modules)\//.test(path);
}

type RawDir = { path: string; children: Set<string>; files: string[] };

export class ModuleTree {
  readonly modules: Module[] = [];
  private readonly moduleOfDir = new Map<string, number>();

  constructor(allPaths: string[]) {
    const sources = allPaths.filter(isTreeSource);
    const raw = rawDirectories(sources);
    const kinds = classify(raw, new Set(allPaths));
    this.build(raw, kinds, ".", null, ".");
    for (const path of sources) this.count(path);
  }

  moduleOf(path: string): number {
    for (let dir = posix.dirname(path); ; dir = posix.dirname(dir)) {
      const module = this.moduleOfDir.get(dir);
      if (module !== undefined) return module;
      if (dir === ".") return 0;
    }
  }

  ancestry(module: number): number[] {
    const chain: number[] = [];
    for (let current: number | null = module; current !== null; current = this.modules[current]!.parent) chain.push(current);
    return chain.reverse();
  }

  private build(
    raw: Map<string, RawDir>,
    kinds: Map<string, ModuleKind>,
    path: string,
    parent: number | null,
    labelBase: string,
    inheritedKind: ModuleKind | null = null,
    compressed: string[] = [],
  ): void {
    const dir = raw.get(path)!;
    const kind = strongest(inheritedKind, kinds.get(path) ?? "directory");
    const [only] = dir.children;
    if (parent !== null && dir.files.length === 0 && dir.children.size === 1 && posix.basename(only!) !== "src") {
      return this.build(raw, kinds, only!, parent, labelBase, kind, [...compressed, path]);
    }
    const label = parent === null ? "." : labelBase === "." ? path : path.slice(labelBase.length + 1);
    const index = this.addModule(path, parent, kind, label);
    const transparent = parent === null ? null : transparentSourceRoot(raw, dir);
    for (const dirPath of [...compressed, path, ...(transparent ? [transparent.path] : [])]) this.moduleOfDir.set(dirPath, index);
    const children = transparent ? [...dir.children].filter((child) => child !== transparent.path).map((child) => [child, path] as const) : [...dir.children].map((child) => [child, path] as const);
    const promoted = transparent ? [...transparent.children].map((child) => [child, transparent.path] as const) : [];
    for (const [child, base] of [...children, ...promoted].sort((a, b) => (a[0] < b[0] ? -1 : 1))) this.build(raw, kinds, child, index, base);
  }

  private addModule(id: string, parent: number | null, kind: ModuleKind, label: string): number {
    const index = this.modules.length;
    this.modules.push({ id, label, parent, kind, children: [], directFiles: 0, totalFiles: 0, languages: {} });
    if (parent !== null) this.modules[parent]!.children.push(index);
    return index;
  }

  private count(path: string) {
    const language = languageOfPath(path)!;
    const module = this.moduleOf(path);
    this.modules[module]!.directFiles++;
    for (const ancestor of this.ancestry(module)) {
      const entry = this.modules[ancestor]!;
      entry.totalFiles++;
      entry.languages[language] = (entry.languages[language] ?? 0) + 1;
    }
  }
}

function transparentSourceRoot(raw: Map<string, RawDir>, dir: RawDir): RawDir | null {
  const src = raw.get(`${dir.path}/src`);
  if (!src) return null;
  return subtreeFiles(raw, src) >= subtreeFiles(raw, dir) * 0.8 ? src : null;
}

const subtreeCounts = new WeakMap<RawDir, number>();

function subtreeFiles(raw: Map<string, RawDir>, dir: RawDir): number {
  const cached = subtreeCounts.get(dir);
  if (cached !== undefined) return cached;
  const total = dir.files.length + [...dir.children].reduce((sum, child) => sum + subtreeFiles(raw, raw.get(child)!), 0);
  subtreeCounts.set(dir, total);
  return total;
}

function rawDirectories(sources: string[]): Map<string, RawDir> {
  const raw = new Map<string, RawDir>([[".", { path: ".", children: new Set(), files: [] }]]);
  const ensure = (path: string): RawDir => {
    let dir = raw.get(path);
    if (dir) return dir;
    dir = { path, children: new Set(), files: [] };
    raw.set(path, dir);
    ensure(posix.dirname(path)).children.add(path);
    return dir;
  };
  for (const path of sources) ensure(posix.dirname(path)).files.push(path);
  return raw;
}

function classify(raw: Map<string, RawDir>, allPaths: Set<string>): Map<string, ModuleKind> {
  const kinds = new Map<string, ModuleKind>([[".", "root"]]);
  const products = productLikeChildren(raw);
  for (const path of raw.keys()) {
    if (path === ".") continue;
    const name = posix.basename(path);
    const parent = posix.dirname(path);
    const has = (file: string) => allPaths.has(`${path}/${file}`);
    const candidates: ModuleKind[] = [];
    if (products.members.has(path)) candidates.push("product");
    if ([...manifestNames].some(has)) candidates.push("package");
    if (has("apps.py")) candidates.push("django-app");
    if (posix.basename(parent) === "scenes") candidates.push("scene");
    if (products.members.has(parent) && products.layerNames.get(posix.dirname(parent))?.has(name)) candidates.push("layer");
    if (/^(tests?|__tests__|e2e|__snapshots__|__mocks__)$/.test(name)) candidates.push("tests");
    if (name === "migrations") candidates.push("migrations");
    if (/^(__)?generated(__)?$/.test(name)) candidates.push("generated");
    if (has("__init__.py")) candidates.push("python-package");
    kinds.set(path, candidates.reduce<ModuleKind>((best, kind) => strongest(best, kind), "directory"));
  }
  return kinds;
}

function productLikeChildren(raw: Map<string, RawDir>): { members: Set<string>; layerNames: Map<string, Set<string>> } {
  const members = new Set<string>();
  const layerNames = new Map<string, Set<string>>();
  for (const dir of raw.values()) {
    if (dir.children.size < 10) continue;
    const frequency = new Map<string, number>();
    for (const child of dir.children) {
      for (const grandchild of raw.get(child)!.children) frequency.set(posix.basename(grandchild), (frequency.get(posix.basename(grandchild)) ?? 0) + 1);
    }
    const shared = new Set(
      [...frequency].filter(([name, count]) => count >= dir.children.size * 0.6 && !genericLayoutNames.has(name)).map(([name]) => name),
    );
    if (shared.size < 2) continue;
    layerNames.set(dir.path, shared);
    for (const child of dir.children) {
      const layout = [...raw.get(child)!.children].filter((grandchild) => shared.has(posix.basename(grandchild)));
      if (layout.length >= 1) members.add(child);
    }
  }
  return { members, layerNames };
}

function strongest(a: ModuleKind | null, b: ModuleKind): ModuleKind {
  if (a === null) return b;
  return kindPriority.indexOf(a) <= kindPriority.indexOf(b) ? a : b;
}
