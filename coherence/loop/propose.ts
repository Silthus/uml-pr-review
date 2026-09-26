#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { git, run } from "../../src/git.ts";
import { emit, usageError } from "./cli.ts";
import { renderPullRequest, reviewHeading } from "./proposal.ts";
import { recordPromotion } from "./ledger.ts";
import { ledgerFile, readIteration, runsDirectoryOf, writeIteration, type Iteration } from "./state.ts";

const usage = "Usage: bun coherence/loop/propose.ts --iteration <dir> --summary <markdown file> [--draft] [--push-remote <name>]";

const githubRemote = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/;

const { values } = parseArgs({
  options: { iteration: { type: "string" }, summary: { type: "string" }, draft: { type: "boolean", default: false }, "push-remote": { type: "string", default: "origin" } },
});

if (!values.iteration || !values.summary) usageError(usage);

await emit(async () => {
  const directory = resolve(values.iteration!);
  const iteration = await readIteration(directory);
  const { workspace, verification } = iteration;
  if (workspace === null || verification === null) throw new Error("verify the iteration before proposing it: bun coherence/loop/verify.ts");
  if (verification.verdict !== "pass") throw new Error(`the last verification failed: ${verification.problems.join("; ")}`);
  const head = (await git(workspace.path, ["rev-parse", "HEAD"])).trim();
  if (head !== verification.head) throw new Error(`${workspace.branch} moved since the last verification; verify again`);
  const summary = await Bun.file(resolve(values.summary!)).text();
  if (!summary.includes(reviewHeading)) throw new Error(`the summary needs a "${reviewHeading}" section`);
  const mode = values.draft ? "draft" : "dry-run";
  const title = (await git(workspace.path, ["log", "--reverse", "--format=%s", `${iteration.base.commit}..${head}`])).split("\n")[0]!;
  const body = join(directory, "pr.md");
  await Bun.write(body, renderPullRequest({ iteration, verification, title, summary, mode }));
  const pullRequest = values.draft ? await openDraft(iteration, workspace, body, title, values["push-remote"]) : null;
  await writeIteration(directory, { ...iteration, proposal: { mode, body, pullRequest } });
  const ledgerEntry = pullRequest === null ? null : await recordPromotion(ledgerFile(runsDirectoryOf(iteration.sense)), { sense: iteration.senseId, module: iteration.target.module }, pullRequest);
  return { mode, body, branch: workspace.branch, workspace: workspace.path, pullRequest, ledgerEntry };
});

async function openDraft(iteration: Iteration, workspace: { path: string; branch: string }, body: string, title: string, pushRemote: string): Promise<string> {
  const upstream = (await remoteSlug(workspace.path, "upstream")) ?? (await remoteSlug(workspace.path, pushRemote));
  const fork = await remoteSlug(workspace.path, pushRemote);
  if (upstream === null || fork === null) throw new Error(`the workspace has no GitHub ${pushRemote} or upstream remote to open a draft on`);
  await git(workspace.path, ["push", "--set-upstream", pushRemote, `HEAD:refs/heads/${workspace.branch}`]);
  const head = fork === upstream ? workspace.branch : `${fork.split("/")[0]}:${workspace.branch}`;
  const baseBranch = iteration.base.ref.replace(/^(?:upstream|origin)\//, "");
  const output = await run(workspace.path, ["gh", "pr", "create", "--draft", "--repo", upstream, "--base", baseBranch, "--head", head, "--title", title, "--body-file", body]);
  return output.trim().split("\n").at(-1)!;
}

async function remoteSlug(workspace: string, remote: string): Promise<string | null> {
  const url = await git(workspace, ["config", "--get", `remote.${remote}.url`]).catch(() => "");
  return githubRemote.exec(url.trim())?.[1] ?? null;
}
