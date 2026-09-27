# Does the Coherence Index see real quality changes? `products/workflows`, 2026-03 to 2026-09

Ticket [#94](https://github.com/Silthus/uml-pr-review/issues/94). PostHog `upstream/master` pinned at [`57ca3577`](https://github.com/PostHog/posthog/commit/57ca357730843205c2d659098ac8e4c5e07a6698). Scope `products/workflows`.

## Verdict

**The index is weak as a per-PR grade.** It tracks slow structural trends, but it barely reacts to single PRs. When it does react, it mostly reacts to artefacts.

- **Human corrections.** Reviewers asked for 9 architecture fixes that we can isolate to a commit. The index moved the right way on 1 of them, stayed blind on 7, and moved the wrong way on 1. The diff-local prototype caught 2, was blind on 6, and went the wrong way on 1.
- **Blind judges.** Across 321 PRs in three months, the composite moved by at least 0.2 for only 24 PRs (7%). On the 64 judged PRs, it has no rank correlation with the judges: Spearman 0.01, against 0.62 between the two judges. On PRs that both judges agree changed quality, the index is flat on about 94% of them.
- **Where the movement comes from.** Two facade measures produced 4.0 of the quarter's +6.0 points. Both are ratios, and both behave perversely (see [Perverse measures](#perverse-measures)). One of them also accounts for both of error_tracking's headline movers in the [index report](../index-report.md).
- **What to do.** Keep the index for trends, with the facade measures fixed. For PR grading, build a function- and import-level diff signal plus checks that the index cannot express (reuse, layer placement, vocabulary). Reweighting the current measures does not help: no rescoring or ablation we tried beats Spearman 0.10 against the judges.

## 1. Human architecture corrections (primary)

**Question:** when a reviewer asks for a structural change and the author makes it, does the index move the way the reviewer asked?

### Counts

| Step | Count |
| --- | --- |
| Merged PRs touching `products/workflows` since 2026-03-01 (the harvest window) | 500 |
| Human review comments on scope files, by someone other than the PR author (bots and 13 "not written by a human" QA-swarm comments dropped) | 158 |
| Classified as an architecture correction (Opus, [rubric](../../../coherence/validation/corrections/rubric.md), [labels](../../../coherence/validation/corrections/labels/)) | 14 on 9 PRs |
| With an identifiable fix commit that still exists | 14 |
| **Isolable**: a PR commit from before the comment survives, so the fix is its own commit and not a squashed or rebased whole | **9** |

The three-month window alone held too few corrections, so this uses the whole harvest window. Architecture corrections are rare in workflows review: 14 of 158 human comments (9%).

The fix commit is the first non-merge PR commit after the comment that touches the commented file, or any file in the scope for a review body. Each fix is scored against its own parent. Everything between the comment and that parent leaves the commented file untouched, so the parent is the state the reviewer saw.

### Catch rate

| Signal (isolable corrections, n = 9) | Moved as asked | Blind | Moved the other way |
| --- | --- | --- | --- |
| Scope-level composite, \|Δ\| ≥ 0.2 | **1** | 7 | 1 |
| Scope-level composite, any Δ ≥ 0.1 | 2 | 3 | 4 |
| Diff-local score (≠ 0) | **2** | 6 | 1 |

Across all 14 corrections: composite 2 / 11 / 1, diff-local 2 / 9 / 3. Per-correction rows are in [`corrections.csv`](corrections.csv) and [`corrections-tables.md`](corrections-tables.md).

### Case studies

| Correction | Fix | Index | Diff-local | Why |
| --- | --- | --- | --- | --- |
| [#51875](https://github.com/PostHog/posthog/pull/51875#discussion_r2998199827): "pretty clean to limit that responsibility to the poller" | [`df69d9b`](https://github.com/PostHog/posthog/commit/df69d9b301d6343d17debdd06139994b42c34d71) removes the `post_save` schedule signals | **+0.7** (cycleShare +8.1) | **+5** | **Caught.** The signals had closed a 3-file import cycle (`schedule_sync` ↔ `hog_flow_schedule`). Removing them broke it. Cycles are the one structural fact the index sees reliably. |
| [#51875](https://github.com/PostHog/posthog/pull/51875#discussion_r2997760124): "most of the fields in this model are just duplicated data" | [`29995de`](https://github.com/PostHog/posthog/commit/29995def6ccb6485d21086b859cc70142383ee3e) deletes `HogFlowScheduledRun` | **−1.2** (cycleShare −8.8) | +10 | **Wrong way, for a real reason.** Deleting the duplicate model is invisible to the index: jscpd looks for text clones, not duplicated data. The same commit wired `schedule_sync` into the new model and created the cycle that the next correction removed. Diff-local is positive only because the 4 inbound bypasses into the old model and `schedule_sync` disappeared with them. |
| [#89643](https://github.com/PostHog/posthog/pull/89643#discussion_r3911807455): "this is a crazy long function to parse" | [`081c668`](https://github.com/PostHog/posthog/commit/081c66838608d2bdbb367ff53fd8803501d0eff1) splits the ISP fan-out into phases | −0.1 | 0 | **Blind.** `get_identity_isp_metrics` (CCN 29) drops out of the CCN > 20 set (shareOverTwenty +1). But p90 function NLOC over 2,700 functions nudges down, and the new helpers add 2 `Any` escapes, so the moves cancel. The request was about one function; the measures are scope percentiles and densities. |
| [#72667](https://github.com/PostHog/posthog/pull/72667#pullrequestreview-4807627642): "newer more customisable version of this component that would be better" | [`94dd94a`](https://github.com/PostHog/posthog/commit/94dd94a28387f487e272d1b9ac5c5b67fb9ecfae) rebuilds the tiles on quill's `Metric` | −0.1 | −1 | **Wrong way (diff-local), blind (index).** Reusing a shared component has no measure. The adapter adds one CCN > 10 function, so both signals lean negative. |
| [#85156](https://github.com/PostHog/posthog/pull/85156#discussion_r3811770267): "Might be better to filter by the message on server side" | [`0b4e426`](https://github.com/PostHog/posthog/commit/0b4e426763f9cb02e59b5e1d589d6f12411c8029) moves the filter into the API | 0 | 0 | **Blind.** Moving a responsibility between layers (kea logic to Django API) changes no import edge, no complexity threshold, and no lint. |
| [#59468](https://github.com/PostHog/posthog/pull/59468#discussion_r3347822341): "handle all of this on the serializer level" | [`d018183`](https://github.com/PostHog/posthog/commit/d0181832015f7650df9a3e87646a6032d2090948) | +0.1 | 0 | **Blind.** Same kind as above: validation moves from the trigger UI to the serializer. |
| [#49670](https://github.com/PostHog/posthog/pull/49670#discussion_r2879038689): "Do we refer to workflows as hogflows? … align it with the documentation" | [`bfe5d6a`](https://github.com/PostHog/posthog/commit/bfe5d6a54cae472c0d798eb0d7e523f5422bd5a4) renames in `mcp/tools.yaml` | 0 | 0 | **Blind by construction.** YAML is not measured, and no measure knows the domain vocabulary, although [`rules.json`](../../harvest/workflows/rules.json) lists "hogflow" as a term to avoid. |
| [#47035](https://github.com/PostHog/posthog/pull/47035#discussion_r2877422332): "would be cool to move this into `registry/triggers/`" (not isolable) | [`3c6bdd0`](https://github.com/PostHog/posthog/commit/3c6bdd040d512dbc29c05e9092ae82a66bdb05ff) is the whole squashed feature | +0.3 | −7 | **Not a test of the move.** The branch was rebased, so the fix is the whole feature. The index's +0.3 is test ratio from the feature's tests; diff-local's −7 is its new `any` escapes. |

### Why the misses happen, and what would catch them

| Miss | Measure that should have caught it | Why it did not | Improvement |
| --- | --- | --- | --- |
| Reuse an existing component or helper (#72667 ×2; #58152, #72913 not isolable) | duplication | jscpd only sees text clones inside the scope; a re-implementation of a `lib/` or quill component is not a clone | Cross-scope reuse check: flag new exported symbols whose name or signature matches an existing shared symbol, and run clone detection against `frontend/src/lib` and shared packages, not only the scope |
| Move logic to the right layer (#85156, #59468) | none | Layer placement is not a graph property the index knows | Encode the ladder's structural rules from `rules.json` as checks (the ladder carries weight 0 today); a rule such as "validation lives in serializers" becomes a countable violation |
| Rename a concept (#49670) | none | Vocabulary is not measured, and YAML is out of scope | A vocabulary measure: occurrences of the `avoid` terms from the harvested vocabulary in identifiers, strings, and MCP/skill YAML |
| Split a long function (#89643) | complexity | Scope p90s and shares barely move for one function out of 2,700 | Diff-local, function-level: CCN and NLOC of the functions the commit touched, before and after, matched by name |
| Remove duplicated data (#51875) | none | A duplicated model is a schema fact, not a text clone | Out of reach for static metrics; leave it to review |
| Remove a dependency cycle (#51875) | cycleShare | Caught | Keep |

## 2. Three months of PRs against blind judges

Every first-parent commit on `upstream/master` since 2026-06-27 that touches `products/workflows` (321, each one squash-merged PR) was scored at its parent and at itself. The full tables are in [`tables.md`](tables.md), and every PR is in [`prs.csv`](prs.csv).

### How often the index moves

| Composite Δ | PRs |
| --- | --- |
| 0.0 | 236 (74%) |
| ±0.1 | 61 (19%) |
| ≥ +0.2 (improved) | 16 |
| ≤ −0.2 (worsened) | 8 |

**PR threshold ±0.2.** The composite is a weighted mean of dimension scores that are already rounded to 0.1, and the composite is rounded again. So a true change of about 0.03 can show as ±0.1. A move of 0.2 or more is the smallest one that cannot be only rounding. It is also the 95th percentile of |Δ| (the p90 is 0.1). The report's weekday band of ±0.6 covers a whole day of about four workflows PRs, so a single-PR threshold has to sit below it. Recomputed without rounding, only 13 PRs move by 0.2 or more: rounding alone inflates the mover count by about 80%.

By type (improved / flat / worsened): feat 12 / 171 / 7, fix 1 / 88 / 1, chore 3 / 32 / 0, perf 0 / 4 / 0, refactor 0 / 2 / 0.

In 16 PRs the delta came partly from outside the scope: inbound facade crossings changed because another product started or stopped importing workflows.

### Judges and the ceiling

We judged 64 PRs: all 24 non-flat PRs, plus 40 flat PRs sampled at random and stratified by type (seed 94).
- Judge 1 was a fresh Opus sub-agent. Judge 2 was Astra 6 (`gpt-6-astra`, read-only).
- Both used one [rubric](../../../coherence/validation/judgements/rubric.md) and saw only the title and the diff, truncated to 30k characters with a truncation note.
- Their [prompts and raw outputs](../../../coherence/validation/judgements/) are committed.

| | Value |
| --- | --- |
| Cohen's kappa on the sign (−, 0, +) | **0.23** |
| Spearman on the −2..+2 scale | **0.62** |
| Score histograms, −2 / −1 / 0 / +1 / +2 | Opus 0 / 15 / 39 / 9 / 1; Astra 0 / 5 / 24 / 30 / 5 |

The judges rank PRs alike, but Astra is much more lenient: 23 PRs are 0 for Opus and positive for Astra. The sign-level ceiling is therefore low. The rank ceiling of 0.62 is the fairer yardstick.

### Index against judges

| | Value |
| --- | --- |
| Spearman(composite Δ, mean judge), all 64 | **0.01** |
| Spearman, the 24 non-flat only | 0.25 |
| Sign agreement on non-flat PRs where the judges lean one way | 11 / 20 (55%) |
| Kappa, index class against Opus / Astra | 0.18 / 0.07 (mostly agreement on "neutral") |

| Index class | Judged | Judges: better | Judges: neutral | Judges: worse |
| --- | --- | --- | --- | --- |
| improved | 16 | 8 | 4 | 4 |
| flat | 40 | 20 | 14 | 6 |
| worsened | 8 | **5** | 0 | 3 |

**Blindness.**
- **Loose rule** (judge mean ≥ 0.5 or ≤ −0.5): 26 of the 40 flat samples are a quality change. Scaled to 297 flat PRs, that is about 193 PRs, against 20 non-flat. The index is blind to **about 91%** of quality-changing PRs.
- **Strict rule** (both judges give the same non-zero sign): about 74 blind PRs against 5 moved, so **about 94%** blind.
- Five of the 8 "worsened" PRs are better to the judges.

### Per dimension and measure

| Measure | PRs moved (of 321) | Share of all movement | Spearman vs judges | Sign agreement where it moved |
| --- | --- | --- | --- | --- |
| tests.facadeCoverage | 3 | **17%** | 0.05 | 1/3 |
| tests.testRatio | 168 | 14% | 0.15 | 24/37 |
| architecture.facadeShare | 30 | 11% | 0.20 | 12/18 |
| architecture.cycleShare | 85 | 9% | 0.01 | 16/25 |
| smells.ruffPerKloc | 109 | 9% | −0.11 | 12/24 |
| architecture.propagationCost | 84 | 7% | −0.14 | 12/24 |
| smells.duplicationPercentage | 138 | 7% | 0.19 | 24/33 |
| complexity.shareOverTwenty | 74 | 6% | −0.07 | 10/20 |
| complexity.shareOverTen | 110 | 4% | 0.04 | 10/24 |
| complexity.p90FunctionNloc | 12 | 4% | 0.14 | 3/5 |
| smells.typeEscapesPerKloc | 128 | 4% | −0.10 | 15/30 |
| complexity.p90FileLines | 31 | 3% | 0.19 | 7/10 |
| complexity.p90Ccn | 1 | 2% | −0.07 | 0/1 |
| smells.markersPerKloc | 87 | 2% | −0.19 | 12/22 |
| smells.oxlintPerKloc | 34 | 1% | −0.08 | 3/5 |

No single measure reaches |Spearman| 0.2 against the judges. Duplication and facade share come closest, and they are the only measures right about three times in four when they move. Complexity, lint, type escapes, and markers are at or below chance. By dimension, Spearman is architecture 0.13, complexity 0.03, smells −0.05, and tests 0.14.

**Does a big feature read as worse?** No. The 43 features with 300 or more production lines average +0.03 composite (7 improved, 5 worsened), and the judges average +0.16. File growth barely registers because p90 file lines moved on only 11 of them.

**Do test-only PRs improve the index?** No. All 15 test-only PRs moved the composite by exactly 0.0. One test line is about 1/53,000 of the ratio's denominator.

### Perverse measures

1. **`tests.facadeCoverage`: a tiny denominator decides the quarter.** Workflows had 0 to 6 facade functions in the whole window (524 of 647 scored trees had none). A scope with no facade scores 0 (`share ?? 0`), so adding untested facade functions costs nothing at first. After that, each new function swings the tests dimension by 2 to 17 points.
   - The three PRs that moved it account for 17% of all index movement and +1.67 composite over the quarter.
   - Adding facade functions is punished: [#103523](https://github.com/PostHog/posthog/pull/103523) added two, coverage went from 1/3 to 1/5, and the composite fell −1.0. The judges scored it 0 and +1 because it keeps AI callers off the models.
   - The conductor's swing (26.3 → 42.1 → 33.8 on tests) is [#101488](https://github.com/PostHog/posthog/pull/101488) (+3.4, coverage 0/2 to 1/3) followed by #103523 and [#103711](https://github.com/PostHog/posthog/pull/103711).
   - The same artefact explains error_tracking's headline movers in the [index report](../index-report.md): the facade kickoff (+10.4) is coverage going from 0 to 5/5, and the −4.6 is 5/5 to 9/18.
2. **`architecture.facadeShare`: saturated, and asymmetric.**
   - The share sat at 0.03 to 0.2, near the worst anchor. 18 PRs added a facade bypass, and the largest resulting drop was −0.5 measure points (about −0.06 composite).
   - Meanwhile one new compliant crossing is worth about +0.4 composite. So the measure rewards adding coupling through a facade and ignores new violations.
   - [#66346](https://github.com/PostHog/posthog/pull/66346) (customer_analytics importing `workflows/backend/services`) is a new inbound bypass. Both judges scored it −1; the index moved 0.0.
   - Facade share also produced +2.35 of the quarter's +6.0.
3. **`tests.testRatio` measures size, not testing.** It is the most frequently moving measure (168 PRs). Among big features it falls on 20 and rises on 16, depending only on whether test lines outpace production lines. Test-only PRs never move it visibly.
4. **Scope percentiles do not move for one PR.** p90 CCN moved once in 321 PRs; p90 function NLOC moved 12 times.
5. **Null handling.** No crossings scores facade share 100, and no facade scores coverage 0. The first never happened in workflows (30 to 65 crossings), but it rewards a product for having no cross-product imports at all, including through its facade.

### Rescoring and ablations (from the stored measures, unrounded)

| Variant | Movers (\|Δ\| ≥ 0.2) | Spearman vs judges |
| --- | --- | --- |
| Current weights | 13 | 0.04 |
| Facade coverage dropped below 5 functions | 14 | 0.05 |
| Facade coverage Laplace-smoothed, (covered + 1) / (functions + 2) | 15 | −0.04 |
| Facade measures as counts (untested facade functions, 0 to 10; bypasses, 0 to 40) | 17 | 0.01 |
| Best single ablation: without facadeCoverage | 14 | 0.10 |

The gate creates a cliff at 5 functions: with it, #103523 becomes −2.7. Smoothing and counts remove the perverse jumps but add no signal. The measures do not contain what the judges react to, so no reweighting fixes the per-PR grade.

### Diff-local prototype

The prototype applies the same tools to only the files a PR changes, before versus after. It counts:
- functions over CCN 10 (×1) and CCN 20 (×2);
- ruff and oxlint findings;
- type escapes and markers;
- facade bypasses touching a changed file (×3);
- changed files on a cycle.

| Signal | Moves | Judged PRs it moves | Spearman vs judges | Sign agreement where it moves |
| --- | --- | --- | --- | --- |
| Scope composite, \|Δ\| ≥ 0.2 | 24 / 321 (7%) | 24 / 64 | 0.01 | 11/20 (55%) |
| Diff-local count | 111 / 321 (35%) | 30 / 64 | **0.20** | 11/27 (41%) |
| Diff-local per KLOC of changed files | 83 / 321 (26%) | 27 / 64 | −0.01 | 11/22 (50%) |

Diff-local is five times as sensitive and ranks a little better, but it is not more often right. New code brings new findings, so a feature reads as worse. It is the right shape for PR grading, but not with whole-file counts.

### Biggest movers

The top three each way. Ten each way, with drivers and both judges' reasons, are in [`tables.md`](tables.md#top-10-improvers).

| PR | Δ | What moved | Judges (Opus, Astra) | Real or artefact |
| --- | --- | --- | --- | --- |
| [#101488](https://github.com/PostHog/posthog/pull/101488) verify SES events through ingress | +3.4 | facadeCoverage +3.33: the first tested facade function | +2, +2 | Right direction, wrong reason. It deletes a 181-line bespoke verifier and enters through a facade; 98% of the delta is the coverage ratio. |
| [#64001](https://github.com/PostHog/posthog/pull/64001) builder aware of MCP/API edits | +0.6 | facadeShare: one compliant outbound crossing | 0, 0 | Artefact of the saturated share |
| [#97753](https://github.com/PostHog/posthog/pull/97753) customer analytics tasks | +0.5 | facadeShare: two compliant inbound crossings; a new facade function | +1, +1 | Agrees; it really adds a facade entry point |
| [#103523](https://github.com/PostHog/posthog/pull/103523) agent can search workflows | −1.0 | facadeCoverage 1/3 → 1/5 | 0, +1 | Perverse: punished for adding facade functions |
| [#104165](https://github.com/PostHog/posthog/pull/104165) restore template autocomplete | −0.5 | a 3-file import cycle (config component ↔ test-panel logic) | 0, +1 | Real coupling that Opus noticed in words but did not score |
| [#95047](https://github.com/PostHog/posthog/pull/95047) flagged tree builder | −0.4 | 2 files on a new cycle, test ratio −0.17 | −1, 0 | Agrees: the new cycle is real and the lower test ratio is incidental; the judges point at the 480-line growth of the editor logic |

**Biggest disagreements** (full list in [`tables.md`](tables.md#biggest-disagreements)):
- **Deletions and extractions are flat.** [#91458](https://github.com/PostHog/posthog/pull/91458) deleted a one-off banner and its 270-line logic (judges +1, +2). [#105744](https://github.com/PostHog/posthog/pull/105744) extracted shared tab actions (+1, +2). [#87696](https://github.com/PostHog/posthog/pull/87696) removed a rolled-out flag (+1, +1). Deleting good-average code does not move densities.
- **Copy-paste and coupling are flat too.** [#71078](https://github.com/PostHog/posthog/pull/71078) copy-pasted the email metrics path for push (−1, −1). [#78272](https://github.com/PostHog/posthog/pull/78272) added direct `MessageTemplate` coupling (−1, −1). [#66346](https://github.com/PostHog/posthog/pull/66346) added an inbound bypass (−1, −1).

## 3. Recommendations, in order

1. **Do not grade single PRs with the scope composite.** It is blind to about 9 in 10 quality changes, and its moves do not rank with judges or reviewers.
2. **Replace the two facade ratios with counts.** Use untested facade functions and facade bypasses, each against a fixed anchor, so that every violation costs the same whatever the denominator. Until then, report coverage without scoring it. Also drop the `?? 0` and `?? 1` null scores. The error_tracking and workflows headline movers in the index report should be re-read as artefacts.
3. **Compute deltas unrounded.** Rounding the dimension scores and then the composite creates 11 of the 24 PRs that move by 0.2 or more.
4. **Keep cycles.** A cycle is the one structural signal that both caught a human correction and matched the judges on its movers.
5. **Build PR grading as a diff signal, not a scope score:**
   - function-level before/after for the functions a PR touches (CCN, NLOC, matched by name);
   - new cross-product imports into non-facade paths (bypasses touching changed files, which #66346, #76015, and #78272 would have tripped);
   - new or broken cycles;
   - no penalty for sheer new code.
6. **Add what reviewers actually ask for.** Reuse detection against shared code, `rules.json` ladder rules as checkable violations (layer placement), and a vocabulary check. These cover 5 of the 9 isolable human corrections.
7. **Leave the p90s for trends.** p90 CCN moved on 1 of 321 PRs; it is a scope statistic and should stay one.

## Method, reproduction, and limits

```sh
bun coherence/validation/attribute.ts --repo ~/dev/posthog --ref 57ca357730843205c2d659098ac8e4c5e07a6698   # 321 PRs, parent and commit
bun coherence/validation/packets.ts --repo ~/dev/posthog                                                   # judge packets (diffs stay in /tmp)
bun coherence/validation/judge-astra.ts                                                                    # Astra judge; Opus judges run as sub-agents with judge-prompt.ts
bun coherence/validation/diff-local.ts --repo ~/dev/posthog
bun coherence/validation/analyse.ts                                                                        # prs.csv and tables.md
bun coherence/validation/review-comments.ts --repo ~/dev/posthog                                           # review comments to classify
bun coherence/validation/corrections.ts --repo ~/dev/posthog                                               # fetches PR heads into refs/uml-pr-review/validation/*
bun coherence/validation/corrections-report.ts                                                             # corrections.csv and corrections-tables.md
```

Limits:
- **Small samples.** The corrections sample is small: 9 isolable. The judge sample is 64 PRs, with the flat PRs sampled rather than all judged.
- **Truncated diffs.** Judges saw diffs truncated at 30k characters; most large PRs say "truncated" in their reasons.
- **Lenient judge.** Astra's leniency lowers the sign ceiling.
- **Fix commits.** The fix commit is the first commit touching the commented file, which assumes the author fixed it right away. Five corrections on rebased branches cannot be isolated and are reported separately.
- **Top-10 drivers.** Driver lists are the index's top 10, so "entered" can reflect a shift of the cut rather than a new function.
- **Found on the way.** The indexer's `ExtractionStore` sets no SQLite `busy_timeout`, so two processes indexing the same repository can fail with `SQLITE_BUSY`. The index's own blob cache sets one.
