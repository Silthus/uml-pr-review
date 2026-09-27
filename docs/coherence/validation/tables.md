# Blind-judge validation: generated tables

> **Historical record, scoring v1.** This file was produced by #95 under Coherence Index scoring v1 (facade share and facade coverage scored, tests weight 20, scores rounded to 0.1), as were `prs.csv`, `tables.md`, `corrections.csv`, and `corrections-tables.md`. It is not regenerated. For the same PRs under the current scoring, see [`fixed-measures.md`](fixed-measures.md).

## Overview

321 first-parent commits; 321 carry a PR number. The printed (rounded) composite moved at all (|Δ| ≥ 0.1) for 85/321 (26%). Classes use the unrounded composite delta with the PR threshold ±0.2.

| type | PRs | improved | flat | worsened |
| --- | --- | --- | --- | --- |
| chore | 35 | 1 | 34 | 0 |
| feat | 190 | 7 | 179 | 4 |
| fix | 90 | 0 | 89 | 1 |
| perf | 4 | 0 | 4 | 0 |
| refactor | 2 | 0 | 2 | 0 |
| **all** | 321 | 8 | 308 | 5 |

On the printed, rounded composite the classes would be 16 improved, 297 flat, 8 worsened; that rounded split drew the judge sample. 11 rounded movers are below the threshold unrounded (unrounded |Δ| 0.117 to 0.197), and 0 unrounded movers hide in the rounded flat class.

Composite Δ distribution: -1.0: 1, -0.5: 1, -0.4: 1, -0.2: 5, -0.1: 23, 0.0: 236, +0.1: 38, +0.2: 11, +0.3: 1, +0.4: 1, +0.5: 1, +0.6: 1, +3.4: 1.

Rounded |Δ| percentiles: p50 0, p75 0.1, p90 0.1, p95 0.2, max 3.4.

Unrounded |Δ|: below 0.01: 156, 0.01 to 0.05: 107, 0.05 to 0.1: 25, 0.1 to 0.2: 20, 0.2 and above: 13; p90 0.103, p95 0.177, p97 0.246.

Outside-driven (inbound facade crossings or bypasses changed): 16. Commits whose scope change touched no measured production file: 25, of which 0 still moved the composite.

## Inter-judge agreement (the ceiling)

64 PRs judged by both. Exact score agreement 29/64 (45%); sign agreement 31/64 (48%).

Cohen's kappa on the sign: **0.23**. Spearman on the scale: **0.62**.

Score histograms (−2 / −1 / 0 / +1 / +2): Opus 0 / 15 / 39 / 9 / 1; Astra 0 / 5 / 24 / 30 / 5.

|  | Astra + | Astra 0 | Astra − |
| --- | --- | --- | --- |
| Opus + | 10 | 0 | 0 |
| Opus 0 | 23 | 16 | 0 |
| Opus - | 2 | 8 | 5 |

## Index versus judges

Sign agreement on the 13 non-flat PRs: 7/13 (54%) counting a judge mean of 0 as disagreement; 7/11 (64%) over the 11 where the judges lean one way.

Spearman(unrounded composite Δ, mean judge): 0.04 over all 64 judged PRs; 0.30 over the non-flat ones. These are sample statistics: the sample holds every rounded mover and a random 40 of the rounded-flat PRs.

Cohen's kappa, index class against each judge's sign: Opus 0.02, Astra 0.08.

Confusion matrix (judge class from the mean score: ≥ 0.5 better, ≤ −0.5 worse):

| index class | judged | judges: better | judges: neutral | judges: worse |
| --- | --- | --- | --- | --- |
| improved | 8 | 6 | 2 | 0 |
| flat | 51 | 23 | 16 | 12 |
| worsened | 5 | 4 | 0 | 1 |

Blindness, population-weighted (each sampled rounded-flat PR stands for 7.42 PRs): of the PRs the judges see as a quality change (mean ≥ 0.5 or ≤ −0.5), about 202 flat against 11 moved, so about 95% blind. With the strict rule that both judges give the same non-zero sign, about 76 flat against 3 moved, so about 96% blind.

## Per dimension and per measure

Moved: PRs (of all) where the score moved. Share of movement: this measure's share of the summed |composite contribution| over all PRs. Spearman against the mean judge score over judged PRs. Sign agreement: where the measure moved and the judges lean one way.

| dimension | moved | Spearman vs judges | sign agreement |
| --- | --- | --- | --- |
| **architecture** | 70 | 0.13 | 18/25 (72%) |
| **complexity** | 84 | 0.03 | 11/24 (46%) |
| **smells** | 122 | -0.05 | 15/28 (54%) |
| **tests** | 124 | 0.14 | 19/31 (61%) |

| measure | moved | share of movement | Spearman vs judges | sign agreement |
| --- | --- | --- | --- | --- |
| architecture.propagationCost | 84 | 7% | -0.14 | 12/24 (50%) |
| architecture.cycleShare | 85 | 9% | 0.01 | 16/25 (64%) |
| architecture.facadeShare | 30 | 11% | 0.20 | 12/18 (67%) |
| complexity.p90Ccn | 1 | 2% | -0.07 | 0/1 (0%) |
| complexity.shareOverTen | 110 | 4% | 0.04 | 10/24 (42%) |
| complexity.shareOverTwenty | 74 | 6% | -0.07 | 10/20 (50%) |
| complexity.p90FunctionNloc | 12 | 4% | 0.14 | 3/5 (60%) |
| complexity.p90FileLines | 31 | 3% | 0.19 | 7/10 (70%) |
| smells.ruffPerKloc | 109 | 9% | -0.11 | 12/24 (50%) |
| smells.oxlintPerKloc | 34 | 1% | -0.08 | 3/5 (60%) |
| smells.duplicationPercentage | 138 | 7% | 0.19 | 24/33 (73%) |
| smells.markersPerKloc | 87 | 2% | -0.19 | 12/22 (55%) |
| smells.typeEscapesPerKloc | 128 | 4% | -0.10 | 15/30 (50%) |
| tests.testRatio | 168 | 14% | 0.15 | 24/37 (65%) |
| tests.facadeCoverage | 3 | 17% | 0.05 | 1/3 (33%) |

## Rescoring variants and ablations

The composite recomputed unrounded from the stored measures under each rule. Movers: PRs with |Δ| ≥ the PR threshold.

| variant | movers | Spearman vs judges | sign agreement on movers |
| --- | --- | --- | --- |
| current | 13 | 0.04 | 7/11 (64%) |
| facade coverage gated below 5 functions | 14 | 0.05 | 6/9 (67%) |
| facade coverage Laplace-smoothed | 15 | -0.04 | 6/12 (50%) |
| facade measures as counts (untested facade functions, bypasses) | 17 | 0.01 | 6/12 (50%) |
| without architecture.propagationCost | 16 | 0.07 | 8/13 (62%) |
| without architecture.cycleShare | 15 | 0.05 | 7/11 (64%) |
| without architecture.facadeShare | 9 | -0.02 | 3/7 (43%) |
| without complexity.p90Ccn | 14 | 0.07 | 9/12 (75%) |
| without complexity.shareOverTen | 15 | 0.04 | 8/13 (62%) |
| without complexity.shareOverTwenty | 16 | 0.04 | 8/13 (62%) |
| without complexity.p90FunctionNloc | 11 | 0.06 | 6/9 (67%) |
| without complexity.p90FileLines | 13 | 0.05 | 7/11 (64%) |
| without smells.ruffPerKloc | 14 | 0.06 | 7/11 (64%) |
| without smells.oxlintPerKloc | 14 | 0.04 | 7/12 (58%) |
| without smells.duplicationPercentage | 13 | 0.03 | 7/11 (64%) |
| without smells.markersPerKloc | 15 | 0.04 | 7/12 (58%) |
| without smells.typeEscapesPerKloc | 13 | 0.06 | 7/11 (64%) |
| without tests.testRatio | 16 | -0.01 | 7/14 (50%) |
| without tests.facadeCoverage | 14 | 0.10 | 7/9 (78%) |

## Diff-local variant against the judges

The diff-local score counts findings in the files the PR changed, before minus after: functions over CCN 10 (×1) and 20 (×2), ruff and oxlint findings, type escapes, TODO-style markers, facade bypasses touching a changed file (×3), and changed files on an import cycle. Positive means fewer findings.

| signal | PRs it moves | judged PRs it moves | Spearman vs judges | sign agreement where it moves |
| --- | --- | --- | --- | --- |
| scope-level composite (unrounded \|Δ\| ≥ 0.2) | 13/321 (4%) | 13/64 (20%) | 0.04 | 7/11 (64%) |
| diff-local score (≠ 0) | 111/321 (35%) | 30/64 (47%) | 0.20 | 11/27 (41%) |
| diff-local density per KLOC of changed files (\|Δ\| ≥ 1) | 83/321 (26%) | 27/64 (42%) | -0.01 | 11/22 (50%) |

## Targeted checks

| group | PRs | mean Δ composite | mean Δ complexity | mean Δ tests | worsened / improved | mean judge |
| --- | --- | --- | --- | --- | --- | --- |
| feat with ≥ 300 added production lines in scope | 43 | 0.03 | -0.09 | -0.03 | 3 / 3 | 0.16 (n=16) |
| test-only in scope | 15 | 0.00 | 0.00 | 0.02 | 0 / 0 | 0.25 (n=2) |
| all | 321 | 0.02 | -0.02 | 0.04 | 5 / 8 | 0.24 (n=64) |

Facade coverage moved on 3 PRs:

| PR | coverage share | Δ functions / covered | composite contribution | Δ composite | Δ composite if gated |
| --- | --- | --- | --- | --- | --- |
| [#101488](https://github.com/PostHog/posthog/pull/101488) | 0 → 0.3333 | +1 / +1 | +3.33 | +3.4 | 0.07 |
| [#103523](https://github.com/PostHog/posthog/pull/103523) | 0.3333 → 0.2 | +2 / 0 | -1.33 | -1.0 | -2.74 |
| [#103711](https://github.com/PostHog/posthog/pull/103711) | 0.2 → 0.1667 | +1 / 0 | -0.33 | -0.2 | -0.20 |

Facade share moved on 30 PRs, 16 of them through inbound crossings; a single crossing is worth about 0.46 composite points in the first of them.

## Top 10 improvers

| PR | title | Δ (unrounded) | moved most | drivers | Opus | Astra |
| --- | --- | --- | --- | --- | --- | --- |
| [#101488](https://github.com/PostHog/posthog/pull/101488) | chore(workflows): verify SES events through ingress | +3.40 | tests.facadeCoverage +3.33, complexity.p90FunctionNloc +0.10 | production lines -164; test lines -91; production files -1; p90 file lines 353→355; functions over CCN 10 -1; facade bypasses +0/−1; inbound crossings -1; duplication % +0.01; type escapes -2; facade functions +1; facade covered +1 | +2: Deletes workflows' own 181-line SNS signature verifier and bespoke webhook view, moving verification into shared ingress and entering workflows through a facade function. | +2: The visible truncated diff replaces workflow-specific webhook verification with shared ingress and a facade entry point, separating transport concerns from SES business handling. |
| [#64001](https://github.com/PostHog/posthog/pull/64001) | feat(workflows): make the builder aware of edits from MCP/API | +0.58 | architecture.facadeShare +0.46, tests.testRatio +0.08 | production lines +150; test lines +246; functions over CCN 10 +1; outbound crossings +1; duplication % -0.03 | 0: Optimistic concurrency and edit events go through the notifications facade and are well tested, but they grow the already large workflowLogic and perform_update (diff truncated). | 0: The visible truncated diff adds tested concurrency checks and notification handling, but also expands workflowLogic with reconciliation state, leaving maintainability broadly unchanged. |
| [#97753](https://github.com/PostHog/posthog/pull/97753) | feat(workflows): create customer analytics tasks | +0.48 | architecture.facadeShare +0.33, tests.testRatio +0.06 | production lines +321; test lines +439; production files +4; p90 file lines 356→355; inbound crossings +2; duplication % -0.02; facade functions +1 | +1: Adds a small workflows backend facade (get_workflow_owner_id) for other products and moves feature-flag filtering into getRegisteredActionNodeCategories; new input is tested. Diff truncated. | +1: The visible truncated diff centralizes action visibility filtering, adds a workflow-owner facade, and tests task idempotency and reference-input behavior. |
| [#88244](https://github.com/PostHog/posthog/pull/88244) | feat(workflows): validate the create AI task action at save time | +0.39 | architecture.facadeShare +0.46, complexity.shareOverTwenty -0.05 | production lines +86; test lines +142; functions over CCN 10 +1; functions over CCN 20 +1; top-10 complex in: products/workflows/backend/api/hog_flow.py:validate (ccn 107), products/workflows/backend/api/hog_flow.py:to_internal_value (ccn 38); outbound crossings +2; lint +1 (ruff:B904 +1) | 0: Save-time create-task checks are well tested and reuse validate_connectors via the tasks facade, but add a long method to the already huge hog_flow.py serializer. | +1: Visible truncated diff reuses connector validation through the tasks facade and adds focused save-time validation tests for connectors, repositories, models, and reasoning effort. |
| [#65974](https://github.com/PostHog/posthog/pull/65974) | feat(workflows): capture sent emails as browsable assets | +0.32 | smells.ruffPerKloc +0.12, architecture.cycleShare +0.10, architecture.propagationCost +0.09 | production lines +731; test lines +204; production files +4; duplication % +0.03; type escapes +2 | 0: Email assets feature is placed in a separate tested message_assets module in the style of its surroundings, though it adds two more actions to the large viewset. | 0: The truncated diff adds a reasonably separated asset API with meaningful database tests, balanced by viewset growth and frontend effect dependency suppression. |
| [#84345](https://github.com/PostHog/posthog/pull/84345) | feat(workflows): let a workflow action create and start an AI task | +0.27 | architecture.facadeShare +0.26, smells.ruffPerKloc -0.06, complexity.p90FileLines +0.05 | production lines +171; production files +2; p90 file lines 349→342; outbound crossings +1; lint +2 (ruff:B904 +2); duplication % -0.02; type escapes +4 | 0: New workflow_tasks endpoint calls the tasks product only through its new facade and a small service_jwt module; clean feature, though its tests live in tasks. | +2: Visible truncated diff establishes a tasks facade with a typed result and explicit exceptions, keeping task creation internals outside workflows. |
| [#92406](https://github.com/PostHog/posthog/pull/92406) | feat(workflows): notify teams when their email sending tier changes | +0.23 | architecture.facadeShare +0.19 | production lines +85; test lines +64; production files +1; outbound crossings +1; duplication % -0.01 | 0: Tier notifications live in a new focused service module, use the notifications facade, and have focused tests. The feature is clean but improves no existing code. | +1: Isolates notification policy in a dedicated service using the notifications facade, with meaningful gating and failure-isolation tests; only a registration snapshot is omitted. |
| [#94113](https://github.com/PostHog/posthog/pull/94113) | feat(workflows): redesign the workflow template picker | +0.23 | complexity.p90FunctionNloc +0.10, architecture.cycleShare +0.07 | production lines +360; test lines +94; production files +7; p90 file lines 366→364; functions over CCN 10 -1; duplication % -0.03 | +1: Splits the template picker into small card, badge, steps and meta components plus a tested display-logic module; minor any and as-unknown casts; much of the diff truncated. | +1: The visible truncated diff introduces a composable template card with explicit presentation slots and reusable preview components, supported by stories covering varied layouts. |
| [#71460](https://github.com/PostHog/posthog/pull/71460) | chore(frontend): inline Kea types batch 6 | +0.18 | smells.duplicationPercentage +0.29, smells.typeEscapesPerKloc -0.06, tests.testRatio -0.06 | production lines +355; duplication % -0.73; type escapes +10 | -1: Inlines large generated Kea type blocks into workflows logic files and adds deep relative imports like '../../../../../frontend/src/types', bloating already-large files. Diff heavily truncated. | 0: Visible truncated diff relocates generated Kea declarations into logic files without demonstrating changed runtime behavior or stronger types. |
| [#92860](https://github.com/PostHog/posthog/pull/92860) | fix(customer-analytics): allow workflow property overrides | +0.18 | architecture.facadeShare +0.18 | production lines +27; test lines +33; outbound crossings +1 | -1: customer_analytics now imports more workflows service internals (HogFlowReference, access filter) and the HogFlow model directly; the added workflows helper itself is small and tested. | +1: The truncated diff centralizes reference access filtering in a typed helper, with tests verifying visibility and avoiding workflow action reloads. |

## Top 10 worseners

| PR | title | Δ (unrounded) | moved most | drivers | Opus | Astra |
| --- | --- | --- | --- | --- | --- | --- |
| [#103523](https://github.com/PostHog/posthog/pull/103523) | feat(ai): let the agent search and list workflows | -0.98 | tests.facadeCoverage -1.33, architecture.facadeShare +0.32 | production lines +52; production files +1; p90 file lines 353→352; inbound crossings +1; outbound crossings +1; duplication % -0.01; type escapes +3; facade functions +2 | 0: Adds search_workflows and a testing helper to the workflows facade, which is the right boundary, but the function returns untyped hogai-shaped dicts. | +1: Adds workflow search and test-creation facades, keeping AI callers off workflow models, with tests for archived exclusion and shared ranking limits. |
| [#104165](https://github.com/PostHog/posthog/pull/104165) | fix(workflows): restore template autocomplete while editing | -0.48 | architecture.cycleShare -0.40, architecture.propagationCost -0.09 | production lines +31; test lines +89; cycle files +3/−0 | 0: buildSampleGlobals gains a real-sample overlay with solid tests, but the config component now implicitly depends on the test panel logic being mounted; most changes are outside workflows (truncated). | +1: The visible truncated diff adds meaningful coverage for sample-global merging, including anonymous events and trigger-specific placeholders, while reusing existing sample data. |
| [#95047](https://github.com/PostHog/posthog/pull/95047) | feat(workflows): add feature-flagged tree workflow builder | -0.35 | architecture.cycleShare -0.20, tests.testRatio -0.17, architecture.propagationCost -0.13 | production lines +2082; test lines +325; production files +11; p90 file lines 364→356; functions over CCN 10 +4; cycle files +2/−0; lint +1 (oxlint:eslint(no-unused-expressions) +1); duplication % +0.05 | -1: Large flagged tree builder adds about 480 lines to already large hogFlowEditorLogic, a parallel React context for selection, and DOM drag hacks; tree module has tests (heavily truncated). | 0: The truncated diff separates graph and tree rendering and shares workflow props, while adding conventional layout controls and selection state without a clear net quality shift. |
| [#78182](https://github.com/PostHog/posthog/pull/78182) | feat(workflows): email admins on AWS SES tenant reputation changes | -0.25 | complexity.p90Ccn -0.50, smells.ruffPerKloc +0.09, architecture.propagationCost +0.07 | production lines +470; test lines +398; production files +4; p90 file lines 350→349; functions over CCN 10 +2; facade bypasses +2/−0; inbound crossings +2; duplication % -0.04; type escapes +6 | 0: New SES tenant-state feature split cleanly into webhook, service, and task modules with tests; hand-rolled SNS verification mirrors Node code. Diff truncated. | +1: Visible truncated diff separates SNS verification, webhook handling, and shared state reconciliation, with transactional notification deduplication and focused webhook tests. |
| [#76808](https://github.com/PostHog/posthog/pull/76808) | feat(workflows): account audience for the batch trigger | -0.22 | smells.ruffPerKloc -0.18, complexity.p90FunctionNloc -0.10 | production lines +359; test lines +233; production files +1; functions over CCN 10 +2; top-10 complex in: products/workflows/backend/api/hog_flow.py:validate (ccn 82); facade bypasses +3/−0; inbound crossings +3; lint +4 (ruff:B904 +3, ruff:PLW0603 +1); duplication % -0.02; type escapes +2 | 0: Clean, tested account_audience service with provider inversion, offset by more inline access-check branching in the huge hog_flow.py and a type: ignore. Truncated. | +1: The visible truncated diff isolates account queries behind a typed provider interface and centralizes filter validation with meaningful API and parser tests. |
| [#103711](https://github.com/PostHog/posthog/pull/103711) | feat(tasks): start a goal or feature setup task for a space | -0.20 | tests.facadeCoverage -0.33, architecture.facadeShare +0.14 | production lines +36; inbound crossings +1; facade functions +1 | 0: Canvas goes through a new workflows facade function, which is a proper boundary, but that function imports the DRF serializer and splits enable and disable into different save paths (diff truncated). | +1: The visible truncated diff gives Canvas a workflows facade for status changes, with access checks and tests covering invalid activation and transactional rollback. |
| [#66988](https://github.com/PostHog/posthog/pull/66988) | feat(persons): emails tab on person profile | -0.17 | smells.duplicationPercentage -0.12, complexity.p90FileLines -0.08 | production lines +134; test lines +110; production files +1; p90 file lines 316→328; functions over CCN 10 +1; facade bypasses +2/−0; inbound crossings +2; duplication % +0.29; type escapes +1 | — | — |
| [#75237](https://github.com/PostHog/posthog/pull/75237) | feat(workflows): show AWS SES tenant health and findings on the reputation tab | -0.16 | complexity.p90FunctionNloc -0.10, complexity.p90FileLines -0.10 | production lines +295; test lines +179; p90 file lines 320→334; functions over CCN 10 +1; top-10 complex in: products/workflows/backend/api/hog_flow.py:team_reputation (ccn 31); duplication % -0.03; type escapes +4 | -1: SES provider method is clean and tested, but the caching helper, health mapping and two serializers grow the huge hog_flow.py API file further; frontend diff truncated. | 0: The visible, truncated diff keeps AWS calls behind SESProvider and adds meaningful tests, but expands the already large API module without improving its structure. |
| [#76015](https://github.com/PostHog/posthog/pull/76015) | feat(workflows): surgical email patching for workflow email steps | -0.15 | tests.testRatio +0.08, smells.ruffPerKloc -0.07, complexity.shareOverTwenty -0.06 | production lines +215; test lines +326; functions over CCN 10 +1; functions over CCN 20 +1; top-10 complex in: products/workflows/backend/api/hog_flow.py:action_email (ccn 29); facade bypasses +4/−0; outbound crossings +4; lint +2 (ruff:B904 +2); duplication % +0.1; type escapes +3 | -1: Adds about 250 lines to the already huge hog_flow.py, imports private _deep_merge, and couples to messaging api internals; tests are solid. Diff truncated. | -1: Despite meaningful tests, the visible truncated diff grows the large workflow API module and couples it to messaging API internals and a private graph helper. |
| [#68951](https://github.com/PostHog/posthog/pull/68951) | fix(workflows): point at the failing step when enabling a workflow | -0.12 | smells.ruffPerKloc -0.09 | production lines +34; test lines +19; functions over CCN 10 +1; top-10 complex in: products/workflows/backend/api/hog_flow.py:validate (ccn 42); lint +1 (ruff:B905 +1); duplication % -0.01; type escapes +3 | — | — |

## Biggest disagreements

4 PRs where the index and the judges point opposite ways, and 13 flat PRs the judges score at |mean| ≥ 1.

| PR | title | index | judge mean | moved most | Opus | Astra |
| --- | --- | --- | --- | --- | --- | --- |
| [#103523](https://github.com/PostHog/posthog/pull/103523) | feat(ai): let the agent search and list workflows | worsened -0.98 | 0.5 | tests.facadeCoverage -1.33, architecture.facadeShare +0.32 | 0: Adds search_workflows and a testing helper to the workflows facade, which is the right boundary, but the function returns untyped hogai-shaped dicts. | +1: Adds workflow search and test-creation facades, keeping AI callers off workflow models, with tests for archived exclusion and shared ranking limits. |
| [#104165](https://github.com/PostHog/posthog/pull/104165) | fix(workflows): restore template autocomplete while editing | worsened -0.48 | 0.5 | architecture.cycleShare -0.40, architecture.propagationCost -0.09 | 0: buildSampleGlobals gains a real-sample overlay with solid tests, but the config component now implicitly depends on the test panel logic being mounted; most changes are outside workflows (truncated). | +1: The visible truncated diff adds meaningful coverage for sample-global merging, including anonymous events and trigger-specific placeholders, while reusing existing sample data. |
| [#91458](https://github.com/PostHog/posthog/pull/91458) | chore(workflows): remove the incident replay banner | flat -0.08 | 1.5 | — | +1: Deletes the one-off incident replay banner, its ~270-line logic, its test and feature flag, removing temporary code from WorkflowsScene. | +2: The visible truncated diff removes the incident-specific banner, recovery state machinery, and feature flag, substantially reducing temporary maintenance burden while deleting their associated tests. |
| [#76015](https://github.com/PostHog/posthog/pull/76015) | feat(workflows): surgical email patching for workflow email steps | flat -0.15 | -1.0 | tests.testRatio +0.08, smells.ruffPerKloc -0.07, complexity.shareOverTwenty -0.06 | -1: Adds about 250 lines to the already huge hog_flow.py, imports private _deep_merge, and couples to messaging api internals; tests are solid. Diff truncated. | -1: Despite meaningful tests, the visible truncated diff grows the large workflow API module and couples it to messaging API internals and a private graph helper. |
| [#69305](https://github.com/PostHog/posthog/pull/69305) | feat(workflows): dedupe batch email sends by address | flat +0.15 | 1.0 | smells.ruffPerKloc +0.07, tests.testRatio +0.06 | +1: Adds a workflows-owned batch_audience service with solid tests and serializer validation, but still reaches into feature_flags internals and keeps flag-gated dual paths (diff truncated). | +1: The truncated diff introduces a workflows-owned audience service with shared email normalization and meaningful pagination tests, though feature-flags internals remain dependencies. |
| [#105744](https://github.com/PostHog/posthog/pull/105744) | fix(workflows): keep the shared messaging tabs inside the broadcasts page | flat +0.05 | 1.5 | — | +1: Extracts tab actions from WorkflowsScene into a shared MessagingTabActions and parametrizes messagingTabs, slimming the scene; path-segment parsing with a type cast is slightly ad hoc. | +2: The visible truncated diff extracts shared messaging actions and tab content from WorkflowsScene, isolates action-specific dependencies, and tests broadcast route precedence. |
| [#69943](https://github.com/PostHog/posthog/pull/69943) | fix(workflows): expose event global in batch step editor | flat -0.09 | 1.0 | complexity.p90FunctionNloc -0.10 | +1: Pulls the inline sample-globals construction out of the component into a pure buildSampleGlobals function and adds focused tests for it. | +1: Extracts sample-global construction from the component into a testable function and adds coverage for trigger-specific globals and variable placeholders. |
| [#91486](https://github.com/PostHog/posthog/pull/91486) | fix(workflows): stop auto-save fighting the person editing the workflow | flat +0.09 | -1.0 | tests.testRatio +0.08 | -1: Adds a cache-based save-context queue and a nextSaveChangesStatus mutable flag inside the already huge saveWorkflow loader; there are good tests, but it is more tangled (diff truncated). | -1: Despite meaningful overlap tests, the visible truncated diff expands the large save loader with a cache-backed context queue and mutable status flags, increasing coordination complexity. |
| [#78182](https://github.com/PostHog/posthog/pull/78182) | feat(workflows): email admins on AWS SES tenant reputation changes | worsened -0.25 | 0.5 | complexity.p90Ccn -0.50, smells.ruffPerKloc +0.09, architecture.propagationCost +0.07 | 0: New SES tenant-state feature split cleanly into webhook, service, and task modules with tests; hand-rolled SNS verification mirrors Node code. Diff truncated. | +1: Visible truncated diff separates SNS verification, webhook handling, and shared state reconciliation, with transactional notification deduplication and focused webhook tests. |
| [#66346](https://github.com/PostHog/posthog/pull/66346) | feat(customer-analytics): add "update account property" workflow action | flat +0.07 | -1.0 | — | -1: customer_analytics facade imports workflows' internal services.template_input_usage directly, coupling another product to workflows internals, though the new scanner is tested (diff truncated). | -1: Despite a tested generic scanner, the visible truncated diff couples customer analytics directly to workflows backend service internals instead of a public facade. |
| [#76808](https://github.com/PostHog/posthog/pull/76808) | feat(workflows): account audience for the batch trigger | worsened -0.22 | 0.5 | smells.ruffPerKloc -0.18, complexity.p90FunctionNloc -0.10 | 0: Clean, tested account_audience service with provider inversion, offset by more inline access-check branching in the huge hog_flow.py and a type: ignore. Truncated. | +1: The visible truncated diff isolates account queries behind a typed provider interface and centralizes filter validation with meaningful API and parser tests. |
| [#68541](https://github.com/PostHog/posthog/pull/68541) | fix(workflows): reconcile ReactFlow nodes and edges instead of rebuilding wholesale | flat +0.04 | 1.0 | — | +1: Replaces in-place action mutations with immutable updates, reuses shared reconcileById/objectsEqual helpers, stops leaking elk internals, and adds focused identity tests. | +1: Shared reconciliation, immutable action updates, and isolation of layout internals improve graph state handling, with meaningful reference-stability tests. |
| [#73166](https://github.com/PostHog/posthog/pull/73166) | feat(workflows): papercut - scope MCP workflows-update to non-graph fields | flat -0.04 | 1.0 | complexity.shareOverTwenty -0.07 | 0: Removes the risky whole-graph MCP escape hatch and updates tests, but duplicates perform_update's staleness check inline with raw request.data parsing. | +2: Enforces a single MCP graph-editing boundary, adds concurrency protection, and migrates existing tests onto that interface; omitted files are generated. |
| [#71078](https://github.com/PostHog/posthog/pull/71078) | feat(workflows): show push metrics in the workflow Metrics tab | flat -0.02 | -1.0 | — | -1: Push metrics copy-paste the email pattern (summary component, totals loader, mapper, type guard) and deepen nested ternaries, with no tests. | -1: Adds a parallel push-specific loading, mapping, and rendering path alongside email metrics, increasing duplicated maintenance without tests for the new aggregation logic. |
| [#78272](https://github.com/PostHog/posthog/pull/78272) | feat(workflows): materialize referenced email templates at save | flat -0.00 | -1.0 | complexity.shareOverTwenty -0.06, tests.testRatio +0.05 | -1: Adds a 90-line template materializer to huge hog_flow.py, imports messaging's MessageTemplate model directly, and memoizes through underscore keys in serializer context; tests are good (diff truncated). | -1: Despite meaningful visible tests, the truncated diff adds direct messaging-model coupling and a lengthy materialization helper with mutable context bookkeeping to the already large API module. |
| [#74507](https://github.com/PostHog/posthog/pull/74507) | feat(cdp): stage agent destination edits as reviewable drafts | flat -0.00 | 1.0 | — | +1: Moves AGENT_EVENT_SOURCES out of hog_flow.py into shared posthog/event_usage so workflows and CDP share one definition; the rest is CDP-side (truncated). | +1: The visible truncated diff moves AGENT_EVENT_SOURCES into shared event infrastructure and updates workflows to consume it, removing ownership of a cross-product policy constant. |
| [#87696](https://github.com/PostHog/posthog/pull/87696) | chore(workflows): remove fully rolled out workflows-email-reputation flag | flat 0.00 | 1.0 | — | +1: Removes a rolled-out feature flag, deleting the featureFlagLogic connect, the redirect special case and the conditional tab spread in WorkflowsScene. | +1: Removes obsolete reputation flag wiring, navigation guards, and conditional tab construction, simplifying the scene. |
