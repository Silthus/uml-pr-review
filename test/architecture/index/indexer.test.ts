import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cp, mkdir, mkdtemp, readdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArchitecturePayload } from "../../../src/architecture/contracts/index.ts";
import { createRepositoryIndexer } from "../../../src/architecture/index/index.ts";
import { CommandError } from "../../../src/git.ts";
import { importsOf, temporaryRepository, type TemporaryRepository } from "./repository.ts";

const repositories: TemporaryRepository[] = [];
const installations: string[] = [];
const projectRoot = new URL("../../../", import.meta.url).pathname;
const indexerEntry = join(projectRoot, "src/architecture/index/index.ts");

async function repositoryOf(files: Record<string, string>) {
  const repository = await temporaryRepository(files);
  repositories.push(repository);
  return repository;
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
  await Promise.all(installations.splice(0).map((installation) => rm(installation, { recursive: true, force: true })));
});

function indexInFreshProcess(entry: string, repositoryDir: string) {
  const script = `const { createRepositoryIndexer } = await import(${JSON.stringify(entry)});
    const payload = await createRepositoryIndexer().index(${JSON.stringify(repositoryDir)}, { commit: "HEAD" });
    console.log(JSON.stringify(payload.stats));`;
  const child = Bun.spawnSync(["bun", "--eval", script], { stdout: "pipe", stderr: "pipe" });
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

async function installationWithoutGrammars(): Promise<string> {
  const installation = await mkdtemp(join(tmpdir(), "uml-pr-review-no-grammars-"));
  installations.push(installation);
  await cp(join(projectRoot, "src"), join(installation, "src"), { recursive: true });
  await mkdir(join(installation, "node_modules"));
  for (const dependency of await readdir(join(projectRoot, "node_modules"))) {
    if (dependency !== "@vscode") await symlink(join(projectRoot, "node_modules", dependency), join(installation, "node_modules", dependency));
  }
  return join(installation, "src/architecture/index/index.ts");
}

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

    const child = indexInFreshProcess(indexerEntry, repository.dir);

    expect(child.stderr).toBe("");
    expect(JSON.parse(child.stdout)).toMatchObject({ parsed: 0, cacheHits: 3 });
  });

  test("caches nothing from a run whose grammars could not load, so the next healthy run parses every file", async () => {
    const repository = await repositoryOf(threeFiles);

    const withoutGrammars = indexInFreshProcess(await installationWithoutGrammars(), repository.dir);
    const healthy = await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });

    expect(healthy.stats).toMatchObject({ parsed: 3, cacheHits: 0, failed: 0 });
    expect(importsOf(healthy)).toEqual(["app/a.py:1 -> app/b.py static", "app/b.py:1 -> app/c.py static"]);
    expect(withoutGrammars.exitCode).not.toBe(0);
    expect(withoutGrammars.stderr).toContain("could not load the tree-sitter grammars");
  });

  test("parses with at least one worker when asked for none", async () => {
    const repository = await repositoryOf(threeFiles);

    const payload = await createRepositoryIndexer({ workers: 0 }).index(repository.dir, { commit: "HEAD" });

    expect(payload.stats).toMatchObject({ parsed: 3, imports: 2 });
    expect(payload.imports).toHaveLength(2);
  });

  test("parses identical bytes once per grammar, so a file never inherits another language's imports", async () => {
    const sameBytes = 'import("./target");\n';
    const repository = await repositoryOf({ "a/use.ts": sameBytes, "z/use.py": sameBytes, "a/target.ts": "", "b/use.tsx": sameBytes });

    const first = await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });
    const second = await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });

    expect(importsOf(first)).toEqual(["a/use.ts:1 -> a/target.ts dynamic"]);
    expect(first.stats).toMatchObject({ parsed: 4, cacheHits: 0 });
    expect(second.stats).toMatchObject({ parsed: 0, cacheHits: 4 });
    expect(second.imports).toEqual(first.imports);
  });

  test("drops rows written by another extractor version when it opens the cache", async () => {
    const repository = await repositoryOf(threeFiles);
    await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });
    const cache = new Database(join(repository.dir, ".git/uml-pr-review/index-cache.sqlite"));
    cache.run("INSERT INTO extraction (sha, extractor, data) VALUES ('stale', 'imports-v2', '[]')");
    const extractorsIn = () => cache.query<{ extractor: string }, []>("SELECT DISTINCT extractor FROM extraction ORDER BY extractor").all().map(({ extractor }) => extractor);

    await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });

    expect(extractorsIn()).toEqual(["imports-v3/python"]);
    cache.close();
  });

  test("drops the parse failures an earlier indexer cached, so a poisoned cache heals when it opens", async () => {
    const repository = await repositoryOf(threeFiles);
    await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });
    const poisoned = (await repository.git("rev-parse", "HEAD:app/a.py")).trim();
    const cache = new Database(join(repository.dir, ".git/uml-pr-review/index-cache.sqlite"));
    cache.run("UPDATE extraction SET data = 'null' WHERE sha = ?", [poisoned]);
    cache.close();

    const healed = await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });

    expect(healed.stats).toMatchObject({ parsed: 1, cacheHits: 2, failed: 0 });
    expect(importsOf(healed)).toEqual(["app/a.py:1 -> app/b.py static", "app/b.py:1 -> app/c.py static"]);
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
