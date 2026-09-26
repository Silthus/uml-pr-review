import { posix } from "node:path";
import type { Language, ModuleKind } from "../contracts/index.ts";

export type ModuleNode = {
  path: string;
  label: string;
  parent: number;
  kind: ModuleKind;
  directFiles: number;
  totalFiles: number;
  withinTests: boolean;
};

export type ModuleTree = {
  modules: ModuleNode[];
  moduleOfFile: (path: string) => number;
};

type Folder = { path: string; children: Set<string>; files: string[] };
type Draft = { path: string; label: string; kind: ModuleKind; folders: string[]; children: Draft[] };
type Context = { folders: Map<string, Folder>; kinds: Map<string, ModuleKind>; subtreeFiles: (folder: Folder) => number };

const root = ".";
const kindPriority: ModuleKind[] = ["root", "product", "package", "layer", "django-app", "scene", "tests", "migrations", "generated", "python-package", "directory"];
const genericLayoutNames = new Set(["src", "lib", "tests", "test", "__tests__", "scripts", "components", "hooks", "stores", "utils", "types"]);
const manifestNames = ["package.json", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod"];
const productFamilyMinimumSize = 10;
const productFamilySharedShare = 0.6;
const productFamilyMinimumLayers = 2;
const transparentSourceShare = 0.8;

export function languageOfSource(path: string): Language | null {
  if (/(^|\/)(\.[^/]+|node_modules)\//.test(path) || /\.d\.[mc]?ts$/.test(path)) return null;
  if (/\.pyi?$/.test(path)) return "python";
  if (/\.[mc]?tsx?$/.test(path)) return "typescript";
  if (/\.[mc]?jsx?$/.test(path)) return "javascript";
  if (/\.rs$/.test(path)) return "rust";
  return null;
}

export function buildModuleTree(sources: string[], allPaths: ReadonlySet<string>): ModuleTree {
  const folders = foldersOf(sources);
  const context: Context = { folders, kinds: classify(folders, allPaths), subtreeFiles: subtreeFileCounter(folders) };
  const { modules, moduleOfFolder } = flatten(draft(context, root, root, true));
  const moduleOfFile = (path: string) => moduleOfFolder.get(posix.dirname(path)) ?? nearestModule(moduleOfFolder, path);
  for (const path of sources) countFile(modules, moduleOfFile(path));
  return { modules, moduleOfFile };
}

function foldersOf(sources: string[]): Map<string, Folder> {
  const folders = new Map<string, Folder>([[root, { path: root, children: new Set(), files: [] }]]);
  const ensure = (path: string): Folder => {
    const existing = folders.get(path);
    if (existing) return existing;
    const folder: Folder = { path, children: new Set(), files: [] };
    folders.set(path, folder);
    ensure(posix.dirname(path)).children.add(path);
    return folder;
  };
  for (const path of sources) ensure(posix.dirname(path)).files.push(path);
  return folders;
}

function subtreeFileCounter(folders: Map<string, Folder>): (folder: Folder) => number {
  const counts = new Map<Folder, number>();
  const count = (folder: Folder): number => {
    const cached = counts.get(folder);
    if (cached !== undefined) return cached;
    const total = folder.files.length + [...folder.children].reduce((sum, child) => sum + count(folders.get(child)!), 0);
    counts.set(folder, total);
    return total;
  };
  return count;
}

function draft(context: Context, path: string, labelBase: string, isRoot: boolean): Draft {
  const chain = isRoot ? [path] : compressedChain(context.folders, path);
  const deepest = context.folders.get(chain.at(-1)!)!;
  const transparent = isRoot ? undefined : transparentSourceFolder(context, deepest);
  const children = [
    ...[...deepest.children].filter((child) => child !== transparent?.path).map((child) => draft(context, child, deepest.path, false)),
    ...[...(transparent?.children ?? [])].map((child) => draft(context, child, transparent!.path, false)),
  ];
  return {
    path: deepest.path,
    label: isRoot ? root : labelBase === root ? deepest.path : deepest.path.slice(labelBase.length + 1),
    kind: chain.map((folder) => context.kinds.get(folder)!).reduce(strongest),
    folders: transparent ? [...chain, transparent.path] : chain,
    children: children.sort((a, b) => compare(a.path, b.path)),
  };
}

function compressedChain(folders: Map<string, Folder>, path: string): string[] {
  const chain = [path];
  for (let folder = folders.get(path)!; folder.files.length === 0 && folder.children.size === 1; ) {
    const [only] = folder.children as Set<string>;
    if (posix.basename(only!) === "src") break;
    chain.push(only!);
    folder = folders.get(only!)!;
  }
  return chain;
}

function transparentSourceFolder(context: Context, folder: Folder): Folder | undefined {
  const source = context.folders.get(`${folder.path}/src`);
  if (!source) return undefined;
  return context.subtreeFiles(source) >= context.subtreeFiles(folder) * transparentSourceShare ? source : undefined;
}

function flatten(tree: Draft): { modules: ModuleNode[]; moduleOfFolder: Map<string, number> } {
  const modules: ModuleNode[] = [];
  const moduleOfFolder = new Map<string, number>();
  const visit = (node: Draft, parent: number) => {
    const index = modules.length;
    const withinTests = node.kind === "tests" || (parent >= 0 && modules[parent]!.withinTests);
    modules.push({ path: node.path, label: node.label, parent, kind: node.kind, directFiles: 0, totalFiles: 0, withinTests });
    for (const folder of node.folders) moduleOfFolder.set(folder, index);
    for (const child of node.children) visit(child, index);
  };
  visit(tree, -1);
  return { modules, moduleOfFolder };
}

function nearestModule(moduleOfFolder: Map<string, number>, path: string): number {
  for (let folder = posix.dirname(path); folder !== root; folder = posix.dirname(folder)) {
    const module = moduleOfFolder.get(folder);
    if (module !== undefined) return module;
  }
  return 0;
}

function countFile(modules: ModuleNode[], module: number) {
  modules[module]!.directFiles++;
  for (let ancestor = module; ancestor >= 0; ancestor = modules[ancestor]!.parent) modules[ancestor]!.totalFiles++;
}

function classify(folders: Map<string, Folder>, allPaths: ReadonlySet<string>): Map<string, ModuleKind> {
  const families = productFamilies(folders);
  const kinds = new Map<string, ModuleKind>([[root, "root"]]);
  for (const path of folders.keys()) {
    if (path !== root) kinds.set(path, candidateKinds(path, families, allPaths).reduce(strongest, "directory"));
  }
  return kinds;
}

function candidateKinds(path: string, families: ProductFamilies, allPaths: ReadonlySet<string>): ModuleKind[] {
  const name = posix.basename(path);
  const parent = posix.dirname(path);
  const holds = (file: string) => allPaths.has(`${path}/${file}`);
  const checks: [ModuleKind, boolean][] = [
    ["product", families.members.has(path)],
    ["package", manifestNames.some(holds)],
    ["layer", families.members.has(parent) && (families.layers.get(posix.dirname(parent))?.has(name) ?? false)],
    ["django-app", holds("apps.py")],
    ["scene", posix.basename(parent) === "scenes"],
    ["tests", /^(tests?|__tests__|e2e|__snapshots__|__mocks__)$/.test(name)],
    ["migrations", name === "migrations"],
    ["generated", /^(generated|__generated__)$/.test(name)],
    ["python-package", holds("__init__.py")],
  ];
  return checks.filter(([, applies]) => applies).map(([kind]) => kind);
}

type ProductFamilies = { members: Set<string>; layers: Map<string, Set<string>> };

function productFamilies(folders: Map<string, Folder>): ProductFamilies {
  const families: ProductFamilies = { members: new Set(), layers: new Map() };
  for (const folder of folders.values()) {
    if (folder.children.size < productFamilyMinimumSize) continue;
    const shared = sharedLayerNames(folders, folder);
    if (shared.size < productFamilyMinimumLayers) continue;
    families.layers.set(folder.path, shared);
    for (const child of folder.children) {
      if ([...folders.get(child)!.children].some((grandchild) => shared.has(posix.basename(grandchild)))) families.members.add(child);
    }
  }
  return families;
}

function sharedLayerNames(folders: Map<string, Folder>, family: Folder): Set<string> {
  const frequency = new Map<string, number>();
  for (const child of family.children) {
    for (const grandchild of folders.get(child)!.children) {
      const name = posix.basename(grandchild);
      frequency.set(name, (frequency.get(name) ?? 0) + 1);
    }
  }
  const threshold = family.children.size * productFamilySharedShare;
  return new Set([...frequency].filter(([name, count]) => count >= threshold && !genericLayoutNames.has(name)).map(([name]) => name));
}

function strongest(a: ModuleKind, b: ModuleKind): ModuleKind {
  return kindPriority.indexOf(a) <= kindPriority.indexOf(b) ? a : b;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
