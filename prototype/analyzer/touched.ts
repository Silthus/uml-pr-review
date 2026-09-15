// PROTOTYPE - throwaway. Touched files and true head-side touched lines.
// Follows docs/research/github-pr-data.md on branch research/github-pr-data.

import type { PullRequestRef, TouchedFile } from "./interface.ts";

type DiffEntry = {
  filename: string;
  status: string;
  previous_filename?: string;
  patch?: string;
  changes: number;
};

const STATUS_MAP: Record<string, TouchedFile["status"]> = {
  added: "added",
  modified: "modified",
  changed: "modified",
  removed: "deleted",
  renamed: "renamed",
  copied: "added",
};

async function gh(path: string, paginate: boolean): Promise<unknown> {
  const args = ["api", path];
  if (paginate) args.push("--paginate", "--slurp");
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gh api ${path} failed: ${err.trim()}`);
  return JSON.parse(out);
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Walk the hunk body to get the exact head-side lines the diff changes.
 * Context lines are stepped over, not recorded, so a 7-line hunk that holds
 * one changed line gives one touched line.
 */
export function touchedLinesFromPatch(patch: string): {
  touchedLines: number[];
  deleteAnchors: number[];
} {
  const touched = new Set<number>();
  const anchors = new Set<number>();
  let cursor = 0;
  for (const raw of patch.split("\n")) {
    const header = HUNK.exec(raw);
    if (header) {
      cursor = Number(header[3]);
      continue;
    }
    if (cursor === 0) continue;
    const mark = raw[0];
    if (mark === "+") {
      touched.add(cursor);
      cursor += 1;
    } else if (mark === "-") {
      anchors.add(cursor);
    } else if (mark === "\\") {
      // "\ No newline at end of file". Not a line.
    } else {
      cursor += 1;
    }
  }
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return { touchedLines: sorted(touched), deleteAnchors: sorted(anchors) };
}

/** Read one pull request. Returns its head ref plus the touched files. */
export async function readPullRequest(
  owner: string,
  repo: string,
  number: number,
): Promise<{ pr: PullRequestRef; touched: TouchedFile[] }> {
  const meta = (await gh(`repos/${owner}/${repo}/pulls/${number}`, false)) as {
    title: string;
    html_url: string;
    changed_files: number;
    head: { sha: string };
  };
  const pages = (await gh(
    `repos/${owner}/${repo}/pulls/${number}/files?per_page=100`,
    true,
  )) as DiffEntry[][];
  const entries = pages.flat();
  if (entries.length !== meta.changed_files) {
    console.warn(
      `warn: ${entries.length} files listed but changed_files is ${meta.changed_files}`,
    );
  }

  const touched: TouchedFile[] = [];
  for (const e of entries) {
    const status = STATUS_MAP[e.status] ?? "modified";
    // A binary file has no patch and reports 0 changes. It holds no symbols.
    if (!e.patch) {
      if (status !== "deleted") continue;
      touched.push({
        path: e.filename,
        status,
        touchedLines: [],
        deleteAnchors: [],
      });
      continue;
    }
    const lines = touchedLinesFromPatch(e.patch);
    const file: TouchedFile = {
      // For a delete, `filename` is the base-side path. Keep it as the id.
      path: e.filename,
      status,
      ...lines,
    };
    if (e.previous_filename) file.previousPath = e.previous_filename;
    touched.push(file);
  }
  touched.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    pr: {
      url: meta.html_url,
      number,
      headSha: meta.head.sha,
      title: meta.title,
    },
    touched,
  };
}

if (import.meta.main) {
  const [owner, repo, num] = process.argv.slice(2);
  const result = await readPullRequest(owner!, repo!, Number(num));
  console.log(JSON.stringify(result, null, 2));
}
