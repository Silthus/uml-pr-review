import packageJson from "../package.json" with { type: "json" };
import { analyze } from "./analyzer/analyze.ts";
import { diffCommits } from "./diff.ts";
import { git, listTree } from "./git.ts";
import { fetchPullRequestCommits, githubRepository, pullRequestMetadata, type PullRequestMetadata } from "./github.ts";
import { canonical, type Graph } from "./graph.ts";
import { renderArtifact } from "./render/artifact.ts";
import { toRenderModel } from "./render/to-render-model.ts";

export async function currentPullRequest(repoDir: string, number: number): Promise<PullRequestMetadata> {
  return pullRequestMetadata(repoDir, await githubRepository(repoDir), number);
}

export async function buildGraph(repoDir: string, pull: PullRequestMetadata): Promise<Graph> {
  await fetchPullRequestCommits(repoDir, pull);
  const mergeBase = (await git(repoDir, ["merge-base", pull.baseSha, pull.headSha])).trim();
  const [diffs, paths] = await Promise.all([diffCommits(repoDir, mergeBase, pull.headSha), listTree(repoDir, pull.headSha)]);
  const analysis = await analyze({
    repoDir,
    repoName: pull.repo.slice(pull.repo.indexOf("/") + 1),
    headSha: pull.headSha,
    paths,
    diffs,
  });
  return canonical({
    version: 1,
    generator: { name: "uml-pr-review", version: packageJson.version },
    pr: pull,
    ...analysis,
  });
}

export const renderGraph = (graph: Graph) => renderArtifact(toRenderModel(graph));
