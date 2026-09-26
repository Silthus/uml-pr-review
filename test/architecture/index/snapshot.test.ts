import { afterEach, describe, expect, test } from "bun:test";
import { rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createRepositoryIndexer } from "../../../src/architecture/index/index.ts";
import { CommandError } from "../../../src/git.ts";
import { importsOf, repositoryWithoutCommits, temporaryRepository, type TemporaryRepository } from "./repository.ts";

const repositories: TemporaryRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

async function repositoryWithIgnoredButTrackedFile(): Promise<TemporaryRepository> {
  const repository = await temporaryRepository({
    ".gitignore": "vendor/\nscratch.py\n",
    "app/a.py": "",
    "app/b.py": "",
    "app/c.py": "",
  });
  repositories.push(repository);
  await repository.write({ "vendor/kept.py": "from app import c\n" });
  await repository.git("add", "--force", "vendor/kept.py");
  await repository.commit();
  return repository;
}

async function worktreeState(repository: TemporaryRepository) {
  const index = await Bun.file(join(repository.dir, ".git/index")).bytes();
  return {
    index: new Bun.CryptoHasher("sha256").update(index).digest("hex"),
    status: await repository.git("--no-optional-locks", "status", "--porcelain", "--untracked-files=all"),
    head: await repository.git("rev-parse", "HEAD"),
  };
}

const pathsOf = (payload: { files: [string, ...unknown[]][] }) => payload.files.map(([path]) => path);

describe("working-tree snapshot", () => {
  test("captures modified, added, deleted, untracked, and tracked-but-ignored files without touching the real index", async () => {
    const repository = await repositoryWithIgnoredButTrackedFile();
    await repository.write({ "app/a.py": "from app import b\n" });
    await repository.git("add", "app/a.py");
    await repository.write({ "app/a.py": "from app import new\n", "app/new.py": "from app import c\n", "app/b.py": null, "scratch.py": "from app import a\n" });
    const before = await worktreeState(repository);

    const payload = await createRepositoryIndexer().index(repository.dir, "working-tree");

    expect(await worktreeState(repository)).toEqual(before);
    expect(payload.commit).toBeNull();
    expect(pathsOf(payload)).toEqual(["app/a.py", "app/c.py", "app/new.py", "vendor/kept.py"]);
    expect(importsOf(payload)).toEqual(["app/a.py:1 -> app/new.py static", "app/new.py:1 -> app/c.py static", "vendor/kept.py:1 -> app/c.py static"]);
  });

  test("starts from HEAD when the worktree has no index yet", async () => {
    const repository = await repositoryWithIgnoredButTrackedFile();
    await rm(join(repository.dir, ".git/index"));

    const payload = await createRepositoryIndexer().index(repository.dir, "working-tree");

    expect(pathsOf(payload)).toContain("vendor/kept.py");
    expect(await Bun.file(join(repository.dir, ".git/index")).exists()).toBe(false);
  });

  test("captures the working tree of a repository without commits", async () => {
    const repository = await repositoryWithoutCommits();
    repositories.push(repository);
    await repository.write({ "app/first.py": "from app import second\n", "app/second.py": "" });

    const payload = await createRepositoryIndexer().index(repository.dir, "working-tree");

    expect(importsOf(payload)).toEqual(["app/first.py:1 -> app/second.py static"]);
  });

  test("gives concurrent snapshots of one worktree the same tree", async () => {
    const repository = await repositoryWithIgnoredButTrackedFile();
    await repository.write({ "app/new.py": "" });
    const indexer = createRepositoryIndexer();

    const trees = await Promise.all([1, 2, 3].map(() => indexer.index(repository.dir, "working-tree").then(({ tree }) => tree)));

    expect(new Set(trees).size).toBe(1);
    expect(trees[0]).not.toBe((await repository.git("rev-parse", "HEAD^{tree}")).trim());
  });
});

describe("changed files", () => {
  test("lists source files added, modified, or deleted between two trees with their first changed line", async () => {
    const repository = await repositoryWithIgnoredButTrackedFile();
    await repository.commit({ "app/0.py": "x\n", "app/a.py": "one\ntwo\nthree\nfour\n", "app/c.py": "keep\n", "app/sp ace.py": "a\nb\n", "app/ünï.py": "a\n" });
    const base = (await repository.git("rev-parse", "HEAD^{tree}")).trim();
    await rm(join(repository.dir, "app/0.py"));
    await symlink("c.py", join(repository.dir, "app/0.py"));
    await repository.commit({
      "app/a.py": "one\ntwo\n++ 3\nfour\n5\n",
      "app/c.py": "",
      "app/b.py": null,
      "app/added.ts": "export {};\n",
      "app/types.d.ts": "declare const x: number;\n",
      "app/sp ace.py": "a\nB\n",
      "app/ünï.py": "a\nb\n",
      "README.md": "changed",
    });
    const head = (await repository.git("rev-parse", "HEAD^{tree}")).trim();

    expect(await createRepositoryIndexer().changes(repository.dir, base, head)).toEqual([
      { path: "app/0.py", status: "modified", firstChangedLine: 1 },
      { path: "app/a.py", status: "modified", firstChangedLine: 3 },
      { path: "app/added.ts", status: "added", firstChangedLine: 1 },
      { path: "app/b.py", status: "deleted", firstChangedLine: 1 },
      { path: "app/c.py", status: "modified", firstChangedLine: 1 },
      { path: "app/sp ace.py", status: "modified", firstChangedLine: 2 },
      { path: "app/ünï.py", status: "modified", firstChangedLine: 2 },
    ]);
  });

  test("accepts only trees, never options, as the two ends", async () => {
    const repository = await repositoryWithIgnoredButTrackedFile();
    const output = join(repository.dir, "written-by-git.txt");

    await expect(createRepositoryIndexer().changes(repository.dir, `--output=${output}`, "HEAD")).rejects.toBeInstanceOf(CommandError);
    expect(await Bun.file(output).exists()).toBe(false);
  });
});
