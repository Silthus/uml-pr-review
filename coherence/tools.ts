import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { execute } from "../benchmark/lib/execute.ts";
import { posthogRepository } from "../benchmark/lib/scratch-worktree.ts";
import { floxBinary } from "../benchmark/lib/tools.ts";
import type { ScopeFile } from "./scope.ts";

export const toolVersions = { lizard: "1.17.31", ruff: "0.13.3", oxlint: "1.19.0", jscpd: "4.0.5" } as const;

export type Tool = keyof typeof toolVersions;
export type Toolbox = Record<Tool, string[]> & { directory: string };

export async function withToolbox<T>(repository: string, files: ScopeFile[], work: (toolbox: Toolbox) => Promise<T>): Promise<T> {
  const uvx = Bun.which("uvx") ?? floxBinary("uvx", repository) ?? floxBinary("uvx", posthogRepository);
  if (!uvx) throw new Error("uvx is not on PATH or in a flox environment; install uv to measure complexity and lint findings.");
  const directory = await realpath(await mkdtemp(join(tmpdir(), "coherence-")));
  try {
    await Promise.all(files.map(async ({ path, text }) => {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), text);
    }));
    return await work({
      directory,
      lizard: [uvx, `lizard==${toolVersions.lizard}`],
      ruff: [uvx, `ruff==${toolVersions.ruff}`],
      oxlint: ["bunx", `oxlint@${toolVersions.oxlint}`],
      jscpd: ["bunx", `jscpd@${toolVersions.jscpd}`],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runTool(toolbox: Toolbox, command: string[], acceptedCodes: number[] = [0]): Promise<string> {
  const result = await execute(toolbox.directory, command);
  if (!acceptedCodes.includes(result.code)) throw new Error(`${command.slice(0, 2).join(" ")} failed (${result.code}): ${result.stderr.trim().slice(0, 500)}`);
  return result.stdout;
}

export function blobKey(tool: Tool, file: ScopeFile): string {
  return `${tool}@${toolVersions[tool]}\0${file.sha}\0${extname(file.path) === ".py" ? basename(file.path) : extname(file.path)}`;
}
