# Architecture correction corpus: PostHog, six months

`corpus.jsonl` holds one row per human architecture correction left on code in a merged `PostHog/posthog` pull request, with links, a short quote, the product, the sub-type, the located fix commit, and the time split. Regenerate this file with `bun benchmark/corrections/run.ts corpus`; the method and the stages are below.

- **Window:** PRs merged from 2026-03-27 through 2026-09-26.
- **Split:** the development set is PRs merged before 2026-08-01; the held-out set is PRs merged on or after it. The held-out rows hash to `0f4580b5f5c2f74330ea79af55c4d9c9991f8901b29c99129ce0b7f89c4ae851` (`heldout.sha256`). They are never used for tuning.

## Counts

|  | development | held-out | total |
| --- | --- | --- | --- |
| merged PRs | 15346 | 10097 | 25443 |
| human comments on code (non-author, non-bot) | 6972 | 5011 | 11983 |
| first-pass candidates | 2485 | 1592 | 4077 |
| confirmed architecture corrections | 933 | 472 | 1405 |
| with a located fix commit | 816 | 429 | 1245 |
| isolable, with a fix | 534 | 300 | 834 |
| fixes verified by reading the diff | 50 | 0 | 50 |
| verified fixes that address the comment fully | 34 | 0 | 34 |
| verified fixes that address it fully or partly | 36 | 0 | 36 |

## By sub-type

|  | development | held-out | isolable with a fix | total |
| --- | --- | --- | --- | --- |
| reuse | 257 | 127 | 221 | 384 |
| layer | 170 | 59 | 137 | 229 |
| facade-boundary | 12 | 10 | 15 | 22 |
| dependency | 18 | 14 | 17 | 32 |
| duplication | 185 | 119 | 194 | 304 |
| split-merge | 81 | 48 | 77 | 129 |
| naming | 75 | 37 | 65 | 112 |
| other | 135 | 58 | 108 | 193 |

## By product (top 15)

|  | development | held-out | isolable with a fix | total |
| --- | --- | --- | --- | --- |
| frontend/scenes | 117 | 34 | 86 | 151 |
| posthog/temporal | 61 | 5 | 44 | 66 |
| posthog/api | 45 | 18 | 42 | 63 |
| feature_flags | 17 | 44 | 53 | 61 |
| frontend/lib | 41 | 10 | 25 | 51 |
| signals | 40 | 8 | 29 | 48 |
| ai_observability | 20 | 23 | 37 | 43 |
| nodejs/ingestion | 33 | 6 | 29 | 39 |
| tasks | 28 | 9 | 18 | 37 |
| rust/feature-flags | 19 | 17 | 26 | 36 |
| rust/cohort-stream-processor | 20 | 15 | 18 | 35 |
| posthog/models | 24 | 7 | 12 | 31 |
| replay_vision | 10 | 19 | 14 | 29 |
| dashboards | 19 | 7 | 12 | 26 |
| nodejs/cdp | 12 | 13 | 12 | 25 |

## Classifier recall

Opus re-labelled a seeded random sample of 200 first-pass negatives from the development set and found 4 architecture corrections among them. Scaled to all development negatives, the first pass keeps an estimated **91.2%** of the corrections Opus would confirm (95% Wilson interval 80.5% to 96.4%). This is recall relative to Opus, the labeller of record; Opus's own errors are not measured here.

## Fix precision

Opus read the diffs of a seeded random sample of 50 isolable located fixes from the development set: 34 address the comment, 2 partly, 14 do not, and 0 cannot be told. The fix locator's precision is **68.0%** for full fixes (95% Wilson interval 54.2% to 79.2%) and **72.0%** counting partial fixes (58.3% to 82.5%). The `verified` column carries the answer for the sampled rows and is empty for the rest, including every held-out row.

## Method

1. **Collect.** `gh api graphql` search, one UTC day per window, lists every merged PR with its files, base, head, and counts (25443 PRs). A second pass fetches review threads (up to 100 per PR, 10 comments each), review bodies, and commits with timestamps for the 15612 PRs that have review threads, sizing each connection to its count so a query costs what it returns. Every raw response is cached on disk by the hash of its query, and the client waits for the rate-limit reset when fewer than 400 points remain. The run took 770 queries and 1503 GraphQL points.
2. **Filter.** Of 109096 inline comments, 11983 are from a human who is not the PR's author, are not a bot, do not declare themselves AI-written (a leading 🤖, "AI reply:", "Agent-drafted", "AI-suggested", "posted by Claude", or the QA swarm's "not written by a human"), and carry at least 20 characters that are not an acknowledgement. Review bodies are dropped: they are not comments on code. The filter is `humanReviewComments` from `coherence/validation/review-comments.ts`, run over the whole repository.
3. **Classify.** A Haiku first pass labels every comment in batches of 60 against `benchmark/corrections/rubric.md`, tuned for recall (206 batches, one fresh sub-agent each, including re-runs for comments a batch skipped). Opus confirms every candidate in batches of 50 and assigns the sub-type and a verbatim quote of at most 200 characters, asked to stay within 20 words (85 batches). The exact prompts are in `benchmark/corrections/prompts.md`; the raw labels are in `labels/`, as written, including 9 labels whose id a labeller mistyped and which match no collected comment, so they are ignored. A comment labelled twice by the first pass stays a candidate if either label says so; conflicting confirmations stop the run.
4. **Locate the fix.** PR heads are fetched over HTTPS into `refs/uml-pr-review/corpus/<n>` of a read-only PostHog clone. The fix is #95's rule (`locateFix`): the first non-merge PR commit after the comment that touches the commented file. A correction is isolable when a PR commit from before the comment still exists, so the fix is a separate commit and not a squashed or rebased whole. `before` is the fix's parent; `commentCommit` is the last PR commit before the comment.
5. **Verify.** A seeded sample of 50 isolable development fixes is judged by Opus from the packet: the commit stat and the diff of the commented file (5 batches of 10).
6. **Split.** Rows from PRs merged before 2026-08-01 are the development set; the rest are held out. The recall and verification samples come from the development set only, and both are drawn by ranking items on the sha256 of `98:<comment id>`, so a sample is stable when other items come or go. `heldout.sha256` is the sha256 of the held-out rows exactly as they appear in `corpus.jsonl`, in order: `grep '"split":"heldout"' corpus.jsonl | shasum -a 256`.

Limits: review threads beyond 100 per PR (4 PRs) and comments beyond 10 per thread (at most 7 threads) are not read; PRs with more than 100 commits (28) are read to their first 100; a fix that lands only in another file, or after a force-push that rewrote the earlier commits, is not isolable or not found. The repository is public, so comment bodies and diffs stay in the uncommitted working directory; only links, quotes of at most 200 characters, and labels are committed.