import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backfill, type BackfillManifest } from "../../coherence/backfill.ts";
import { repositoryWithoutCommits, type Files, type TemporaryRepository } from "../architecture/index/repository.ts";

export type BackfillFixture = {
  repository: TemporaryRepository;
  dataDir: string;
  manifest: BackfillManifest;
  commits: Record<string, string>;
  request: Parameters<typeof backfill>[0];
  cleanup: () => Promise<void>;
};

const tangledView = `export function View({ count }: { count: any }): string {\n  debugger;\n${Array.from({ length: 12 }, (_, index) => `  if (count === ${index}) return '${index}';\n`).join("")}  return 'many';\n}\n`;
const productA: Files = {
  "products/__init__.py": "",
  "products/a/__init__.py": "",
  "products/a/backend/__init__.py": "",
  "products/a/backend/logic.py": "from products.a.backend.helpers import double\n\n\ndef compute(value):\n    return double(value) + 1\n",
  "products/a/backend/helpers.py": "def double(value):\n    return value * 2\n",
  "products/a/backend/limits.py": "LIMIT = 3\n",
  "products/a/frontend/view.tsx": tangledView,
  "products/a/frontend/title.tsx": "export const title = 'a';\n",
  "products/a/frontend/count.tsx": "export const count = 1;\n",
};
const productB: Files = { "products/b/__init__.py": "", "products/b/backend/__init__.py": "", "products/b/backend/api.py": "def lookup():\n    return 1\n" };
const busyFunction = `def busy(value):\n${Array.from({ length: 24 }, (_, index) => `    if value == ${index}:\n        return ${index}\n`).join("")}    return -1\n`;
export const mergeSubject = "Remove the busy <function> & friends (#42)";
const commitConfig = ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];

export async function backfillFixture(): Promise<BackfillFixture> {
  const repository = await repositoryWithoutCommits();
  const commits: Record<string, string> = {};
  const commitOn = async (name: string, date: string, files: Files, ...gitArgs: string[]) => {
    process.env.GIT_COMMITTER_DATE = date;
    process.env.GIT_AUTHOR_DATE = date;
    try {
      if (gitArgs.length > 0) await repository.git(...commitConfig, ...gitArgs);
      else await repository.commit(files);
    } finally {
      delete process.env.GIT_COMMITTER_DATE;
      delete process.env.GIT_AUTHOR_DATE;
    }
    commits[name] = (await repository.git("rev-parse", "HEAD")).trim();
  };
  await commitOn("base", "2026-03-10T12:00:00Z", productA);
  await commitOn("addsB", "2026-03-17T12:00:00Z", productB);
  await commitOn("busy", "2026-03-18T10:00:00Z", { "products/a/backend/busy.py": busyFunction });
  await commitOn("trivial", "2026-03-19T12:00:00Z", { "products/a/backend/limits.py": "LIMIT = 4\n" });
  await repository.git("checkout", "--quiet", "-b", "cleanup");
  await commitOn("removesBusy", "2026-03-25T12:00:00Z", { "products/a/backend/busy.py": null });
  await repository.git("checkout", "--quiet", "main");
  await commitOn("merge", "2026-03-27T00:30:00+02:00", {}, "merge", "--no-ff", "--quiet", "-m", mergeSubject, "cleanup");
  const dataDir = await mkdtemp(join(tmpdir(), "coherence-backfill-"));
  const request = { repository: repository.dir, ref: "main", scopes: ["products/a", "products/b"], weeks: 2, until: new Date("2026-03-30T00:00:00Z"), dataDir };
  const manifest = await backfill(request);
  const cleanup = async () => {
    await repository.cleanup();
    await rm(dataDir, { recursive: true, force: true });
  };
  return { repository, dataDir, manifest, commits, request, cleanup };
}
