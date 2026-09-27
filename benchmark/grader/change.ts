import { isTestPath } from "../../src/analyzer/extract.ts";
import { git, readBlobs } from "../../src/architecture/index/git.ts";
import { languageOfSource } from "../../src/architecture/index/module-tree.ts";

export type Side = "before" | "after";
export type FileVersion = { path: string; sha: string; text: string };
export type ChangedFile = { status: "added" | "modified" | "deleted" | "renamed"; path: string; previousPath: string; before?: FileVersion; after?: FileVersion; addedLines: number };
export type Change = { repository: string; base: string; head: string; files: ChangedFile[] };

const missingBlob = /^0+$/;
const largestReadableBlob = 400_000;
const statusOf: Record<string, ChangedFile["status"]> = { A: "added", M: "modified", D: "deleted", R: "renamed", T: "modified", C: "added" };

export async function readChange(repository: string, base: string, head: string): Promise<Change> {
  const records = parseRawDiff(await git(repository, ["diff", "--raw", "-z", "-M", "--no-abbrev", base, head]));
  const added = await addedLineCounts(repository, base, head);
  const readable = records.filter(({ path, previousPath }) => isReadable(path) || isReadable(previousPath));
  const texts = await readBlobs(repository, readable.flatMap(({ beforeSha, afterSha }) => [beforeSha, afterSha].filter((sha) => !missingBlob.test(sha))));
  const version = (path: string, sha: string): FileVersion | undefined => {
    const text = texts.get(sha);
    return text === undefined || text.length > largestReadableBlob ? undefined : { path, sha, text };
  };
  return {
    repository,
    base,
    head,
    files: records.map((record) => ({
      status: record.status,
      path: record.path,
      previousPath: record.previousPath,
      before: record.status === "added" ? undefined : version(record.previousPath, record.beforeSha),
      after: record.status === "deleted" ? undefined : version(record.path, record.afterSha),
      addedLines: added.get(record.path) ?? 0,
    })),
  };
}

export function versionsOn(change: Change, side: Side): FileVersion[] {
  return change.files.flatMap((file) => file[side] ?? []);
}

export function renamesOf(change: Change): Map<string, string> {
  return new Map(change.files.filter(({ status }) => status === "renamed").map(({ path, previousPath }) => [previousPath, path]));
}

const notHandWritten = /(^|\/)(migrations|generated|__generated__|fixtures)\/|\.(generated|stories)\.|(^|\/)(tests?|test_[^/]*|[^/]*_tests?)\.rs$/;

export function isProductionSource(path: string): boolean {
  return languageOfSource(path) !== null && !isTestPath(path) && !notHandWritten.test(path);
}

function isReadable(path: string): boolean {
  return languageOfSource(path) !== null || /\.(ya?ml|md)$/.test(path);
}

type RawRecord = { status: ChangedFile["status"]; path: string; previousPath: string; beforeSha: string; afterSha: string };

function parseRawDiff(output: string): RawRecord[] {
  const fields = output.split("\0");
  const records: RawRecord[] = [];
  for (let index = 0; index < fields.length - 1; ) {
    const [, , beforeSha, afterSha, code] = fields[index]!.slice(1).split(" ");
    const status = statusOf[code![0]!] ?? "modified";
    const previousPath = fields[index + 1]!;
    const path = status === "renamed" || code![0] === "C" ? fields[index + 2]! : previousPath;
    records.push({ status, path, previousPath: code![0] === "C" ? path : previousPath, beforeSha: beforeSha!, afterSha: afterSha! });
    index += status === "renamed" || code![0] === "C" ? 3 : 2;
  }
  return records;
}

async function addedLineCounts(repository: string, base: string, head: string): Promise<Map<string, number>> {
  const output = await git(repository, ["diff", "--numstat", "-z", "-M", base, head]);
  const counts = new Map<string, number>();
  const fields = output.split("\0");
  for (let index = 0; index < fields.length - 1; index++) {
    const [added, , path] = fields[index]!.split("\t");
    const renamed = path === "";
    const target = renamed ? fields[index + 2]! : path!;
    if (renamed) index += 2;
    counts.set(target, added === "-" ? 0 : Number(added));
  }
  return counts;
}
