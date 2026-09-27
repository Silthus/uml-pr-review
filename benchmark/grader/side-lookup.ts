import { isProductionSource, type Change, type ChangedFile, type Side } from "./change.ts";
import type { TreeLookup } from "./tree-index.ts";

export type SideLookup<Key> = (key: Key, excludedPath: string) => string[];

export function sideLookup<Key>(base: TreeLookup<Key>, change: Change, side: Side, keysOf: (file: ChangedFile, side: Side) => Key[]): SideLookup<Key> {
  if (side === "before") return (key, excludedPath) => base.filesWith(key).filter((path) => path !== excludedPath);
  const replaced = new Set(change.files.flatMap(({ path, previousPath }) => [path, previousPath]));
  const changedKeys = change.files.flatMap((file) => (file.after && isProductionSource(file.path) ? [{ path: file.path, keys: new Set(keysOf(file, "after")) }] : []));
  return (key, excludedPath) => [
    ...base.filesWith(key).filter((path) => path !== excludedPath && !replaced.has(path)),
    ...changedKeys.filter(({ path, keys }) => path !== excludedPath && keys.has(key)).map(({ path }) => path),
  ];
}
