import { realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { RepositoryRef } from "../contracts/index.ts";
import { git } from "./git.ts";

export async function locateRepository(path: string): Promise<RepositoryRef> {
  const [root, commonDir] = await worktreeRootAndCommonDir(path);
  const id = await realpath(commonDir);
  return { id, root, commonDir: id, name: mainWorktreeName(id) };
}

async function worktreeRootAndCommonDir(path: string): Promise<[string, string]> {
  try {
    const [root, commonDir] = (await git(path, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"])).trim().split("\n");
    if (root && commonDir) return [root, commonDir];
  } catch {}
  throw new Error(`${path} is not inside a Git repository.`);
}

function mainWorktreeName(commonDir: string): string {
  return basename(commonDir) === ".git" ? basename(dirname(commonDir)) : basename(commonDir).replace(/\.git$/, "");
}
