#!/usr/bin/env bun
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { git } from "../../src/git.ts";
import { storedIndex } from "./attribute.ts";
import { changesBetween, ChangesSchema, scoresOf, ScoresSchema } from "./changes.ts";
import { diffLocal, DiffLocalSchema } from "./diff-local.ts";
import { ReviewCommentSchema, type ReviewComment } from "./review-comments.ts";
import { prThreshold } from "./selection.ts";

const LabelSchema = z.object({ id: z.string(), architecture: z.boolean(), kind: z.string(), quote: z.string() });
const VerificationSchema = z.object({ id: z.string(), addressed: z.enum(["yes", "partly", "no", "unverifiable"]), where: z.enum(["in-scope", "outside-scope", "both"]), note: z.string() });
const PullCommitSchema = z.object({ sha: z.string(), parents: z.array(z.object({ sha: z.string() })), commit: z.object({ committer: z.object({ date: z.string() }) }) });
const MomentSchema = z.enum(["improved", "worsened", "blind"]);

export const CorrectionSchema = ReviewCommentSchema.omit({ body: true }).extend({
  kind: z.string(),
  quote: z.string(),
  verification: VerificationSchema.omit({ id: true }).nullable(),
  base: z.string(),
  commentCommit: z.string().nullable(),
  isolable: z.boolean(),
  before: z.string().nullable(),
  fix: z.string().nullable(),
  missing: z.string().nullable(),
  index: ChangesSchema.extend({ scoresBefore: ScoresSchema, scoresAfter: ScoresSchema, moved: MomentSchema }).nullable(),
  local: DiffLocalSchema.extend({ moved: MomentSchema }).nullable(),
});
export type Correction = z.infer<typeof CorrectionSchema>;

export type PullCommit = { sha: string; parent: string; merge: boolean; date: string };
type Moment = z.infer<typeof MomentSchema>;
type Label = z.infer<typeof LabelSchema>;
type Verification = z.infer<typeof VerificationSchema>;
type CorrectionRequest = { repository: string; scope: string; reports: string; comment: ReviewComment; label: Label; verification: Verification | undefined; commits: PullCommit[]; base: string };
type FixLocation = { fix: PullCommit | undefined; commentCommit: string | undefined; isolable: boolean };

const github = "https://github.com/PostHog/posthog.git";
const correctionsDirectory = join(import.meta.dir, "corrections");

export async function locateFix(commits: PullCommit[], at: string | null, touchesArea: (commit: PullCommit) => Promise<boolean>): Promise<FixLocation> {
  if (at === null) return { fix: undefined, commentCommit: undefined, isolable: false };
  const own = commits.filter(({ merge }) => !merge);
  const earlier = own.filter(({ date }) => Date.parse(date) <= Date.parse(at));
  const located = (fix: PullCommit | undefined): FixLocation => ({ fix, commentCommit: earlier.at(-1)?.sha, isolable: earlier.length > 0 });
  for (const commit of own.filter(({ date }) => Date.parse(date) > Date.parse(at))) {
    if (await touchesArea(commit)) return located(commit);
  }
  return located(undefined);
}

export function momentOf(value: number, threshold: number): Moment {
  return value >= threshold ? "improved" : value <= -threshold ? "worsened" : "blind";
}

export async function readJsonFiles<T>(directory: string, schema: z.ZodType<T>): Promise<T[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  return (await Promise.all(files.map(async (file) => z.array(schema).parse(JSON.parse(await readFile(join(directory, file), "utf8")))))).flat();
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

export async function fetchPullRequests(repository: string, prs: number[], namespace: string): Promise<void> {
  const credentials = ["-c", "protocol.https.allow=always", "-c", `url.${github}.insteadOf=${github}`, "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"];
  await git(repository, [...credentials, "fetch", "--quiet", "--no-tags", github, ...prs.map((pr) => `+refs/pull/${pr}/head:refs/uml-pr-review/${namespace}/${pr}`)]);
}

export async function exists(repository: string, sha: string): Promise<boolean> {
  return git(repository, ["cat-file", "-e", `${sha}^{commit}`]).then(
    () => true,
    () => false,
  );
}

export async function touches(repository: string, { parent, sha }: PullCommit, area: string): Promise<boolean> {
  return (await git(repository, ["diff", "--name-only", parent, sha, "--", area])).trim() !== "";
}

async function correctionOf({ repository, scope, reports, comment, label, verification, commits, base }: CorrectionRequest): Promise<Correction> {
  const { fix, commentCommit, isolable } = await locateFix(commits, comment.at, (commit) => touches(repository, commit, comment.path ?? scope));
  const { id, url, author, path, line, at, pr } = comment;
  const checked = verification === undefined ? null : { addressed: verification.addressed, where: verification.where, note: verification.note };
  const shared = { id, url, author, path, line, at, pr, kind: label.kind, quote: label.quote, verification: checked, base, commentCommit: commentCommit ?? null, isolable, before: fix?.parent ?? null, fix: fix?.sha ?? null };
  const unreachable = fix === undefined ? [] : (await Promise.all([fix.parent, fix.sha].map(async (sha) => ((await exists(repository, sha)) ? [] : [sha])))).flat();
  if (fix === undefined || unreachable.length > 0) return { ...shared, missing: unreachable[0] ?? null, index: null, local: null };
  const [was, now] = [await storedIndex(repository, scope, fix.parent, reports), await storedIndex(repository, scope, fix.sha, reports)];
  const changes = changesBetween(was, now);
  const local = await diffLocal(repository, scope, fix.parent, fix.sha, reports);
  return {
    ...shared,
    missing: null,
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
  const labels = new Map((await readJsonFiles(join(correctionsDirectory, "labels"), LabelSchema)).map((label) => [label.id, label]));
  const verifications = new Map(z.array(VerificationSchema).parse(JSON.parse(await readFile(join(correctionsDirectory, "verification.json"), "utf8"))).map((entry) => [entry.id, entry]));
  const comments = z.array(ReviewCommentSchema).parse(JSON.parse(await readFile(join(resolve(values.work!), "comments.json"), "utf8"))).filter(({ id }) => labels.get(id)?.architecture);
  const prs = [...new Set(comments.map(({ pr }) => pr))];
  console.error(`${comments.length} architecture comments on ${prs.length} PRs; fetching their heads`);
  await fetchPullRequests(repository, prs, "validation");
  const history = new Map(await Promise.all(prs.map(async (pr) => [pr, { commits: await pullCommits(pr), base: await baseOf(pr) }] as const)));
  const corrections: Correction[] = [];
  for (const comment of comments) {
    const { commits, base } = history.get(comment.pr)!;
    const correction = await correctionOf({ repository, scope: values.scope!, reports: resolve(values.reports!), comment, label: labels.get(comment.id)!, verification: verifications.get(comment.id), commits, base });
    corrections.push(correction);
    console.error(`#${comment.pr} ${comment.id} fix ${correction.fix?.slice(0, 10) ?? "none"} index ${correction.index?.delta.composite ?? "-"} local ${correction.local?.score ?? "-"}`);
  }
  await writeFile(resolve(values.out!), JSON.stringify(corrections, null, 1));
}
