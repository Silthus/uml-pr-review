#!/usr/bin/env bun
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { git } from "../../src/git.ts";
import { emit, usageError } from "./cli.ts";
import { readIteration, writeIteration } from "./state.ts";

const usage = "Usage: bun coherence/loop/workspace.ts --iteration <dir> [--path <dir>]";

const { values } = parseArgs({ options: { iteration: { type: "string" }, path: { type: "string" } } });

if (!values.iteration) usageError(usage);

await emit(async () => {
  const directory = resolve(values.iteration!);
  const iteration = await readIteration(directory);
  if (iteration.action !== "act") throw new Error(`${directory} is a question, not a change; raise it with bun coherence/inbox.ts raise --iteration ${directory}`);
  if (iteration.workspace !== null) return { ...iteration.workspace, base: iteration.base, reused: true };
  const path = resolve(values.path ?? join(tmpdir(), `coherence-${iteration.scopeName}-${iteration.slug}`));
  const branch = `coherence/${iteration.scopeName}/${iteration.slug}`;
  if (await Bun.file(join(path, ".git")).exists()) throw new Error(`${path} already exists; remove it or pass --path`);
  if (await git(iteration.repository, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).then(() => true, () => false)) {
    throw new Error(`${branch} already exists in ${iteration.repository}; review or delete it, or record this iteration as abandoned`);
  }
  await git(iteration.repository, ["worktree", "add", "--detach", "--quiet", path, iteration.base.commit]);
  await git(path, ["switch", "--quiet", "--create", branch]);
  await writeIteration(directory, { ...iteration, workspace: { path, branch } });
  return { path, branch, base: iteration.base, busyFiles: iteration.target.busyFiles.map(({ path: file }) => file), reused: false };
});
