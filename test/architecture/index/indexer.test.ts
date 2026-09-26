import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArchitecturePayload } from "../../../src/architecture/contracts/index.ts";
import { createRepositoryIndexer } from "../../../src/architecture/index/index.ts";
import { CommandError } from "../../../src/git.ts";
import { temporaryRepository, type TemporaryRepository } from "./repository.ts";

const repositories: TemporaryRepository[] = [];

async function repositoryOf(files: Record<string, string>) {
  const repository = await temporaryRepository(files);
  repositories.push(repository);
  return repository;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

const threeFiles = { "app/a.py": "from app import b\n", "app/b.py": "from app import c\n", "app/c.py": "" };

describe("repository", () => {
  test("identifies the repository by its Git common dir from any folder inside a worktree", async () => {
    const repository = await repositoryOf(threeFiles);
    const commonDir = await realpath(join(repository.dir, ".git"));

    expect(await createRepositoryIndexer().repository(join(repository.dir, "app"))).toEqual({
      id: commonDir,
      root: (await repository.git("rev-parse", "--show-toplevel")).trim(),
      commonDir,
      name: repository.dir.split("/").at(-1)!,
    });
  });

  test("says so when a path is not inside a Git repository", async () => {
    const outside = await mkdtemp(join(tmpdir(), "uml-pr-review-outside-"));
    try {
      await expect(createRepositoryIndexer().index(outside, { commit: "HEAD" })).rejects.toThrow(`${outside} is not inside a Git repository.`);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("rejects a commit that does not exist with the failing Git command", async () => {
    const repository = await repositoryOf(threeFiles);
    await expect(createRepositoryIndexer().index(repository.dir, { commit: "no-such-branch" })).rejects.toBeInstanceOf(CommandError);
  });
});

describe("extraction cache", () => {
  test("stores import references per blob in the Git common dir, so another indexer parses nothing", async () => {
    const repository = await repositoryOf(threeFiles);

    const first = await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });
    const second = await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });

    expect(first.stats).toMatchObject({ files: 3, parsed: 3, cacheHits: 0, failed: 0 });
    expect(second.stats).toMatchObject({ files: 3, parsed: 0, cacheHits: 3, failed: 0 });
    expect(second.imports).toEqual(first.imports);
    expect(await Bun.file(join(repository.dir, ".git/uml-pr-review/index-cache.sqlite")).exists()).toBe(true);
  });

  test("parses nothing in a fresh process once the tree has been indexed", async () => {
    const repository = await repositoryOf(threeFiles);
    await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });

    const entry = new URL("../../../src/architecture/index/index.ts", import.meta.url).pathname;
    const script = `const { createRepositoryIndexer } = await import(${JSON.stringify(entry)});
      const payload = await createRepositoryIndexer().index(${JSON.stringify(repository.dir)}, { commit: "HEAD" });
      console.log(JSON.stringify(payload.stats));`;
    const child = Bun.spawnSync(["bun", "--eval", script], { stdout: "pipe", stderr: "pipe" });

    expect(child.stderr.toString()).toBe("");
    expect(JSON.parse(child.stdout.toString())).toMatchObject({ parsed: 0, cacheHits: 3 });
  });

  test("parses with at least one worker when asked for none", async () => {
    const repository = await repositoryOf(threeFiles);

    const payload = await createRepositoryIndexer({ workers: 0 }).index(repository.dir, { commit: "HEAD" });

    expect(payload.stats).toMatchObject({ parsed: 3, imports: 2 });
    expect(payload.imports).toHaveLength(2);
  });

  test("parses only the blobs a new tree adds, and each distinct blob once", async () => {
    const repository = await repositoryOf(threeFiles);
    const indexer = createRepositoryIndexer();
    await indexer.index(repository.dir, { commit: "HEAD" });
    await repository.commit({ "app/a.py": "from app import c\nimport os\n", "app/copy.py": "from app import b\n", "app/other_copy.py": "from app import b\n" });

    const payload = await indexer.index(repository.dir, { commit: "HEAD" });

    expect(payload.stats).toMatchObject({ files: 5, parsed: 1, cacheHits: 3 });
  });
});

describe("resolved indexes", () => {
  test("builds each tree once for concurrent requests and reports only fresh builds", async () => {
    const repository = await repositoryOf(threeFiles);
    const indexed: ArchitecturePayload[] = [];
    const indexer = createRepositoryIndexer({ onIndexed: (payload) => indexed.push(payload) });

    const [first, second] = await Promise.all([indexer.index(repository.dir, { commit: "HEAD" }), indexer.index(repository.dir, { commit: "main" })]);
    await indexer.index(repository.dir, { commit: "HEAD" });

    expect(indexed).toHaveLength(1);
    expect(indexed[0]).toEqual(first);
    expect(second.tree).toBe(first.tree);
  });

  test("keeps the four most recently used trees", async () => {
    const repository = await repositoryOf(threeFiles);
    const commits = [(await repository.git("rev-parse", "HEAD")).trim()];
    for (const version of [1, 2, 3, 4]) commits.push(await repository.commit({ "app/c.py": `VERSION = ${version}\n` }));
    const indexed: string[] = [];
    const indexer = createRepositoryIndexer({ onIndexed: (payload) => indexed.push(payload.commit!) });

    for (const commit of commits) await indexer.index(repository.dir, { commit });
    await indexer.index(repository.dir, { commit: commits[4]! });
    await indexer.index(repository.dir, { commit: commits[1]! });
    await indexer.index(repository.dir, { commit: commits[0]! });

    expect(indexed).toEqual([...commits, commits[0]!]);
  });

  test("reuses the index of a clean working tree, which has the same tree as HEAD", async () => {
    const repository = await repositoryOf(threeFiles);
    const indexed: ArchitecturePayload[] = [];
    const indexer = createRepositoryIndexer({ onIndexed: (payload) => indexed.push(payload) });

    const head = await indexer.index(repository.dir, { commit: "HEAD" });
    const workingTree = await indexer.index(repository.dir, "working-tree");

    expect(workingTree).toMatchObject({ commit: null, tree: head.tree });
    expect(indexed).toHaveLength(1);
  });
});
