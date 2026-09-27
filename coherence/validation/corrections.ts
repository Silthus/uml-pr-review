#!/usr/bin/env bun
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { git } from "../../src/git.ts";
import { storedIndex } from "./attribute.ts";
import { changesBetween, scoresOf, type Changes, type Scores } from "./changes.ts";
import { diffLocal, type DiffLocal } from "./diff-local.ts";
import type { ReviewComment } from "./review-comments.ts";
import { prThreshold } from "./selection.ts";

const LabelSchema = z.object({ id: z.string(), architecture: z.boolean(), kind: z.string(), quote: z.string() });
const PullCommitSchema = z.object({ sha: z.string(), parents: z.array(z.object({ sha: z.string() })), commit: z.object({ committer: z.object({ date: z.string() }) }) });

type Label = z.infer<typeof LabelSchema>;
type PullCommit = { sha: string; parent: string; merge: boolean; date: string };
type Moment = "improved" | "worsened" | "blind";

export type Correction = Omit<ReviewComment, "body"> & {
  kind: string;
  quote: string;
  base: string;
  commentCommit: string;
  isolable: boolean;
  before: string | null;
  fix: string | null;
  missing: string | null;
  index: (Changes & { scoresBefore: Scores; scoresAfter: Scores; moved: Moment }) | null;
  local: (DiffLocal & { moved: Moment }) | null;
};

const github = "https://github.com/PostHog/posthog.git";
const labelsDirectory = join(import.meta.dir, "corrections", "labels");

async function readLabels(): Promise<Map<string, Label>> {
  const files = (await readdir(labelsDirectory)).filter((file) => file.endsWith(".json")).sort();
  const labels = await Promise.all(files.map(async (file) => z.array(LabelSchema).parse(JSON.parse(await readFile(join(labelsDirectory, file), "utf8")))));
  return new Map(labels.flat().map((label) => [label.id, label]));
}

async function pullCommits(pr: number): Promise<PullCommit[]> {
  const output = await Bun.$`gh api --paginate repos/PostHog/posthog/pulls/${pr}/commits --jq .[]`.text();
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => PullCommitSchema.parse(JSON.parse(line)))
    .map(({ sha, parents, commit }) => ({ sha, parent: parents[0]!.sha, merge: parents.length > 1, date: commit.committer.date }));
}

async function baseOf(pr: number): Promise<string> {
  return (await Bun.$`gh api repos/PostHog/posthog/pulls/${pr} --jq .base.sha`.text()).trim();
}

async function fetchPullRequests(repository: string, prs: number[]): Promise<void> {
  const credentials = ["-c", "protocol.https.allow=always", "-c", `url.${github}.insteadOf=${github}`, "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"];
  await git(repository, [...credentials, "fetch", "--quiet", "--no-tags", github, ...prs.map((pr) => `+refs/pull/${pr}/head:refs/uml-pr-review/validation/${pr}`)]);
}

async function exists(repository: string, sha: string): Promise<boolean> {
  return git(repository, ["cat-file", "-e", `${sha}^{commit}`]).then(() => true, () => false);
}

async function touches(repository: string, { parent, sha }: PullCommit, path: string): Promise<boolean> {
  return (await git(repository, ["diff", "--name-only", parent, sha, "--", path])).trim() !== "";
}

function momentOf(value: number, threshold: number): Moment {
  return value >= threshold ? "improved" : value <= -threshold ? "worsened" : "blind";
}

async function correctionOf(repository: string, scope: string, reports: string, comment: ReviewComment, label: Label, commits: PullCommit[], base: string): Promise<Correction> {
  const at = comment.at ?? "";
  const own = commits.filter(({ merge }) => !merge);
  const earlier = own.filter(({ date }) => date <= at);
  const area = comment.path ?? scope;
  let fix: PullCommit | undefined;
  for (const commit of own.filter(({ date }) => date > at)) {
    if (await touches(repository, commit, area)) {
      fix = commit;
      break;
    }
  }
  const { id, url, author, path, line, pr } = comment;
  const shared = { id, url, author, path, line, at, pr, kind: label.kind, quote: label.quote, base, commentCommit: earlier.at(-1)?.sha ?? base, isolable: earlier.length > 0, before: fix?.parent ?? null, fix: fix?.sha ?? null };
  const missing = (await Promise.all([fix?.parent, fix?.sha].filter((sha): sha is string => sha !== undefined).map(async (sha) => ((await exists(repository, sha)) ? null : sha)))).find((sha) => sha !== null) ?? null;
  if (fix === undefined || missing !== null) return { ...shared, missing, index: null, local: null };
  const before = fix.parent;
  const [was, now] = [await storedIndex(repository, scope, before, reports), await storedIndex(repository, scope, fix.sha, reports)];
  const changes = changesBetween(was, now);
  const local = await diffLocal(repository, scope, before, fix.sha, reports);
  return {
    ...shared,
    missing,
    index: { ...changes, scoresBefore: scoresOf(was), scoresAfter: scoresOf(now), moved: momentOf(changes.delta.composite, prThreshold) },
    local: { ...local, moved: momentOf(local.score, 1) },
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      scope: { type: "string", default: "products/workflows" },
      reports: { type: "string", default: "/tmp/coherence-validation-reports" },
      work: { type: "string", default: "/tmp/coherence-validation-corrections" },
      out: { type: "string", default: join(import.meta.dir, "data", "corrections.json") },
    },
  });
  if (!values.repo) {
    console.error("Usage: bun coherence/validation/corrections.ts --repo <path> [--scope products/workflows] [--reports <dir>] [--work <dir>] [--out coherence/validation/data/corrections.json]");
    process.exit(2);
  }
  const repository = resolve(values.repo);
  const labels = await readLabels();
  const comments = (JSON.parse(await readFile(join(resolve(values.work!), "comments.json"), "utf8")) as ReviewComment[]).filter(({ id }) => labels.get(id)?.architecture);
  const prs = [...new Set(comments.map(({ pr }) => pr))];
  console.error(`${comments.length} architecture comments on ${prs.length} PRs; fetching their heads`);
  await fetchPullRequests(repository, prs);
  const history = new Map(await Promise.all(prs.map(async (pr) => [pr, { commits: await pullCommits(pr), base: await baseOf(pr) }] as const)));
  const corrections: Correction[] = [];
  for (const comment of comments) {
    const { commits, base } = history.get(comment.pr)!;
    const correction = await correctionOf(repository, values.scope!, resolve(values.reports!), comment, labels.get(comment.id)!, commits, base);
    corrections.push(correction);
    console.error(`#${comment.pr} ${comment.id} fix ${correction.fix?.slice(0, 10) ?? "none"} index ${correction.index?.delta.composite ?? "-"} local ${correction.local?.score ?? "-"}`);
  }
  await writeFile(resolve(values.out!), JSON.stringify(corrections, null, 1));
}
