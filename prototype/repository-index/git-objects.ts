export type TreeEntry = { mode: string; sha: string; path: string };

export async function gitText(repoDir: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd: repoDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed (${exitCode}): ${stderr.trim()}`);
  return stdout;
}

export async function listTreeEntries(repoDir: string, treeish: string): Promise<TreeEntry[]> {
  const output = await gitText(repoDir, ["ls-tree", "-r", "-z", "--full-tree", treeish]);
  const entries: TreeEntry[] = [];
  for (const record of output.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    const [mode, type, sha] = record.slice(0, tab).split(" ");
    if (type === "blob" && mode && sha) entries.push({ mode, sha, path: record.slice(tab + 1) });
  }
  return entries;
}

export async function readBlobsBySha(repoDir: string, shas: string[]): Promise<Map<string, string>> {
  const blobs = new Map<string, string>();
  if (shas.length === 0) return blobs;
  const child = Bun.spawn(["git", "cat-file", "--batch"], {
    cwd: repoDir,
    stdin: new TextEncoder().encode(shas.map((sha) => `${sha}\n`).join("")),
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = Buffer.from(await new Response(child.stdout).arrayBuffer());
  await child.exited;
  let offset = 0;
  for (const sha of shas) {
    const headerEnd = output.indexOf(0x0a, offset);
    const [, type, size] = output.subarray(offset, headerEnd).toString("utf8").split(" ");
    offset = headerEnd + 1;
    if (type === undefined || size === undefined) continue;
    const length = Number(size);
    if (type === "blob") blobs.set(sha, output.subarray(offset, offset + length).toString("utf8"));
    offset += length + 1;
  }
  return blobs;
}
