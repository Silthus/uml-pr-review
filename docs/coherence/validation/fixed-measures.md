# The Coherence Index under scoring v2, on #95's workflows PRs

Scoring v1 is #95's, read from the committed `prs.csv`. The current scoring is read from `coherence/validation/data/rescored.json`, the #95 index reports rescored from their stored facts. Deltas are unrounded composite points.

Regenerate: `bun coherence/validation/attribute.ts --repo ~/dev/posthog --ref 57ca357730843205c2d659098ac8e4c5e07a6698` rebuilds the reports in `/tmp/coherence-validation-reports`; `bun coherence/validation/fixed-measures.ts --reports /tmp/coherence-validation-reports` refreshes `rescored.json` and this file. Without `--reports`, it renders from the committed data alone.

## The PRs #95 called perverse or telling

| PR | Title | v1 | v2 | Judges (Opus, Astra) | Facade facts |
| --- | --- | --- | --- | --- | --- |
| [#101488](https://github.com/PostHog/posthog/pull/101488) | chore(workflows): verify SES events through ingress | +3.40 | +0.09 | 2, 2 | coverage 0/2 → 1/3 (unscored); bypasses 53 → 52, 1.11 → 1.09 per KLOC |
| [#103523](https://github.com/PostHog/posthog/pull/103523) | feat(ai): let the agent search and list workflows | −0.98 | +0.03 | 0, 1 | coverage 1/3 → 1/5 (unscored); bypasses 52 → 52, 1.04 → 1.04 per KLOC |
| [#103711](https://github.com/PostHog/posthog/pull/103711) | feat(tasks): start a goal or feature setup task for a space | −0.20 | −0.01 | 0, 1 | coverage 1/5 → 1/6 (unscored); bypasses 52 → 52, 1.04 → 1.04 per KLOC |
| [#64001](https://github.com/PostHog/posthog/pull/64001) | feat(workflows): make the builder aware of edits from MCP/API | +0.57 | +0.12 | 0, 0 | coverage 0/0 → 0/0 (unscored); bypasses 25 → 25, 1.11 → 1.10 per KLOC |
| [#97753](https://github.com/PostHog/posthog/pull/97753) | feat(workflows): create customer analytics tasks | +0.48 | +0.16 | 1, 1 | coverage 0/0 → 0/1 (unscored); bypasses 52 → 52, 1.13 → 1.12 per KLOC |
| [#66346](https://github.com/PostHog/posthog/pull/66346) | feat(customer-analytics): add "update account property" workflow action | +0.07 | +0.04 | -1, -1 | coverage 0/0 → 0/0 (unscored); bypasses 25 → 26, 1.09 → 1.13 per KLOC |
| [#76015](https://github.com/PostHog/posthog/pull/76015) | feat(workflows): surgical email patching for workflow email steps | −0.15 | −0.31 | -1, -1 | coverage 0/0 → 0/0 (unscored); bypasses 31 → 35, 1.05 → 1.18 per KLOC |
| [#78272](https://github.com/PostHog/posthog/pull/78272) | feat(workflows): materialize referenced email templates at save | −0.01 | −0.05 | -1, -1 | coverage 0/0 → 0/0 (unscored); bypasses 38 → 39, 1.25 → 1.28 per KLOC |

## All 321 PRs against the blind judges

| Scoring | Movers (Δ beyond ±0.2) | Improved / worsened | Spearman vs judges (64 judged) | Sign agreement on leaning movers |
| --- | --- | --- | --- | --- |
| scoring v1 (#95) | 13 | 8 / 5 | 0.038 | 7/11 |
| scoring v2, tests weight 10 | 9 | 3 / 6 | -0.009 | 3/7 |
| scoring v2, tests weight 0 | 14 | 8 / 6 | -0.011 | 3/8 |
| scoring v2, tests weight 20 | 11 | 5 / 6 | 0.062 | 3/7 |

The #95 judge data cannot tell tests weights of 0, 10, and 20 apart: with 64 judged PRs the standard error of a Spearman coefficient is about 0.13. The weight 10 is a judgement call. 15 test-only PRs: the largest composite move is 0.020 under scoring v1 and 0.016 under v2.

## Movers under scoring v2

| PR | Δ | Judges (Opus, Astra) | Bypasses and cycles |
| --- | --- | --- | --- |
| [#104165](https://github.com/PostHog/posthog/pull/104165) | −0.53 | 0, 1 | bypasses +0/−0; cycle files +3/−0 |
| [#78182](https://github.com/PostHog/posthog/pull/78182) | −0.36 | 0, 1 | bypasses +2/−0; cycle files +0/−0 |
| [#76808](https://github.com/PostHog/posthog/pull/76808) | −0.34 | 0, 1 | bypasses +3/−0; cycle files +0/−0 |
| [#76015](https://github.com/PostHog/posthog/pull/76015) | −0.31 | -1, -1 | bypasses +4/−0; cycle files +0/−0 |
| [#95047](https://github.com/PostHog/posthog/pull/95047) | −0.30 | -1, 0 | bypasses +0/−0; cycle files +2/−0 |
| [#66988](https://github.com/PostHog/posthog/pull/66988) | −0.25 | —, — | bypasses +2/−0; cycle files +0/−0 |
| [#82343](https://github.com/PostHog/posthog/pull/82343) | +0.26 | -1, 0 | bypasses +0/−0; cycle files +0/−0 |
| [#94113](https://github.com/PostHog/posthog/pull/94113) | +0.29 | 1, 1 | bypasses +0/−0; cycle files +0/−0 |
| [#65974](https://github.com/PostHog/posthog/pull/65974) | +0.40 | 0, 0 | bypasses +0/−0; cycle files +0/−0 |
