import { CommandError } from "../../git.ts";

export type TreeEntry = { mode: string; sha: string; path: string };

const symbolicLinkMode = "120000";
const repositoryOverrides = new Set(["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"]);

export async function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const command = ["git", ...args];
  const child = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...inheritedEnvironment(), GIT_TERMINAL_PROMPT: "0", ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new CommandError(command, exitCode, stderr);
  return stdout;
}

export async function revision(cwd: string, specifier: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--verify", "--end-of-options", specifier])).trim();
}

export async function hasRevision(cwd: string, specifier: string): Promise<boolean> {
  return revision(cwd, specifier).then(
    () => true,
    () => false,
  );
}

export async function listBlobs(cwd: string, tree: string): Promise<TreeEntry[]> {
  const output = await git(cwd, ["ls-tree", "-r", "-z", "--full-tree", tree]);
  return output.split("\0").flatMap(parseTreeRecord);
}

export function isSymbolicLink(entry: TreeEntry): boolean {
  return entry.mode === symbolicLinkMode;
}

function inheritedEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !repositoryOverrides.has(name)));
}

function parseTreeRecord(record: string): TreeEntry[] {
  const tab = record.indexOf("\t");
  if (tab === -1) return [];
  const [mode, type, sha] = record.slice(0, tab).split(" ");
  return type === "blob" && mode && sha ? [{ mode, sha, path: record.slice(tab + 1) }] : [];
}

export async function readBlobs(cwd: string, shas: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(shas)];
  if (unique.length === 0) return new Map();
  const command = ["git", "cat-file", "--batch"];
  const child = Bun.spawn(command, {
    cwd,
    stdin: new TextEncoder().encode(unique.map((sha) => `${sha}\n`).join("")),
    stdout: "pipe",
    stderr: "pipe",
    env: inheritedEnvironment(),
  });
  const [output, stderr, exitCode] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new CommandError(command, exitCode, stderr);
  return parseBatchOutput(Buffer.from(output), unique);
}

function parseBatchOutput(output: Buffer, shas: string[]): Map<string, string> {
  const blobs = new Map<string, string>();
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
