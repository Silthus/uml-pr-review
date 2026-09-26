import { appendFileSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { gitText } from "./git-objects.ts";

const repoDir = process.argv[2] ?? `${process.env.HOME}/dev/posthog`;
const worktree = "/tmp/ph-snapshot-wt";
const cache = "/tmp/uml-pr-review-prototype-cache.sqlite";
const outDir = new URL("./out/runs/", import.meta.url).pathname;
const report: Record<string, unknown> = {};

const timed = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  const result = await work();
  report[`${name}Ms`] = Math.round(performance.now() - start);
  return result;
};
const sha256 = async (path: string) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
const quietStatus = (dir: string) => gitText(dir, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"]);

const mainIndex = `${(await gitText(repoDir, ["rev-parse", "--absolute-git-dir"])).trim()}/index`;
const mainIndexBefore = await sha256(mainIndex);
const head = (await gitText(repoDir, ["rev-parse", "HEAD"])).trim();

await timed("worktreeAdd", () => gitText(repoDir, ["worktree", "add", "--detach", worktree, head]));
try {
  const worktreeIndex = (await gitText(worktree, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim();
  appendFileSync(`${worktree}/products/error_tracking/backend/facade/api.py`, "\nfrom products.feature_flags.backend import facade as _prototype_probe  # noqa\n");
  mkdirSync(`${worktree}/products/error_tracking/backend/logic`, { recursive: true });
  writeFileSync(`${worktree}/products/error_tracking/backend/logic/prototype_probe.py`, "from posthog.models.team import Team\n\n\ndef probe() -> Team | None:\n    return None\n");
  const deleted = (await gitText(worktree, ["ls-files", "products/error_tracking/frontend/components"])).split("\n").find((path) => path.endsWith(".tsx"))!;
  rmSync(`${worktree}/${deleted}`);
  report.edits = ["M products/error_tracking/backend/facade/api.py", "A products/error_tracking/backend/logic/prototype_probe.py", `D ${deleted}`];

  const statusBefore = await quietStatus(worktree);
  const worktreeIndexBefore = await sha256(worktreeIndex);

  const seeded = "/tmp/ph-snapshot-seeded.index";
  copyFileSync(worktreeIndex, seeded);
  const env = { GIT_INDEX_FILE: seeded };
  await timed("seededAddAll", () => gitText(worktree, ["add", "-A"], env));
  const seededTree = (await timed("seededWriteTree", () => gitText(worktree, ["write-tree"], env))).trim();

  const empty = "/tmp/ph-snapshot-empty.index";
  if (existsSync(empty)) rmSync(empty);
  await timed("unseededAddAll", () => gitText(worktree, ["add", "-A"], { GIT_INDEX_FILE: empty }));
  const unseededTree = (await gitText(worktree, ["write-tree"], { GIT_INDEX_FILE: empty })).trim();

  const statusAfter = await quietStatus(worktree);
  const diff = (await gitText(worktree, ["diff-tree", "-r", "--name-status", `${head}^{tree}`, seededTree])).trim().split("\n");
  Object.assign(report, {
    head,
    seededTree,
    unseededTree,
    treesEqual: seededTree === unseededTree,
    diffAgainstHead: diff,
    worktreeIndexUntouched: worktreeIndexBefore === (await sha256(worktreeIndex)),
    mainIndexUntouched: mainIndexBefore === (await sha256(mainIndex)),
    statusUnchanged: statusBefore === statusAfter,
    statusLines: statusAfter.trim().split("\n"),
  });

  const reindex = Bun.spawnSync(
    ["bun", new URL("./index.ts", import.meta.url).pathname, "--repo", worktree, "--tree", seededTree, "--cache", cache, "--label", "snapshot-reindex", "--analyze", "--out", "/tmp/ph-snapshot-out"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const reindexReport = await Bun.file("/tmp/ph-snapshot-out/runs/snapshot-reindex.json").json();
  report.reindex = { exitCode: reindex.exitCode, timingsMs: reindexReport.timingsMs, extraction: reindexReport.extraction, fileEdges: reindexReport.graph.fileEdges };
  report.newProbeEdges = (await Bun.file("/tmp/ph-snapshot-out/posthog-architecture.json").json().then(probeEdges)) as string[];
} finally {
  await timed("worktreeRemove", () => gitText(repoDir, ["worktree", "remove", "--force", worktree]));
  await gitText(repoDir, ["worktree", "prune"]);
  report.mainIndexUntouchedAfterCleanup = mainIndexBefore === (await sha256(mainIndex));
  report.worktreeGone = !existsSync(worktree);
}

writeFileSync(`${outDir}/snapshot.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

function probeEdges(architecture: { files: [string, number, string][]; edges: [number, number, number][] }): string[] {
  const probes = new Set(["products/error_tracking/backend/facade/api.py", "products/error_tracking/backend/logic/prototype_probe.py"]);
  return architecture.edges
    .filter(([from, to]) => probes.has(architecture.files[from]![0]) && /feature_flags|posthog\/models\/team/.test(architecture.files[to]![0]))
    .map(([from, to]) => `${architecture.files[from]![0]} -> ${architecture.files[to]![0]}`);
}
