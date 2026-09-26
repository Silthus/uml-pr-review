import { execute } from "./execute.ts";
import { uvxTool } from "./tools.ts";

export type Failure = { file: string; message: string };

export type BuildSanity = {
  pythonFiles: number;
  pyCompileFailures: Failure[];
  ruff: { available: false } | { available: true; violations: Failure[] };
  typescript: string;
};

const typescriptNote = "skipped: PostHog's tsc run takes minutes on the whole frontend, too slow per arm";

export async function buildSanity(worktree: string, pythonFiles: string[]): Promise<BuildSanity> {
  return {
    pythonFiles: pythonFiles.length,
    pyCompileFailures: await pyCompileFailures(worktree, pythonFiles),
    ruff: await ruffCheck(worktree, pythonFiles),
    typescript: typescriptNote,
  };
}

async function pyCompileFailures(worktree: string, files: string[]): Promise<Failure[]> {
  const results = await Promise.all(files.map(async (file) => ({ file, result: await execute(worktree, ["python3", "-m", "py_compile", file]) })));
  return results.filter(({ result }) => result.code !== 0).map(({ file, result }) => ({ file, message: lastLine(result.stderr) }));
}

async function ruffCheck(worktree: string, files: string[]): Promise<BuildSanity["ruff"]> {
  const ruff = uvxTool("ruff");
  if (!ruff) return { available: false };
  if (files.length === 0) return { available: true, violations: [] };
  const result = await execute(worktree, [...ruff, "check", "--output-format", "json", "--exit-zero", ...files]);
  const reported = JSON.parse(result.stdout || "[]") as { filename: string; code: string | null; message: string }[];
  return { available: true, violations: reported.map(({ filename, code, message }) => ({ file: filename.replace(`${worktree}/`, ""), message: `${code ?? "error"}: ${message}` })) };
}

function lastLine(text: string): string {
  return text.trim().split("\n").at(-1) ?? "";
}
