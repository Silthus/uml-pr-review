import { dirname, basename } from "node:path";
import { z } from "zod";
import { gh } from "./gh.ts";

export async function headCommit(repo: string): Promise<string> {
  return (await gh(["api", `repos/${repo}/commits/HEAD`], z.object({ sha: z.string() }))).sha;
}

export async function filesUnder(repo: string, commit: string, scope: string): Promise<string[]> {
  const trimmed = scope.replace(/\/$/, "");
  const parent = dirname(trimmed);
  const entries = await gh(["api", `repos/${repo}/contents/${parent === "." ? "" : parent}?ref=${commit}`], z.array(z.object({ name: z.string(), sha: z.string(), type: z.string() })));
  const directory = entries.find(({ name, type }) => name === basename(trimmed) && type === "dir");
  if (!directory) return [];
  const tree = await gh(["api", `repos/${repo}/git/trees/${directory.sha}?recursive=1`], z.object({ tree: z.array(z.object({ path: z.string(), type: z.string() })) }));
  return tree.tree.filter(({ type }) => type === "blob").map(({ path }) => `${trimmed}/${path}`);
}
