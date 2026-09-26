import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git } from "../../src/git.ts";

export type Files = Record<string, string | null>;

export type CommittedRepository = { dir: string; base: string; head: string; cleanup: () => Promise<void> };

export async function repositoryWithChange(base: Files, head: Files): Promise<CommittedRepository> {
  const dir = await mkdtemp(join(tmpdir(), "uml-pr-review-"));
  await git(dir, ["init", "--quiet", "--initial-branch=main"]);
  const baseSha = await commit(dir, base, "base");
  const headSha = await commit(dir, head, "head");
  return { dir, base: baseSha, head: headSha, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function commit(dir: string, files: Files, message: string): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path);
    if (content === null) await rm(target);
    else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
  await git(dir, ["add", "--all"]);
  await git(dir, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", message]);
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}
