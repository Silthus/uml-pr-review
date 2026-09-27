# Architecture correction corpus: PostHog, six months

`corpus.jsonl` holds one row per human architecture correction left on code in a merged `PostHog/posthog` pull request, with links, a short quote, the product, the sub-type, the located fix commit, and the time split. Regenerate this file with `bun benchmark/corrections/run.ts corpus`; the method and the stages are below.

- **Window:** PRs merged from 2026-03-27 through 2026-09-26.
- **Split:** the development set is PRs merged before 2026-08-01; the held-out set is PRs merged on or after it. The held-out rows hash to `c70edaddeec86fdd4f5ead12f6be0bfdf066805ec5527bfe59fcf2edb4cdda16` (`heldout.sha256`). They are never used for tuning.

## Counts

|  | development | held-out | total |
| --- | --- | --- | --- |
| merged PRs | 15346 | 10097 | 25443 |
| human comments on code (non-author, non-bot) | 7032 | 5172 | 12204 |
| first-pass candidates | 2517 | 1631 | 4148 |
| confirmed architecture corrections | 950 | 484 | 1434 |
| with a located fix commit | 826 | 440 | 1266 |
| isolable, with a fix | 542 | 307 | 849 |
| fixes verified by reading the diff | 31 | 19 | 50 |
| verified fixes that address the comment | 26 | 17 | 43 |

## By sub-type

|  | development | held-out | isolable with a fix | total |
| --- | --- | --- | --- | --- |
| reuse | 266 | 132 | 229 | 398 |
| layer | 170 | 61 | 138 | 231 |
| facade-boundary | 12 | 10 | 15 | 22 |
| dependency | 18 | 14 | 17 | 32 |
| duplication | 191 | 123 | 199 | 314 |
| split-merge | 82 | 49 | 77 | 131 |
| naming | 75 | 37 | 65 | 112 |
| other | 136 | 58 | 109 | 194 |

## By product (top 15)

|  | development | held-out | isolable with a fix | total |
| --- | --- | --- | --- | --- |
| frontend/scenes | 121 | 35 | 90 | 156 |
| posthog/temporal | 63 | 5 | 44 | 68 |
| posthog/api | 45 | 18 | 42 | 63 |
| feature_flags | 17 | 44 | 53 | 61 |
| frontend/lib | 48 | 11 | 30 | 59 |
| signals | 40 | 8 | 29 | 48 |
| ai_observability | 20 | 23 | 37 | 43 |
| nodejs/ingestion | 33 | 6 | 29 | 39 |
| tasks | 28 | 9 | 18 | 37 |
| rust/feature-flags | 19 | 17 | 26 | 36 |
| rust/cohort-stream-processor | 20 | 15 | 18 | 35 |
| posthog/models | 24 | 7 | 12 | 31 |
| replay_vision | 10 | 21 | 14 | 31 |
| dashboards | 19 | 9 | 12 | 28 |
| nodejs/cdp | 12 | 13 | 12 | 25 |

## Classifier recall

Opus re-labelled a seeded random sample of 200 first-pass negatives from the development set and found 3 architecture corrections among them. Scaled to all development negatives, the first pass keeps an estimated **93.3%** of the corrections Opus would confirm (95% Wilson interval 83.0% to 97.6%). This is recall relative to Opus, the labeller of record; Opus's own errors are not measured here.

## Fix precision

Opus read the diffs of a seeded random sample of 50 isolable located fixes: 37 address the comment, 6 partly, 7 do not, and 0 cannot be told. Counting "yes" and "partly", the fix locator's precision is **86.0%** (95% Wilson interval 73.8% to 93.0%). The `verified` column carries the answer for the sampled rows and is empty for the rest.

## Method

1. **Collect.** `gh api graphql` search, one UTC day per window, lists every merged PR with its files, base, head, and counts (25443 PRs). A second pass fetches review threads (up to 100 per PR, 10 comments each), review bodies, and commits with timestamps for the 15612 PRs that have review threads, sizing each connection to its count so a query costs what it returns. Every raw response is cached on disk by the hash of its query, and the client waits for the rate-limit reset when fewer than 400 points remain. The run took 763 queries and 1494 GraphQL points.
2. **Filter.** Of 109096 inline comments, 12204 are from a human who is not the PR's author, are not a bot or a "not written by a human" QA-swarm comment, and carry at least 20 characters that are not an acknowledgement. Review bodies are dropped: they are not comments on code. The filter is `humanReviewComments` from `coherence/validation/review-comments.ts`, run over the whole repository.
3. **Classify.** A Haiku first pass labels every comment in batches of 60 against `benchmark/corrections/rubric.md`, tuned for recall (206 batches, one fresh sub-agent each, including re-runs for comments a batch skipped). Opus confirms every candidate in batches of 50 and assigns the sub-type and the quote, at most 20 words and 200 characters (84 batches). The exact prompts are in `benchmark/corrections/prompts.md`; the raw labels are in `labels/`.
4. **Locate the fix.** PR heads are fetched over HTTPS into `refs/uml-pr-review/corpus/<n>` of a read-only PostHog clone. The fix is #95's rule (`locateFix`): the first non-merge PR commit after the comment that touches the commented file. A correction is isolable when a PR commit from before the comment still exists, so the fix is a separate commit and not a squashed or rebased whole. `before` is the fix's parent; `commentCommit` is the last PR commit before the comment.
5. **Verify.** A seeded sample of 50 isolable fixes is judged by Opus from the packet: the commit stat and the diff of the commented file (5 batches of 10).
6. **Split.** Rows from PRs merged before 2026-08-01 are the development set; the rest are held out. `heldout.sha256` is the sha256 of the held-out rows exactly as they appear in `corpus.jsonl`, in order: `grep '"split":"heldout"' corpus.jsonl | shasum -a 256`.

Limits: review threads beyond 100 per PR (4 PRs) and comments beyond 10 per thread (at most 7 threads) are not read; PRs with more than 100 commits (28) are read to their first 100; a fix that lands only in another file, or after a force-push that rewrote the earlier commits, is not isolable or not found. The repository is public, so comment bodies and diffs stay in the uncommitted working directory; only links, quotes of at most 200 characters, and labels are committed.