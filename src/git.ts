export class CommandError extends Error {
  constructor(
    readonly command: string[],
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(`${command.join(" ")} failed (${exitCode}): ${stderr.trim() || "no output"}`);
  }
}

export async function run(cwd: string, command: string[], stdin?: string): Promise<string> {
  const child = Bun.spawn(command, {
    cwd,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new CommandError(command, exitCode, stderr);
  return stdout;
}

export const git = (repoDir: string, args: string[], stdin?: string) => run(repoDir, ["git", ...args], stdin);

export async function repositoryRoot(dir: string): Promise<string> {
  return (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
}

export async function listTree(repoDir: string, commit: string): Promise<string[]> {
  const output = await git(repoDir, ["ls-tree", "-r", "-z", "--name-only", commit]);
  return output.split("\0").filter(Boolean);
}

export async function readBlobs(repoDir: string, commit: string, paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const blobs = new Map<string, string>();
  if (unique.length === 0) return blobs;
  const child = Bun.spawn(["git", "cat-file", "--batch"], {
    cwd: repoDir,
    stdin: new TextEncoder().encode(unique.map((path) => `${commit}:${path}\n`).join("")),
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = Buffer.from(await new Response(child.stdout).arrayBuffer());
  await child.exited;
  let offset = 0;
  for (const path of unique) {
    const headerEnd = output.indexOf(0x0a, offset);
    const header = output.subarray(offset, headerEnd).toString("utf8");
    offset = headerEnd + 1;
    const [, type, size] = header.split(" ");
    if (type === undefined || size === undefined) continue;
    const length = Number(size);
    if (type === "blob") blobs.set(path, output.subarray(offset, offset + length).toString("utf8"));
    offset += length + 1;
  }
  return blobs;
}

export async function filesContainingWords(
  repoDir: string,
  commit: string,
  words: string[],
  pathspecs: string[],
): Promise<Map<string, Set<string>>> {
  const filesByWord = new Map<string, Set<string>>(words.map((word) => [word, new Set()]));
  if (words.length === 0) return filesByWord;
  const alternation = words.map((word) => word.replace(/[$]/g, "\\$&")).join("|");
  const grep = (matcher: string[]) =>
    git(repoDir, ["grep", "-I", "-o", ...matcher, commit, "--", ...pathspecs]).catch((error: unknown) => {
      if (error instanceof CommandError && error.exitCode === 1) return "";
      throw error;
    });
  const output = await grep(["-P", `(?<![\\w$])(?:${alternation})(?![\\w$])`]).catch(() =>
    grep(["-w", "-F", ...words.flatMap((word) => ["-e", word])]),
  );
  const prefix = `${commit}:`;
  for (const line of output.split("\n")) {
    if (!line.startsWith(prefix)) continue;
    const separator = line.lastIndexOf(":");
    const path = line.slice(prefix.length, separator);
    filesByWord.get(line.slice(separator + 1))?.add(path);
  }
  return filesByWord;
}
