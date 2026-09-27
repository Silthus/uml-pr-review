import type { Split } from "./comments.ts";
import type { CorpusRow } from "./corpus.ts";
import { type Estimate, subtypes } from "./labels.ts";

export type ReportInput = {
  since: string;
  until: string;
  heldOutFrom: string;
  pullRequests: Record<Split, number>;
  reviewedPullRequests: number;
  inlineComments: number;
  codeComments: Record<Split, number>;
  candidates: Record<Split, number>;
  recall: Estimate & { sampled: number; missed: number };
  precision: Estimate & { sampled: number; answers: Record<"yes" | "partly" | "no" | "unverifiable", number> };
  api: { queries: number; points: number };
  rows: CorpusRow[];
  heldOutDigest: string;
};

const topProducts = 15;

export function readme(input: ReportInput): string {
  return [
    "# Architecture correction corpus: PostHog, six months",
    "",
    "`corpus.jsonl` holds one row per human architecture correction left on code in a merged `PostHog/posthog` pull request, with links, a short quote, the product, the sub-type, the located fix commit, and the time split. Regenerate this file with `bun benchmark/corrections/run.ts corpus`; the method and the stages are below.",
    "",
    `- **Window:** PRs merged from ${input.since} through ${input.until}.`,
    `- **Split:** the development set is PRs merged before ${input.heldOutFrom.slice(0, 10)}; the held-out set is PRs merged on or after it. The held-out rows hash to \`${input.heldOutDigest}\` (\`heldout.sha256\`). They are never used for tuning.`,
    "",
    "## Counts",
    "",
    countsTable(input),
    "",
    "## By sub-type",
    "",
    breakdown(input.rows, ({ subtype }) => subtype, [...subtypes]),
    "",
    `## By product (top ${topProducts})`,
    "",
    breakdown(input.rows, ({ product }) => product, rankedProducts(input.rows).slice(0, topProducts)),
    "",
    "## Classifier recall",
    "",
    `Opus re-labelled a seeded random sample of ${input.recall.sampled} first-pass negatives from the development set and found ${input.recall.missed} architecture corrections among them. Scaled to all development negatives, the first pass keeps an estimated **${percent(input.recall.value)}** of the corrections Opus would confirm (95% Wilson interval ${percent(input.recall.low)} to ${percent(input.recall.high)}). This is recall relative to Opus, the labeller of record; Opus's own errors are not measured here.`,
    "",
    "## Fix precision",
    "",
    `Opus read the diffs of a seeded random sample of ${input.precision.sampled} isolable located fixes: ${input.precision.answers.yes} address the comment, ${input.precision.answers.partly} partly, ${input.precision.answers.no} do not, and ${input.precision.answers.unverifiable} cannot be told. Counting "yes" and "partly", the fix locator's precision is **${percent(input.precision.value)}** (95% Wilson interval ${percent(input.precision.low)} to ${percent(input.precision.high)}). The \`verified\` column carries the answer for the sampled rows and is empty for the rest.`,
    "",
    "## Method",
    "",
    method(input),
  ].join("\n");
}

function countsTable(input: ReportInput): string {
  const rows = (split: Split) => input.rows.filter((row) => row.split === split);
  const column = (split: Split) => {
    const members = rows(split);
    const sampled = members.filter(({ verified }) => verified !== null);
    return [input.pullRequests[split], input.codeComments[split], input.candidates[split], members.length, members.filter(({ fix }) => fix !== null).length, members.filter(({ isolable, fix }) => isolable && fix !== null).length, sampled.length, sampled.filter(({ verified }) => verified === "yes" || verified === "partly").length].map(String);
  };
  const [development, heldout] = [column("development"), column("heldout")];
  const labels = ["merged PRs", "human comments on code (non-author, non-bot)", "first-pass candidates", "confirmed architecture corrections", "with a located fix commit", "isolable, with a fix", "fixes verified by reading the diff", "verified fixes that address the comment"];
  return table(["", "development", "held-out", "total"], labels.map((label, index) => [label, development[index]!, heldout[index]!, String(Number(development[index]) + Number(heldout[index]))]));
}

function breakdown(rows: CorpusRow[], keyOf: (row: CorpusRow) => string, keys: string[]): string {
  const count = (key: string, predicate: (row: CorpusRow) => boolean) => String(rows.filter((row) => keyOf(row) === key && predicate(row)).length);
  return table(
    ["", "development", "held-out", "isolable with a fix", "total"],
    keys.map((key) => [key, count(key, ({ split }) => split === "development"), count(key, ({ split }) => split === "heldout"), count(key, ({ isolable, fix }) => isolable && fix !== null), count(key, () => true)]),
  );
}

function rankedProducts(rows: CorpusRow[]): string[] {
  const counts = Map.groupBy(rows, ({ product }) => product);
  return [...counts].sort(([a, first], [b, second]) => second.length - first.length || a.localeCompare(b)).map(([product]) => product);
}

function method(input: ReportInput): string {
  return [
    `1. **Collect.** \`gh api graphql\` search, one UTC day per window, lists every merged PR with its files, base, head, and counts (${input.pullRequests.development + input.pullRequests.heldout} PRs). A second pass fetches review threads (up to 100 per PR, 10 comments each), review bodies, and commits with timestamps for the ${input.reviewedPullRequests} PRs that have review threads, sizing each connection to its count so a query costs what it returns. Every raw response is cached on disk by the hash of its query, and the client waits for the rate-limit reset when fewer than 400 points remain. The run took ${input.api.queries} queries and ${input.api.points} GraphQL points.`,
    `2. **Filter.** Of ${input.inlineComments} inline comments, ${input.codeComments.development + input.codeComments.heldout} are from a human who is not the PR's author, are not a bot or a "not written by a human" QA-swarm comment, and carry at least 20 characters that are not an acknowledgement. Review bodies are dropped: they are not comments on code. The filter is \`humanReviewComments\` from \`coherence/validation/review-comments.ts\`, run over the whole repository.`,
    "3. **Classify.** A Haiku first pass labels every comment in batches of 60 against `benchmark/corrections/rubric.md`, tuned for recall. Opus confirms every candidate in batches of 50 and assigns the sub-type and the quote (at most 20 words, 200 characters). The exact prompts are in `benchmark/corrections/prompts.md`; the raw labels are in `labels/`.",
    "4. **Locate the fix.** PR heads are fetched over HTTPS into `refs/uml-pr-review/corpus/<n>` of a read-only PostHog clone. The fix is #95's rule (`locateFix`): the first non-merge PR commit after the comment that touches the commented file. A correction is isolable when a PR commit from before the comment still exists, so the fix is a separate commit and not a squashed or rebased whole. `before` is the fix's parent; `commentCommit` is the last PR commit before the comment.",
    `5. **Verify.** A seeded sample of ${input.precision.sampled} isolable fixes is judged by Opus from the diffs, with read-only access to the clone.`,
    `6. **Split.** Rows from PRs merged before ${input.heldOutFrom.slice(0, 10)} are the development set; the rest are held out. \`heldout.sha256\` is the sha256 of the held-out rows exactly as they appear in \`corpus.jsonl\`, in order: \`grep '"split":"heldout"' corpus.jsonl | shasum -a 256\`.`,
    "",
    "Limits: review threads beyond 100 per PR and comments beyond 10 per thread are not read; PRs with more than 100 commits are read to their first 100; a fix that lands only in another file, or after a force-push that rewrote the earlier commits, is not isolable or not found. The repository is public, so comment bodies and diffs stay in the uncommitted working directory; only links, quotes of at most 200 characters, and labels are committed.",
  ].join("\n");
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
  return [line(header), `| ${header.map(() => "---").join(" | ")} |`, ...rows.map(line)].join("\n");
}
