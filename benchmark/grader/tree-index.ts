import { git, listBlobs, type TreeEntry } from "../../src/architecture/index/git.ts";
import { isProductionSource } from "./change.ts";

export type KeyLoader<Key> = (entries: TreeEntry[]) => Promise<Map<string, Key[]>>;
export type TreeLookup<Key> = { tree: string; filesWith(key: Key): string[] };

export class InvertedTreeIndex<Key> {
  private tree: string | undefined;
  private readonly keysByPath = new Map<string, Set<Key>>();
  private readonly pathsByKey = new Map<Key, string[]>();

  constructor(
    private readonly repository: string,
    private readonly load: KeyLoader<Key>,
  ) {}

  async at(commit: string): Promise<TreeLookup<Key>> {
    const tree = (await git(this.repository, ["rev-parse", `${commit}^{tree}`])).trim();
    if (tree !== this.tree) await (this.tree === undefined ? this.build(tree) : this.update(this.tree, tree));
    this.tree = tree;
    return { tree, filesWith: (key) => this.pathsByKey.get(key) ?? [] };
  }

  private async build(tree: string): Promise<void> {
    await this.addAll((await listBlobs(this.repository, tree)).filter(({ path }) => isProductionSource(path)));
  }

  private async update(from: string, to: string): Promise<void> {
    const fields = (await git(this.repository, ["diff-tree", "-r", "-z", "--no-renames", from, to])).split("\0");
    const added: TreeEntry[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const [mode, , , sha] = fields[index]!.slice(1).split(" ");
      const path = fields[index + 1]!;
      if (!isProductionSource(path)) continue;
      this.remove(path);
      if (!/^0+$/.test(sha!)) added.push({ mode: mode!, sha: sha!, path });
    }
    await this.addAll(added);
  }

  private async addAll(entries: TreeEntry[]): Promise<void> {
    const keys = await this.load(entries);
    for (const { path, sha } of entries) this.add(path, keys.get(sha) ?? []);
  }

  private add(path: string, keys: Key[]): void {
    const unique = new Set(keys);
    this.keysByPath.set(path, unique);
    for (const key of unique) {
      const paths = this.pathsByKey.get(key);
      if (paths) paths.push(path);
      else this.pathsByKey.set(key, [path]);
    }
  }

  private remove(path: string): void {
    for (const key of this.keysByPath.get(path) ?? []) {
      const remaining = (this.pathsByKey.get(key) ?? []).filter((other) => other !== path);
      if (remaining.length > 0) this.pathsByKey.set(key, remaining);
      else this.pathsByKey.delete(key);
    }
    this.keysByPath.delete(path);
  }
}
