import { Glob } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { posthogRepository } from "./scratch-worktree.ts";

export function uvxTool(tool: string): string[] | undefined {
  if (Bun.which(tool)) return [tool];
  const uvx = Bun.which("uvx") ?? floxBinary("uvx");
  return uvx ? [uvx, tool] : undefined;
}

export function floxBinary(name: string, repository = posthogRepository): string | undefined {
  const directory = join(repository, ".flox", "run");
  if (!existsSync(directory)) return undefined;
  for (const path of new Glob(`*/bin/${name}`).scanSync({ cwd: directory, absolute: true, onlyFiles: false, followSymlinks: true })) return path;
  return undefined;
}
