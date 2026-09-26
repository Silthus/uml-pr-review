#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { repositoryRoot, run } from "./git.ts";
import { parsePullRequestUrl, pullRequestMetadata } from "./github.ts";
import { serializeGraph } from "./graph.ts";
import { buildGraph, currentPullRequest, renderGraph } from "./review.ts";

const usage = "Usage: uml-pr-review <pr-url | pr-number> [--out file.html] [--json] [--open]";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: { out: { type: "string" }, json: { type: "boolean" }, open: { type: "boolean" } },
});

const [target] = positionals;
if (!target) {
  console.error(usage);
  process.exit(1);
}

const root = await repositoryRoot(process.cwd());
const fromUrl = parsePullRequestUrl(target);
const number = fromUrl?.number ?? Number(target);
if (!Number.isInteger(number) || number <= 0) {
  console.error(usage);
  process.exit(1);
}

const pull = fromUrl ? await pullRequestMetadata(root, fromUrl.repo, number) : await currentPullRequest(root, number);
const graph = await buildGraph(root, pull);

if (values.json) {
  process.stdout.write(serializeGraph(graph));
} else {
  const out = values.out ?? `pr-${pull.number}.html`;
  await Bun.write(out, await renderGraph(graph));
  if (values.open) await run(process.cwd(), [process.platform === "darwin" ? "open" : "xdg-open", out]);
  console.log(out);
}
