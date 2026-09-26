import { rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { ArchitecturePayload } from "../src/architecture/contracts/index.ts";
import { createRepositoryIndexer, type IndexSource, type RepositoryIndexer } from "../src/architecture/index/index.ts";
import { git } from "../src/git.ts";

const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), options: { cold: { type: "boolean", default: false } }, allowPositionals: true });
const path = positionals[0];
if (!path) {
  console.error("Usage: bun scripts/measure-index.ts <repository> [--cold]\n  --cold  deletes this tool's index cache in the repository's Git common dir first.");
  process.exit(1);
}

const repository = await createRepositoryIndexer().repository(path);
if (values.cold) await clearCache(repository.commonDir);

const first = await timed(createRepositoryIndexer(), { commit: "HEAD" });
const warmIndexer = createRepositoryIndexer();
const warm = await timed(warmIndexer, { commit: "HEAD" });
const before = await worktreeState();
const snapshot = await timed(warmIndexer, "working-tree");
const after = await worktreeState();

const payload = warm.payload;
const topLevel = payload.modules.filter(([, , parent]) => parent === 0).length;
const products = payload.modules.filter(([, , , kind]) => kind === "product").length;
const resolvedShare = payload.stats.imports / (payload.stats.imports + payload.unresolved.length);

print("repository", `${repository.root} (${repository.name}) at ${payload.commit}`);
print(values.cold ? "cold" : "first", `${seconds(first.milliseconds)}  ${extraction(first.payload)}`);
print("warm", `${seconds(warm.milliseconds)}  ${extraction(warm.payload)}  (fresh indexer, cache on disk)`);
print("snapshot", `${seconds(snapshot.milliseconds)}  tree ${snapshot.payload.tree}${snapshot.payload.tree === payload.tree ? " (clean: equals HEAD's tree)" : ""}`);
print("real index", `${before.index === after.index ? "byte-identical" : "CHANGED"}, git status ${before.status === after.status ? "unchanged" : "CHANGED"}`);
print("resolution", `${(resolvedShare * 100).toFixed(2)} % in-repository (${payload.stats.imports} resolved, ${payload.unresolved.length} unresolved)`);
print("modules", `${payload.modules.length} (${topLevel} top level, ${products} products)`);
print("files", `${payload.files.length} files, ${payload.imports.length} file imports, payload ${(JSON.stringify(payload).length / 1e6).toFixed(1)} MB`);

async function timed(indexer: RepositoryIndexer, source: IndexSource): Promise<{ payload: ArchitecturePayload; milliseconds: number }> {
  const started = performance.now();
  const payload = await indexer.index(path!, source);
  return { payload, milliseconds: performance.now() - started };
}

async function worktreeState(): Promise<{ index: string; status: string }> {
  const index = (await git(path!, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim();
  const bytes = await Bun.file(index).arrayBuffer();
  return { index: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), status: await git(path!, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"]) };
}

async function clearCache(commonDir: string) {
  const database = join(commonDir, "uml-pr-review", "index-cache.sqlite");
  await Promise.all(["", "-wal", "-shm"].map((suffix) => rm(`${database}${suffix}`, { force: true })));
}

function extraction({ stats }: ArchitecturePayload): string {
  return `parsed ${stats.parsed}, cache hits ${stats.cacheHits}, failed ${stats.failed}`;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function print(label: string, value: string) {
  console.log(`${label.padEnd(11)} ${value}`);
}
