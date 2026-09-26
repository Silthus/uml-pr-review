import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git } from "../../../src/git.ts";
import type { ArchitecturePayload } from "../../../src/architecture/contracts/index.ts";

export type Files = Record<string, string | null>;

export type TemporaryRepository = {
  dir: string;
  write: (files: Files) => Promise<void>;
  commit: (files?: Files) => Promise<string>;
  git: (...args: string[]) => Promise<string>;
  cleanup: () => Promise<void>;
};

export async function temporaryRepository(files: Files): Promise<TemporaryRepository> {
  const dir = await mkdtemp(join(tmpdir(), "uml-pr-review-index-"));
  const run = (...args: string[]) => git(dir, args);
  const write = async (changes: Files) => {
    for (const [path, content] of Object.entries(changes)) {
      const target = join(dir, path);
      if (content === null) await rm(target);
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      }
    }
  };
  const commit = async (changes: Files = {}) => {
    await write(changes);
    await run("add", "--all");
    await run("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "change");
    return (await run("rev-parse", "HEAD")).trim();
  };
  await run("init", "--quiet", "--initial-branch=main");
  await commit(files);
  return { dir, write, commit, git: run, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function sourceFiles(names: string[], content = ""): Files {
  return Object.fromEntries(names.map((name) => [name, content]));
}

export function importsOf(payload: ArchitecturePayload): string[] {
  const path = (file: number) => payload.files[file]![0];
  return payload.imports.map(([from, to, kind, line, names]) => `${path(from)}:${line} -> ${path(to)} ${kind}${names.length > 0 ? ` [${names.join(", ")}]` : ""}`);
}

export function unresolvedOf(payload: ArchitecturePayload): string[] {
  return payload.unresolved.map(([file, line, specifier]) => `${payload.files[file]![0]}:${line} ${specifier}`);
}
