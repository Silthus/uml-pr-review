# Does the Coherence Index see real quality changes? `products/workflows` PRs and review corrections

Ticket [#94](https://github.com/Silthus/uml-pr-review/issues/94). PostHog `upstream/master` pinned at [`57ca3577`](https://github.com/PostHog/posthog/commit/57ca357730843205c2d659098ac8e4c5e07a6698) (2026-09-26). Scope `products/workflows`. Two windows:
- **Blind-judge set:** 321 PRs merged from 2026-06-27.
- **Review corrections:** PRs merged from 2026-03-01, the harvest window.

## Verdict

**The index is weak as a per-PR grade.** It tracks slow structural trends, but it barely reacts to single PRs. When it does, its "worse" signal is mostly wrong.

- **Human corrections.** Reviewers asked for structural changes in 8 fix commits that we could isolate and that we checked by hand. The index moved as asked on 1, stayed blind on 6, and went the other way on 1. The diff-local prototype moved as asked on 2 (one only because a deleted file took its inbound imports with it), stayed blind on 5, and went the other way on 1.
- **Blind judges.** Over 321 PRs, the unrounded composite moved by 0.2 or more on 13 PRs (4%).
  - On the 64 judged PRs, Spearman against the mean judge score is 0.04. The two judges agree with each other at 0.62.
  - Weighted to all 321 PRs, the index is flat on about 95% of the PRs the judges see as a quality change.
  - When it says "improved", the judges agree on 6 of 8 and disagree on none. When it says "worsened", the judges call 4 of 5 better.
- **Where the movement comes from.** Two facade measures produced 4.0 of the quarter's +6.0 composite points. Both are ratios, and both behave perversely (see [Perverse measures](#perverse-measures)). One of them also explains both of error_tracking's headline movers in the [index report](../index-report.md).
- **What to do.** Keep the index for trends, with the facade ratios made robust. For PR grading, build a function- and import-level diff signal plus checks for what reviewers actually ask for: reuse, layer placement, and vocabulary. Reweighting does not help: no rescoring or ablation we tried gets above Spearman 0.10 against the judges.

## 1. Human architecture corrections (primary)

**Question:** when a reviewer asks for a structural change and the author makes it, does the index move the way the reviewer asked?

### Counts

| Step | Count |
| --- | --- |
| Merged PRs touching `products/workflows` since 2026-03-01 | 500 |
| Human review comments on scope files by someone other than the author (bots and 13 "not written by a human" QA-swarm comments dropped) | 158 |
| Classified as an architecture correction (Opus, [rubric](../../../coherence/validation/corrections/rubric.md), [prompt](../../../coherence/validation/corrections/prompt.md), [labels](../../../coherence/validation/corrections/labels/)) | 14 comments on 9 PRs |
| With a fix commit that still exists | 14 |
| **Isolable**: a PR commit from before the comment survives, so the fix is its own commit and not a squashed or rebased whole | 9 comments |
| **Verified**: isolable, and checked by hand to address the comment fully or partly ([verification](../../../coherence/validation/corrections/verification.json)); one row per distinct fix commit | **8 fix commits** |

The three-month window held too few corrections, so this section uses the whole harvest window. Structural corrections are rare in workflows review: 14 of 158 human comments (9%).

**How a fix is located.**
- The fix commit is the first non-merge PR commit after the comment that touches the commented file, or any file in the scope for a review body. It is scored against its own parent, which leaves the commented file untouched and so shows it as the reviewer saw it.
- The by-hand check dropped one isolable comment: "we should have the boto3 type somewhere to import" ([#89643](https://github.com/PostHog/posthog/pull/89643#discussion_r3911783677)). Its first touching commit splits a function and adds `dict[str, Any]` instead.

### Catch rate

| Signal | Moved as asked | Blind | Moved the other way |
| --- | --- | --- | --- |
| Scope composite, \|Δ\| ≥ 0.2 (8 verified fixes) | **1** | 6 | 1 |
| Scope composite, any Δ ≥ 0.1 (8 verified fixes) | 2 | 3 | 3 |
| Diff-local score ≠ 0 (8 verified fixes) | **2** | 5 | 1 |
| Scope composite, \|Δ\| ≥ 0.2 (all 14 comments) | 2 | 11 | 1 |
| Diff-local score ≠ 0 (all 14 comments) | 2 | 9 | 3 |

Per-correction rows are in [`corrections.csv`](corrections.csv) and [`corrections-tables.md`](corrections-tables.md).

### Case studies

| Correction | Fix | Index | Diff-local | Why |
| --- | --- | --- | --- | --- |
| [#51875](https://github.com/PostHog/posthog/pull/51875#discussion_r2998199827): "pretty clean to limit that responsibility to the poller" | [`df69d9b`](https://github.com/PostHog/posthog/commit/df69d9b301d6343d17debdd06139994b42c34d71) removes the `post_save` schedule signals | **+0.7** (cycleShare +8.1) | **+5** | **Caught.** The signals closed a 3-file import cycle (`schedule_sync` ↔ `hog_flow_schedule`), and removing them broke it. Cycles are the one structural fact the index sees reliably. |
| [#51875](https://github.com/PostHog/posthog/pull/51875#discussion_r2997760124): "most of the fields in this model are just duplicated data" | [`29995de`](https://github.com/PostHog/posthog/commit/29995def6ccb6485d21086b859cc70142383ee3e) deletes `HogFlowScheduledRun` and adds CRUD endpoints | **−1.2** (cycleShare −8.8) | +10 | **Wrong way, and confounded.** The index cannot see the duplicate model's removal: jscpd finds text clones, not duplicated data. The same mixed commit wired `schedule_sync` into the new model and created the cycle that the next correction removed. Diff-local is positive only because the 4 inbound bypasses into the deleted model and `schedule_sync` went away with them. |
| [#89643](https://github.com/PostHog/posthog/pull/89643#discussion_r3911807455): "this is a crazy long function to parse" | [`081c668`](https://github.com/PostHog/posthog/commit/081c66838608d2bdbb367ff53fd8803501d0eff1) splits the ISP fan-out into phases | −0.1 | 0 | **Blind.** `get_identity_isp_metrics` (CCN 29) leaves the CCN > 20 set (shareOverTwenty +1). But p90 function NLOC over 2,700 functions nudges down, and the new helpers add 2 `Any` escapes, so the moves cancel. The request was about one function; the measures are scope percentiles and densities. |
| [#72667](https://github.com/PostHog/posthog/pull/72667#pullrequestreview-4807627642): "newer more customisable version of this component that would be better" | [`94dd94a`](https://github.com/PostHog/posthog/commit/94dd94a28387f487e272d1b9ac5c5b67fb9ecfae) rebuilds the tiles on quill's `Metric` | −0.1 | −1 | **Blind (index), wrong way (diff-local).** No measure sees reuse of a shared component. The adapter adds one CCN > 10 function, so both signals lean negative. |
| [#85156](https://github.com/PostHog/posthog/pull/85156#discussion_r3811770267): "Might be better to filter by the message on server side" | [`0b4e426`](https://github.com/PostHog/posthog/commit/0b4e426763f9cb02e59b5e1d589d6f12411c8029) adds a server-side filter and uses it | 0 | 0 | **Blind.** Moving a responsibility between layers (kea logic to the Django API) changes no import edge, no complexity threshold, and no lint finding. The server half lives outside the scope. |
| [#72667](https://github.com/PostHog/posthog/pull/72667#pullrequestreview-4810731966): "`WorkflowMetricCard` already computes these totals in `sumSeries`" | [`73f4f22`](https://github.com/PostHog/posthog/commit/73f4f229164028d2b383499128ebc7697bff83e1) changes quill's `Metric` | 0 | 0 | **Blind by scope.** The fix lives in `packages/quill`; workflows changes 4 lines. |
| [#49670](https://github.com/PostHog/posthog/pull/49670#discussion_r2879038689): "Do we refer to workflows as hogflows? … align it with the documentation" | [`bfe5d6a`](https://github.com/PostHog/posthog/commit/bfe5d6a54cae472c0d798eb0d7e523f5422bd5a4) renames in `mcp/tools.yaml` | 0 | 0 | **Blind by construction.** YAML is not measured, and no measure knows the domain vocabulary, although [`rules.json`](../../harvest/workflows/rules.json) lists "hogflow" as a term to avoid. |
| [#47035](https://github.com/PostHog/posthog/pull/47035#discussion_r2877422332): "would be cool to move this into `registry/triggers/`" (not isolable) | [`3c6bdd0`](https://github.com/PostHog/posthog/commit/3c6bdd040d512dbc29c05e9092ae82a66bdb05ff) is the whole squashed feature | +0.3 | −7 | **Not a test of the move.** The branch was rebased, so the fix is the whole feature. The index's +0.3 is test ratio from the feature's tests; diff-local's −7 is its new `any` escapes. |

### Why the misses happen, and what would catch them

| Miss | Measure that should have caught it | Why it did not | Improvement |
| --- | --- | --- | --- |
| Reuse an existing component or helper (#72667 ×2; #58152 and #72913, not isolable) | duplication | jscpd only sees text clones inside the scope; a re-implementation of a `lib/` or quill component is not a clone | A cross-scope reuse check: flag new exported symbols whose name or signature matches an existing shared symbol, and run clone detection against `frontend/src/lib` and shared packages, not only the scope |
| Move logic to the right layer (#85156, #59468) | none | Layer placement is not a graph property the index knows | Turn the structural rules in `rules.json` into checks (the ladder carries weight 0 today), so "validation lives in serializers" becomes a countable violation |
| Rename a concept (#49670) | none | Vocabulary is not measured, and YAML is out of scope | A vocabulary measure: occurrences of the harvested `avoid` terms in identifiers, strings, and MCP and skill YAML |
| Split a long function (#89643) | complexity | Scope p90s and shares barely move for one function out of 2,700 | Function-level diff: CCN and NLOC of the functions the commit touched, before and after, matched by name |
| Remove duplicated data (#51875) | none | A duplicated model is a schema fact, not a text clone | Out of reach for static metrics; leave it to review |
| Remove a dependency cycle (#51875) | cycleShare | Caught | Keep |

## 2. Three months of PRs against blind judges

Every first-parent commit on `upstream/master` from 2026-06-27 that touches `products/workflows` (321, one squash-merged PR each) was scored at its parent and at itself. The full tables are in [`tables.md`](tables.md); every PR is in [`prs.csv`](prs.csv).

### How often the index moves, and the threshold

| Unrounded composite \|Δ\| | PRs |
| --- | --- |
| below 0.01 | 156 |
| 0.01 to 0.05 | 107 |
| 0.05 to 0.1 | 25 |
| 0.1 to 0.2 | 20 |
| **0.2 and above** | **13** (8 improved, 5 worsened) |

The printed composite is rounded twice: the dimension scores are rounded to 0.1, and then the composite is. So a printed delta can be up to about ±0.14 away from the true one. On the printed number, 24 PRs move by 0.2 or more, but 11 of them are really 0.12 to 0.20 (see [`tables.md`](tables.md#overview)). **Classes therefore use the unrounded delta.**

**The ±0.2 threshold:**
- It is the 96th percentile of the unrounded |Δ| (p90 0.10, p95 0.18).
- It is a third of the ±0.6 weekday band, which covers about four workflows PRs.
- Below it, 90% of PRs move less than 0.1, mostly density drift from lines added or removed.

The judge sample was drawn on the printed classes before this was found: all 24 printed movers plus 40 printed-flat PRs, stratified by type (seed 94). It therefore covers all 13 unrounded movers. It also covers the 11 near-threshold PRs in full, and each sampled printed-flat PR stands for 297 / 40 ≈ 7.4 PRs in the weighted estimates.

By type (improved / flat / worsened): feat 7 / 179 / 4, fix 0 / 89 / 1, chore 1 / 34 / 0, perf 0 / 4 / 0, refactor 0 / 2 / 0. In 16 PRs part of the delta came from outside the scope: inbound facade crossings changed because another product started or stopped importing workflows.

### Judges and the ceiling

- Judge 1 was a fresh Opus sub-agent; judge 2 was Astra 6 (`gpt-6-astra`, read-only).
- Both used one [rubric](../../../coherence/validation/judgements/rubric.md) and the [same prompt](../../../coherence/validation/judgements/prompts.md).
- They saw only the title and the diff, truncated to 30k characters with a note.
- The [raw outputs](../../../coherence/validation/judgements/) hold the PR number, score, and one sentence per PR.

| | Value |
| --- | --- |
| Cohen's kappa on the sign (−, 0, +) | **0.23** |
| Spearman on the −2..+2 scale | **0.62** |
| Histograms, −2 / −1 / 0 / +1 / +2 | Opus 0 / 15 / 39 / 9 / 1; Astra 0 / 5 / 24 / 30 / 5 |

The judges rank PRs alike, but Astra is much more lenient: 23 PRs are 0 for Opus and positive for Astra. That keeps the sign-level ceiling low, so the rank ceiling of 0.62 is the fairer yardstick.

### Index against judges

These are statistics over the 64 judged PRs, which over-represent movers (20% of the sample against 4% of all PRs).

| | Value |
| --- | --- |
| Spearman(unrounded composite Δ, mean judge), all 64 | **0.04** |
| Spearman, the 13 movers only | 0.30 |
| Sign agreement on movers where the judges lean one way | 7 / 11 (64%) |
| Kappa, index class against Opus / Astra | 0.02 / 0.08 |

| Index class | Judged | Judges: better | Judges: neutral | Judges: worse |
| --- | --- | --- | --- | --- |
| improved | 8 | **6** | 2 | 0 |
| flat | 51 | 23 | 16 | 12 |
| worsened | 5 | **4** | 0 | 1 |

**Blindness, weighted to all 321 PRs.**
- **Loose rule** (judge mean ≥ 0.5 or ≤ −0.5): about 202 quality-changing PRs are flat on the index, against 11 it moves. It is **about 95% blind**.
- The loose rule counts "Opus 0, Astra +1" as a change, so it leans on Astra's leniency.
- **Strict rule** (both judges give the same non-zero sign): about 76 against 3, or **about 96% blind**.

### Per dimension and measure

| Measure | PRs moved (of 321) | Share of all movement | Spearman vs judges | Sign agreement where it moved |
| --- | --- | --- | --- | --- |
| tests.facadeCoverage | 3 | **17%** | 0.05 | 1/3 |
| tests.testRatio | 168 | 14% | 0.15 | 24/37 (65%) |
| architecture.facadeShare | 30 | 11% | 0.20 | 12/18 (67%) |
| architecture.cycleShare | 85 | 9% | 0.01 | 16/25 (64%) |
| smells.ruffPerKloc | 109 | 9% | −0.11 | 12/24 (50%) |
| architecture.propagationCost | 84 | 7% | −0.14 | 12/24 (50%) |
| smells.duplicationPercentage | 138 | 7% | 0.19 | 24/33 (73%) |
| complexity.shareOverTwenty | 74 | 6% | −0.07 | 10/20 (50%) |
| complexity.shareOverTen | 110 | 4% | 0.04 | 10/24 (42%) |
| complexity.p90FunctionNloc | 12 | 4% | 0.14 | 3/5 |
| smells.typeEscapesPerKloc | 128 | 4% | −0.10 | 15/30 (50%) |
| complexity.p90FileLines | 31 | 3% | 0.19 | 7/10 (70%) |
| complexity.p90Ccn | 1 | 2% | −0.07 | 0/1 |
| smells.markersPerKloc | 87 | 2% | −0.19 | 12/22 (55%) |
| smells.oxlintPerKloc | 34 | 1% | −0.08 | 3/5 |

**How the measures do against the judges:**
- No measure gets above |Spearman| 0.20. Facade share (0.20), duplication (0.19), and p90 file lines (0.19) come closest, and they are also right most often when they move (67%, 73%, 70%).
- Complexity, lint, type escapes, and markers are at or below chance.
- By dimension, Spearman is 0.13 for architecture, 0.03 for complexity, −0.05 for smells, and 0.14 for tests.

**Does a big feature read as worse?** No. The 43 features with 300 or more production lines average +0.03 composite (3 improved, 3 worsened). The judges average +0.16 on them. File growth barely registers: p90 file lines moved on only 11 of them.

**Do test-only PRs improve the index?** No. All 15 moved the composite by 0.0. One test line is about 1/53,000 of the ratio's denominator.

### Perverse measures

1. **`tests.facadeCoverage`: a tiny denominator decides the quarter.** Workflows had 0 to 6 facade functions throughout (524 of 647 scored trees had none).
   - A scope with no facade scores 0 (`share ?? 0`), so adding untested facade functions costs nothing at first. After that, each new function swings the tests dimension by 2 to 17 points.
   - The three PRs that moved it account for 17% of all index movement and +1.67 composite over the quarter.
   - It punishes adding facade functions. [#103523](https://github.com/PostHog/posthog/pull/103523) added two, coverage went from 1/3 to 1/5, and the composite fell by 0.98. The judges scored it 0 and +1 because it keeps AI callers off the models.
   - The swing the conductor flagged is three PRs: [#101488](https://github.com/PostHog/posthog/pull/101488) (tests 26.6 → 43.3, coverage 0/2 → 1/3), then #103523 (42.1 → 35.4), then [#103711](https://github.com/PostHog/posthog/pull/103711) (35.4 → 33.8).
   - The same artefact explains error_tracking's headline movers in the [index report](../index-report.md): the facade kickoff (+10.4) is coverage going from 0 to 5/5, and the −4.6 is 5/5 to 9/18.
2. **`architecture.facadeShare`: saturated and asymmetric.** The share sat between 0 and 0.2, with 25 to 65 crossings, near the worst anchor.
   - 18 PRs added a facade bypass. The largest resulting drop was −0.5 measure points, about −0.06 composite.
   - One new compliant crossing is worth about +0.4 composite. The measure rewards new coupling through a facade and hardly notices new violations.
   - [#66346](https://github.com/PostHog/posthog/pull/66346) made customer_analytics import `workflows/backend/services`. Both judges scored it −1; the composite moved 0.0.
   - The judges still correlate best with this measure (0.20), because compliant crossings come with work they like, such as new facade entry points. So the fault is in its asymmetry, not its direction.
   - It produced +2.35 of the quarter's +6.0.
3. **`tests.testRatio` measures size, not testing.** It moves most often (168 PRs). Among big features it falls on 20 and rises on 16, depending only on whether test lines outpace production lines.
4. **Scope percentiles do not move for one PR.** p90 CCN moved once in 321 PRs; p90 function NLOC moved 12 times.
5. **Null handling.**
   - A scope with no crossings scores facade share 100. This never happened in workflows, but it rewards a product for having no cross-product imports at all, even through its facade.
   - A scope with no facade scores coverage 0. This is the start of item 1.

### Rescoring and ablations (unrounded, from the stored measures)

| Variant | Movers | Spearman vs judges | Sign agreement on movers |
| --- | --- | --- | --- |
| Current | 13 | 0.04 | 7/11 (64%) |
| Facade coverage dropped below 5 functions | 14 | 0.05 | 6/9 |
| Facade coverage Laplace-smoothed, (covered + 1) / (functions + 2) | 15 | −0.04 | 6/12 |
| Facade measures as counts (untested facade functions, 0 to 10; bypasses, 0 to 40) | 17 | 0.01 | 6/12 |
| Without facadeCoverage (best single ablation) | 14 | 0.10 | 7/9 (78%) |
| Without facadeShare (worst) | 9 | −0.02 | 3/7 |

- **No fix recovers signal.** Gating creates a cliff at 5 functions: with it, #103523 becomes −2.7.
- **Smoothing and counts** remove the perverse jumps. In this sample they also cost a little agreement.
- **The case for counts is mechanical, not empirical:** every violation costs the same, whatever the denominator.
- The measures do not contain what the judges react to, so no reweighting fixes the per-PR grade.

### Diff-local prototype

The prototype runs the same tools over only the files a PR changes, before and after. It counts:
- functions over CCN 10 (×1) and over CCN 20 (×2);
- ruff and oxlint findings;
- type escapes and markers;
- facade bypasses touching a changed file (×3);
- changed files on a cycle.

| Signal | Moves | Judged PRs it moves | Spearman vs judges | Sign agreement where it moves |
| --- | --- | --- | --- | --- |
| Scope composite, unrounded \|Δ\| ≥ 0.2 | 13 / 321 (4%) | 13 / 64 | 0.04 | 7/11 (64%) |
| Diff-local count | 111 / 321 (35%) | 30 / 64 | **0.20** | 11/27 (41%) |
| Diff-local per KLOC of changed files | 83 / 321 (26%) | 27 / 64 | −0.01 | 11/22 (50%) |

Diff-local moves on eight times as many PRs and ranks a little better, but it is right less often. New code brings new findings, so a feature reads as worse. It is the right shape for PR grading, but not with whole-file counts.

### Biggest movers

The top three each way. Ten each way, with drivers and both judges' reasons, are in [`tables.md`](tables.md#top-10-improvers).

| PR | Δ | What moved | Judges (Opus, Astra) | Real or artefact |
| --- | --- | --- | --- | --- |
| [#101488](https://github.com/PostHog/posthog/pull/101488) verify SES events through ingress | +3.40 | facadeCoverage +3.33: the first tested facade function | +2, +2 | Right direction, wrong reason. It deletes a 181-line bespoke verifier and enters through a facade, but 98% of the delta is the coverage ratio. |
| [#64001](https://github.com/PostHog/posthog/pull/64001) builder aware of MCP/API edits | +0.58 | facadeShare: one compliant outbound crossing | 0, 0 | Artefact of the saturated share |
| [#97753](https://github.com/PostHog/posthog/pull/97753) customer analytics tasks | +0.48 | facadeShare: two compliant inbound crossings; a new facade function | +1, +1 | Agrees; it really adds a facade entry point |
| [#103523](https://github.com/PostHog/posthog/pull/103523) agent can search workflows | −0.98 | facadeCoverage 1/3 → 1/5 | 0, +1 | Perverse: punished for adding facade functions |
| [#104165](https://github.com/PostHog/posthog/pull/104165) restore template autocomplete | −0.48 | a 3-file import cycle (config component ↔ test-panel logic) | 0, +1 | Real coupling that Opus mentions in words but does not score |
| [#95047](https://github.com/PostHog/posthog/pull/95047) flagged tree builder | −0.35 | 2 files on a new cycle; test ratio −0.17 | −1, 0 | Agrees. The cycle is real; the judges point at the 480-line growth of the editor logic. |

**Biggest disagreements** (full list in [`tables.md`](tables.md#biggest-disagreements)):
- **Deletions and extractions are flat.** [#91458](https://github.com/PostHog/posthog/pull/91458) deleted a one-off banner and its 270-line logic (judges +1, +2). [#105744](https://github.com/PostHog/posthog/pull/105744) extracted shared tab actions (+1, +2). [#87696](https://github.com/PostHog/posthog/pull/87696) removed a rolled-out flag (+1, +1). Deleting average-quality code does not move densities.
- **Copy-paste and new coupling are flat too.** [#71078](https://github.com/PostHog/posthog/pull/71078) copy-pasted the email metrics path for push (−1, −1). [#78272](https://github.com/PostHog/posthog/pull/78272) coupled directly to messaging's `MessageTemplate` (−1, −1). [#66346](https://github.com/PostHog/posthog/pull/66346) added an inbound bypass (−1, −1).

## 3. Recommendations, in order

1. **Do not grade single PRs with the scope composite.** It is blind to about 19 in 20 quality changes, and its "worsened" class is mostly wrong. If it is shown per PR at all, show only large improvements. On those, the judges agreed on 6 of 8.
2. **Make the facade measures robust.** Replace the coverage ratio with a count of untested facade functions against a fixed anchor, or report it without scoring it. Make bypasses cost a fixed amount each, whatever the number of compliant crossings. Drop the `?? 0` and `?? 1` null scores. This is a mechanical fix; it does not add agreement. Re-read the error_tracking and workflows headline movers in the index report as coverage artefacts.
3. **Compute deltas unrounded.** Double rounding makes 11 of the 24 printed movers.
4. **Keep cycles.** They are the one structural signal that caught a human correction and agreed with the judges on its movers.
5. **Grade PRs with a diff signal, not a scope score.** It should look at:
   - the functions the PR touches, before and after (CCN and NLOC, matched by name);
   - new imports into another product's non-facade paths, which #66346, #76015, and #78272 would have tripped;
   - new or broken cycles.

   It should not penalise new code just for existing.
6. **Check what reviewers actually ask for.** Add reuse detection against shared code, the `rules.json` rules as checkable violations (layer placement), and a vocabulary check. These cover 5 of the 8 verified corrections.
7. **Leave the p90s for trends.** p90 CCN moved on 1 of 321 PRs; it is a scope statistic and should stay one.

## Method, reproduction, and limits

```sh
bun coherence/validation/attribute.ts --repo ~/dev/posthog --ref 57ca357730843205c2d659098ac8e4c5e07a6698   # 321 PRs, parent and commit; full reports cached in /tmp/coherence-validation-reports
bun coherence/validation/packets.ts --repo ~/dev/posthog                                                   # judge packets (diffs stay in /tmp)
bun coherence/validation/judge-astra.ts                                                                    # Astra judge; Opus judges run as sub-agents with judge-prompt.ts
bun coherence/validation/diff-local.ts --repo ~/dev/posthog
bun coherence/validation/analyse.ts                                                                        # prs.csv and tables.md
bun coherence/validation/review-comments.ts --repo ~/dev/posthog                                           # review comments to classify (bodies stay in /tmp)
bun coherence/validation/corrections.ts --repo ~/dev/posthog                                               # fetches PR heads into refs/uml-pr-review/validation/*
bun coherence/validation/corrections-report.ts                                                             # corrections.csv and corrections-tables.md
```

`analyse.ts`, `diff-local.ts`, and `corrections.ts` read the full index reports in `/tmp/coherence-validation-reports`. Those reports are not committed; `attribute.ts` regenerates them in minutes from the blob cache.

Limits:
- **Samples.** 8 verified corrections; 64 judged PRs.
- **Truncation.** Judges saw diffs truncated at 30k characters, and most large PRs say "truncated" in their reasons.
- **Judge blindness rests on instructions.**
  - The Opus judges ran in this repository with file access and were told to read only their packet. The attribution data sat next to them.
  - Astra ran from an empty directory, but its read-only sandbox can read the filesystem.
  - Their tool-call counts (3 to 12 reads per batch) fit reading the packet only, but nothing enforced it.
- **The rubric shares vocabulary with the index.** Type escapes, TODOs, large files, and coupling appear in both. That tilts the judges toward the index, so the weak agreement is, if anything, an overestimate.
- **Fix location.** The fix commit is the first commit touching the commented file. The by-hand check removed one comment where that commit did not address it.
- **Top-10 drivers.** Driver lists are the index's top 10, so "entered" can mean the cut shifted rather than that a new function appeared.
- **Found on the way.** The indexer's `ExtractionStore` sets no SQLite `busy_timeout`, so two processes indexing the same repository can fail with `SQLITE_BUSY`. The index's own blob cache sets one. This is worth its own ticket.
