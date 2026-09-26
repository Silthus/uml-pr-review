import { join } from "node:path";
import type { ArchitecturePayload, ChangedFile, RepositoryRef } from "../contracts/index.ts";
import { changedFiles } from "./changes.ts";
import { ExtractionStore } from "./extraction-store.ts";
import { revision } from "./git.ts";
import { PromiseCache } from "./promise-cache.ts";
import { locateRepository } from "./repository.ts";
import { createSnapshotter, type Snapshotter } from "./snapshot.ts";
import { buildTreeIndex, type TreeIndex } from "./tree-index.ts";

export type IndexSource = "working-tree" | { commit: string };

export type RepositoryIndexerOptions = {
  workers?: number;
  onIndexed?: (payload: ArchitecturePayload) => void;
};

export type RepositoryIndexer = {
  repository(path: string): Promise<RepositoryRef>;
  index(path: string, source: IndexSource): Promise<ArchitecturePayload>;
  changes(path: string, fromTree: string, toTree: string): Promise<ChangedFile[]>;
};

const retainedTreeIndexes = 4;
const maximumWorkers = 8;

export function createRepositoryIndexer(options: RepositoryIndexerOptions = {}): RepositoryIndexer {
  const workers = Math.max(1, options.workers ?? Math.min(navigator.hardwareConcurrency, maximumWorkers));
  const treeIndexes = new PromiseCache<TreeIndex>(retainedTreeIndexes);
  const stores = new Map<string, ExtractionStore>();
  const snapshot = createSnapshotter();

  const storeFor = (repository: RepositoryRef) => {
    const store = stores.get(repository.id) ?? new ExtractionStore(join(repository.commonDir, "uml-pr-review", "index-cache.sqlite"));
    stores.set(repository.id, store);
    return store;
  };

  return {
    repository: locateRepository,

    async index(path, source) {
      const repository = await locateRepository(path);
      const { commit, tree } = await resolveSource(repository.root, source, snapshot);
      let built = false;
      const treeIndex = await treeIndexes.get(`${repository.id}\0${tree}`, () => {
        built = true;
        return buildTreeIndex(repository.root, tree, storeFor(repository), workers);
      });
      const payload: ArchitecturePayload = { version: 1, repository, commit, tree, ...treeIndex };
      if (built) options.onIndexed?.(payload);
      return payload;
    },

    async changes(path, fromTree, toTree) {
      const repository = await locateRepository(path);
      return changedFiles(repository.root, fromTree, toTree);
    },
  };
}

async function resolveSource(worktree: string, source: IndexSource, snapshot: Snapshotter): Promise<{ commit: string | null; tree: string }> {
  if (source === "working-tree") return { commit: null, tree: await snapshot(worktree) };
  const commit = await revision(worktree, `${source.commit}^{commit}`);
  return { commit, tree: await revision(worktree, `${commit}^{tree}`) };
}
