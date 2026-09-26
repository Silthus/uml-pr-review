import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execute } from "../benchmark/lib/execute.ts";
import { posthogRepository } from "../benchmark/lib/scratch-worktree.ts";
import { floxBinary } from "../benchmark/lib/tools.ts";
import type { ScopeFile } from "./scope.ts";

export const toolVersions = { lizard: "1.17.31", ruff: "0.13.3", oxlint: "1.19.0", jscpd: "4.0.5" } as const;

export type Tool = keyof typeof toolVersions;
export type Toolbox = Record<Tool, string[]> & { directory: string; originals: string };

const pythonPackagesPublishedBefore = "2026-09-26T00:00:00Z";
const cacheFormat = "coherence-cache-v2";
const filesPerCall = 400;
const localBinaries = join(import.meta.dir, "..", "node_modules", ".bin");

export async function withToolbox<T>(repository: string, files: ScopeFile[], work: (toolbox: Toolbox) => Promise<T>): Promise<T> {
  const uvx = [Bun.which("uvx") ?? floxBinary("uvx", repository) ?? floxBinary("uvx", posthogRepository) ?? missingUvx(), "--exclude-newer", pythonPackagesPublishedBefore];
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "coherence-")));
  const directory = join(workspace, "hand-written");
  const originals = join(workspace, "original");
  try {
    for (const batch of batches(files)) {
      await Promise.all(batch.flatMap((file) => [materialise(directory, file.path, file.text), materialise(originals, file.path, file.original)]));
    }
    return await work({
      directory,
      originals,
      lizard: [...uvx, `lizard==${toolVersions.lizard}`],
      ruff: [...uvx, `ruff==${toolVersions.ruff}`],
      oxlint: ["bun", join(localBinaries, "oxlint")],
      jscpd: ["bun", join(localBinaries, "jscpd")],
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function runTool(toolbox: Toolbox, command: string[], acceptedCodes: number[] = [0]): Promise<string> {
  const result = await execute(toolbox.directory, command);
  if (!acceptedCodes.includes(result.code)) throw new Error(`${command.slice(0, 2).join(" ")} failed (${result.code}): ${result.stderr.trim().slice(0, 500)}`);
  return result.stdout;
}

export async function runPerFile(toolbox: Toolbox, files: ScopeFile[], command: (paths: string[]) => string[], acceptedCodes?: number[]): Promise<string[]> {
  const outputs: string[] = [];
  for (const batch of batches(files)) outputs.push(await runTool(toolbox, command(batch.map(({ path }) => path)), acceptedCodes));
  return outputs;
}

export function blobKey(tool: Tool, file: ScopeFile, settings: unknown = null): string {
  return cacheKey(tool, settings, `${file.sha}\0${file.path}`);
}

export function cacheKey(tool: Tool, settings: unknown, fingerprint: string): string {
  return [cacheFormat, `${tool}@${toolVersions[tool]}`, JSON.stringify(settings), fingerprint].join("\0");
}

export function onOriginals(toolbox: Toolbox): Toolbox {
  return { ...toolbox, directory: toolbox.originals };
}

async function materialise(directory: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(directory, path)), { recursive: true });
  await writeFile(join(directory, path), text);
}

function batches<T>(items: T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / filesPerCall) }, (_, index) => items.slice(index * filesPerCall, (index + 1) * filesPerCall));
}

function missingUvx(): never {
  throw new Error("uvx is not on PATH or in a flox environment; install uv to measure complexity and lint findings.");
}
