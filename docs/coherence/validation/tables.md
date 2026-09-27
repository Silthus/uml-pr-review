# Blind-judge validation: generated tables

## Overview

321 first-parent commits; 321 carry a PR number. The composite moved at all (|Δ| ≥ 0.1) for 85/321 (26%); the PR threshold is ±0.2.

| type | PRs | improved | flat | worsened |
| --- | --- | --- | --- | --- |
| chore | 35 | 3 | 32 | 0 |
| feat | 190 | 12 | 171 | 7 |
| fix | 90 | 1 | 88 | 1 |
| perf | 4 | 0 | 4 | 0 |
| refactor | 2 | 0 | 2 | 0 |
| **all** | 321 | 16 | 297 | 8 |

Composite Δ distribution: -1.0: 1, -0.5: 1, -0.4: 1, -0.2: 5, -0.1: 23, 0.0: 236, +0.1: 38, +0.2: 11, +0.3: 1, +0.4: 1, +0.5: 1, +0.6: 1, +3.4: 1.

|Δ| percentiles: p50 0, p75 0.1, p90 0.1, p95 0.2, max 3.4.

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

Sign agreement on the 24 non-flat PRs: 11/24 (46%) counting a judge mean of 0 as disagreement; 11/20 (55%) over the 20 where the judges lean one way.

Spearman(composite Δ, mean judge): 0.01 over all 64 judged PRs; 0.25 over the non-flat ones.

Cohen's kappa, index class against each judge's sign: Opus 0.18, Astra 0.07.

Confusion matrix (judge class from the mean score: ≥ 0.5 better, ≤ −0.5 worse):

| index class | judged | judges: better | judges: neutral | judges: worse |
| --- | --- | --- | --- | --- |
| improved | 16 | 8 | 4 | 4 |
| flat | 40 | 20 | 14 | 6 |
| worsened | 8 | 5 | 0 | 3 |

Blindness: 26/40 (65%) of the sampled flat PRs are better or worse to the judges. Scaled to all 297 flat PRs that is about 193 PRs, against 20 non-neutral PRs the index does move: the index is flat on about 91% of the PRs that judges see as a quality change. With the stricter rule that both judges give the same non-zero sign: 10/40 (25%) flat, about 74 scaled, against 5 moved, so about 94% blind.

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
| scope-level composite (\|Δ\| ≥ 0.2) | 24/321 (7%) | 24/64 (38%) | 0.01 | 11/20 (55%) |
| diff-local score (≠ 0) | 111/321 (35%) | 30/64 (47%) | 0.20 | 11/27 (41%) |
| diff-local density per KLOC of changed files (\|Δ\| ≥ 1) | 83/321 (26%) | 27/64 (42%) | -0.01 | 11/22 (50%) |

## Targeted checks

| group | PRs | mean Δ composite | mean Δ complexity | mean Δ tests | worsened / improved | mean judge |
| --- | --- | --- | --- | --- | --- | --- |
| feat with ≥ 300 added production lines in scope | 43 | 0.03 | -0.09 | -0.03 | 5 / 7 | 0.16 (n=16) |
| test-only in scope | 15 | 0.00 | 0.00 | 0.02 | 0 / 0 | 0.25 (n=2) |
| all | 321 | 0.02 | -0.02 | 0.04 | 8 / 16 | 0.24 (n=64) |

Facade coverage moved on 3 PRs:

| PR | coverage share | Δ functions / covered | composite contribution | Δ composite | Δ composite if gated |
| --- | --- | --- | --- | --- | --- |
| [#101488](https://github.com/PostHog/posthog/pull/101488) | 0 → 0.3333 | +1 / +1 | +3.33 | +3.4 | 0.07 |
| [#103523](https://github.com/PostHog/posthog/pull/103523) | 0.3333 → 0.2 | +2 / 0 | -1.33 | -1.0 | -2.74 |
| [#103711](https://github.com/PostHog/posthog/pull/103711) | 0.2 → 0.1667 | +1 / 0 | -0.33 | -0.2 | -0.20 |

Facade share moved on 30 PRs, 16 of them through inbound crossings; a single crossing is worth about 0.46 composite points in the first of them.

## Top 10 improvers

| PR | title | Δ | moved most | drivers | Opus | Astra |
| --- | --- | --- | --- | --- | --- | --- |
| [#101488](https://github.com/PostHog/posthog/pull/101488) | chore(workflows): verify SES events through ingress | +3.4 | tests.facadeCoverage +3.33, complexity.p90FunctionNloc +0.10 | production lines -164; test lines -91; production files -1; p90 file lines 353→355; functions over CCN 10 -1; facade bypasses +0/−1; inbound crossings -1; duplication % +0.01; type escapes -2; facade functions +1; facade covered +1 | +2: Deletes workflows' own 181-line SNS signature verifier and bespoke webhook view, moving verification into shared ingress and entering workflows through a facade function. | +2: The visible truncated diff replaces workflow-specific webhook verification with shared ingress and a facade entry point, separating transport concerns from SES business handling. |
| [#64001](https://github.com/PostHog/posthog/pull/64001) | feat(workflows): make the builder aware of edits from MCP/API | +0.6 | architecture.facadeShare +0.46, tests.testRatio +0.08 | production lines +150; test lines +246; functions over CCN 10 +1; outbound crossings +1; duplication % -0.03 | 0: Optimistic concurrency and edit events go through the notifications facade and are well tested, but they grow the already large workflowLogic and perform_update (diff truncated). | 0: The visible truncated diff adds tested concurrency checks and notification handling, but also expands workflowLogic with reconciliation state, leaving maintainability broadly unchanged. |
| [#97753](https://github.com/PostHog/posthog/pull/97753) | feat(workflows): create customer analytics tasks | +0.5 | architecture.facadeShare +0.33, tests.testRatio +0.06 | production lines +321; test lines +439; production files +4; p90 file lines 356→355; inbound crossings +2; duplication % -0.02; facade functions +1 | +1: Adds a small workflows backend facade (get_workflow_owner_id) for other products and moves feature-flag filtering into getRegisteredActionNodeCategories; new input is tested. Diff truncated. | +1: The visible truncated diff centralizes action visibility filtering, adds a workflow-owner facade, and tests task idempotency and reference-input behavior. |
| [#88244](https://github.com/PostHog/posthog/pull/88244) | feat(workflows): validate the create AI task action at save time | +0.4 | architecture.facadeShare +0.46, complexity.shareOverTwenty -0.05 | production lines +86; test lines +142; functions over CCN 10 +1; functions over CCN 20 +1; top-10 complex in: products/workflows/backend/api/hog_flow.py:validate (ccn 107), products/workflows/backend/api/hog_flow.py:to_internal_value (ccn 38); outbound crossings +2; lint +1 (ruff:B904 +1) | 0: Save-time create-task checks are well tested and reuse validate_connectors via the tasks facade, but add a long method to the already huge hog_flow.py serializer. | +1: Visible truncated diff reuses connector validation through the tasks facade and adds focused save-time validation tests for connectors, repositories, models, and reasoning effort. |
| [#65974](https://github.com/PostHog/posthog/pull/65974) | feat(workflows): capture sent emails as browsable assets | +0.3 | smells.ruffPerKloc +0.12, architecture.cycleShare +0.10, architecture.propagationCost +0.09 | production lines +731; test lines +204; production files +4; duplication % +0.03; type escapes +2 | 0: Email assets feature is placed in a separate tested message_assets module in the style of its surroundings, though it adds two more actions to the large viewset. | 0: The truncated diff adds a reasonably separated asset API with meaningful database tests, balanced by viewset growth and frontend effect dependency suppression. |
| [#69305](https://github.com/PostHog/posthog/pull/69305) | feat(workflows): dedupe batch email sends by address | +0.2 | smells.ruffPerKloc +0.07, tests.testRatio +0.06 | production lines +236; test lines +237; production files +1; functions over CCN 10 +1; facade bypasses +1/−0; outbound crossings +1; duplication % +0.01; type escapes +1 | +1: Adds a workflows-owned batch_audience service with solid tests and serializer validation, but still reaches into feature_flags internals and keeps flag-gated dual paths (diff truncated). | +1: The truncated diff introduces a workflows-owned audience service with shared email normalization and meaningful pagination tests, though feature-flags internals remain dependencies. |
| [#70823](https://github.com/PostHog/posthog/pull/70823) | feat(workflows): draft, test, publish cycle behind the workflows-revisions flag + MCP | +0.2 | tests.testRatio +0.10, smells.ruffPerKloc +0.08, complexity.shareOverTwenty -0.07 | production lines +266; test lines +355; production files +1; functions over CCN 10 +1; functions over CCN 20 +1; top-10 complex in: products/workflows/backend/api/hog_flow.py:perform_update (ccn 29); duplication % +0.04 | -1: Adds draft routing, publish and discard endpoints into the already huge hog_flow.py viewset and perform_update; good tests, but the diff is truncated and complexity grows. | 0: In the truncated diff, explicit draft fields and meaningful routing tests balance additional client-specific lifecycle branching in the already large workflow API. |
| [#71460](https://github.com/PostHog/posthog/pull/71460) | chore(frontend): inline Kea types batch 6 | +0.2 | smells.duplicationPercentage +0.29, smells.typeEscapesPerKloc -0.06, tests.testRatio -0.06 | production lines +355; duplication % -0.73; type escapes +10 | -1: Inlines large generated Kea type blocks into workflows logic files and adds deep relative imports like '../../../../../frontend/src/types', bloating already-large files. Diff heavily truncated. | 0: Visible truncated diff relocates generated Kea declarations into logic files without demonstrating changed runtime behavior or stronger types. |
| [#71038](https://github.com/PostHog/posthog/pull/71038) | feat(workflows): suppress repeatedly-bouncing email addresses | +0.2 | architecture.propagationCost +0.07, architecture.cycleShare +0.06 | production lines +355; test lines +166; production files +3; duplication % +0.08 | -1: Suppression UI depends on messaging's generated API, a messaging viewset test is placed in workflows as a tach workaround, and loaders repeat try/catch blocks. Truncated. | +1: Visible truncated diff separates suppression UI from state logic, uses messaging API contracts, and adds meaningful access-control, pagination-failure, and routing tests. |
| [#84345](https://github.com/PostHog/posthog/pull/84345) | feat(workflows): let a workflow action create and start an AI task | +0.2 | architecture.facadeShare +0.26, smells.ruffPerKloc -0.06, complexity.p90FileLines +0.05 | production lines +171; production files +2; p90 file lines 349→342; outbound crossings +1; lint +2 (ruff:B904 +2); duplication % -0.02; type escapes +4 | 0: New workflow_tasks endpoint calls the tasks product only through its new facade and a small service_jwt module; clean feature, though its tests live in tasks. | +2: Visible truncated diff establishes a tasks facade with a typed result and explicit exceptions, keeping task creation internals outside workflows. |

## Top 10 worseners

| PR | title | Δ | moved most | drivers | Opus | Astra |
| --- | --- | --- | --- | --- | --- | --- |
| [#103523](https://github.com/PostHog/posthog/pull/103523) | feat(ai): let the agent search and list workflows | -1.0 | tests.facadeCoverage -1.33, architecture.facadeShare +0.32 | production lines +52; production files +1; p90 file lines 353→352; inbound crossings +1; outbound crossings +1; duplication % -0.01; type escapes +3; facade functions +2 | 0: Adds search_workflows and a testing helper to the workflows facade, which is the right boundary, but the function returns untyped hogai-shaped dicts. | +1: Adds workflow search and test-creation facades, keeping AI callers off workflow models, with tests for archived exclusion and shared ranking limits. |
| [#104165](https://github.com/PostHog/posthog/pull/104165) | fix(workflows): restore template autocomplete while editing | -0.5 | architecture.cycleShare -0.40, architecture.propagationCost -0.09 | production lines +31; test lines +89; cycle files +3/−0 | 0: buildSampleGlobals gains a real-sample overlay with solid tests, but the config component now implicitly depends on the test panel logic being mounted; most changes are outside workflows (truncated). | +1: The visible truncated diff adds meaningful coverage for sample-global merging, including anonymous events and trigger-specific placeholders, while reusing existing sample data. |
| [#95047](https://github.com/PostHog/posthog/pull/95047) | feat(workflows): add feature-flagged tree workflow builder | -0.4 | architecture.cycleShare -0.20, tests.testRatio -0.17, architecture.propagationCost -0.13 | production lines +2082; test lines +325; production files +11; p90 file lines 364→356; functions over CCN 10 +4; cycle files +2/−0; lint +1 (oxlint:eslint(no-unused-expressions) +1); duplication % +0.05 | -1: Large flagged tree builder adds about 480 lines to already large hogFlowEditorLogic, a parallel React context for selection, and DOM drag hacks; tree module has tests (heavily truncated). | 0: The truncated diff separates graph and tree rendering and shares workflow props, while adding conventional layout controls and selection state without a clear net quality shift. |
| [#75237](https://github.com/PostHog/posthog/pull/75237) | feat(workflows): show AWS SES tenant health and findings on the reputation tab | -0.2 | complexity.p90FunctionNloc -0.10, complexity.p90FileLines -0.10 | production lines +295; test lines +179; p90 file lines 320→334; functions over CCN 10 +1; top-10 complex in: products/workflows/backend/api/hog_flow.py:team_reputation (ccn 31); duplication % -0.03; type escapes +4 | -1: SES provider method is clean and tested, but the caching helper, health mapping and two serializers grow the huge hog_flow.py API file further; frontend diff truncated. | 0: The visible, truncated diff keeps AWS calls behind SESProvider and adds meaningful tests, but expands the already large API module without improving its structure. |
| [#76015](https://github.com/PostHog/posthog/pull/76015) | feat(workflows): surgical email patching for workflow email steps | -0.2 | tests.testRatio +0.08, smells.ruffPerKloc -0.07, complexity.shareOverTwenty -0.06 | production lines +215; test lines +326; functions over CCN 10 +1; functions over CCN 20 +1; top-10 complex in: products/workflows/backend/api/hog_flow.py:action_email (ccn 29); facade bypasses +4/−0; outbound crossings +4; lint +2 (ruff:B904 +2); duplication % +0.1; type escapes +3 | -1: Adds about 250 lines to the already huge hog_flow.py, imports private _deep_merge, and couples to messaging api internals; tests are solid. Diff truncated. | -1: Despite meaningful tests, the visible truncated diff grows the large workflow API module and couples it to messaging API internals and a private graph helper. |
| [#76808](https://github.com/PostHog/posthog/pull/76808) | feat(workflows): account audience for the batch trigger | -0.2 | smells.ruffPerKloc -0.18, complexity.p90FunctionNloc -0.10 | production lines +359; test lines +233; production files +1; functions over CCN 10 +2; top-10 complex in: products/workflows/backend/api/hog_flow.py:validate (ccn 82); facade bypasses +3/−0; inbound crossings +3; lint +4 (ruff:B904 +3, ruff:PLW0603 +1); duplication % -0.02; type escapes +2 | 0: Clean, tested account_audience service with provider inversion, offset by more inline access-check branching in the huge hog_flow.py and a type: ignore. Truncated. | +1: The visible truncated diff isolates account queries behind a typed provider interface and centralizes filter validation with meaningful API and parser tests. |
| [#78182](https://github.com/PostHog/posthog/pull/78182) | feat(workflows): email admins on AWS SES tenant reputation changes | -0.2 | complexity.p90Ccn -0.50, smells.ruffPerKloc +0.09, architecture.propagationCost +0.07 | production lines +470; test lines +398; production files +4; p90 file lines 350→349; functions over CCN 10 +2; facade bypasses +2/−0; inbound crossings +2; duplication % -0.04; type escapes +6 | 0: New SES tenant-state feature split cleanly into webhook, service, and task modules with tests; hand-rolled SNS verification mirrors Node code. Diff truncated. | +1: Visible truncated diff separates SNS verification, webhook handling, and shared state reconciliation, with transactional notification deduplication and focused webhook tests. |
| [#103711](https://github.com/PostHog/posthog/pull/103711) | feat(tasks): start a goal or feature setup task for a space | -0.2 | tests.facadeCoverage -0.33, architecture.facadeShare +0.14 | production lines +36; inbound crossings +1; facade functions +1 | 0: Canvas goes through a new workflows facade function, which is a proper boundary, but that function imports the DRF serializer and splits enable and disable into different save paths (diff truncated). | +1: The visible truncated diff gives Canvas a workflows facade for status changes, with access checks and tests covering invalid activation and transactional rollback. |
| [#66952](https://github.com/PostHog/posthog/pull/66952) | chore(workflows): remove membership filter backfill command | -0.1 |  | production lines -122; test lines -106; production files -1; functions over CCN 10 -1; facade bypasses +0/−1; outbound crossings -1; duplication % +0.02; type escapes -2 | — | — |
| [#66988](https://github.com/PostHog/posthog/pull/66988) | feat(persons): emails tab on person profile | -0.1 | smells.duplicationPercentage -0.12, complexity.p90FileLines -0.08 | production lines +134; test lines +110; production files +1; p90 file lines 316→328; functions over CCN 10 +1; facade bypasses +2/−0; inbound crossings +2; duplication % +0.29; type escapes +1 | — | — |

## Biggest disagreements

9 PRs where the index and the judges point opposite ways, and 11 flat PRs the judges score at |mean| ≥ 1.

| PR | title | index | judge mean | moved most | Opus | Astra |
| --- | --- | --- | --- | --- | --- | --- |
| [#103523](https://github.com/PostHog/posthog/pull/103523) | feat(ai): let the agent search and list workflows | worsened -1.0 | 0.5 | tests.facadeCoverage -1.33, architecture.facadeShare +0.32 | 0: Adds search_workflows and a testing helper to the workflows facade, which is the right boundary, but the function returns untyped hogai-shaped dicts. | +1: Adds workflow search and test-creation facades, keeping AI callers off workflow models, with tests for archived exclusion and shared ranking limits. |
| [#91458](https://github.com/PostHog/posthog/pull/91458) | chore(workflows): remove the incident replay banner | flat -0.1 | 1.5 | — | +1: Deletes the one-off incident replay banner, its ~270-line logic, its test and feature flag, removing temporary code from WorkflowsScene. | +2: The visible truncated diff removes the incident-specific banner, recovery state machinery, and feature flag, substantially reducing temporary maintenance burden while deleting their associated tests. |
| [#105744](https://github.com/PostHog/posthog/pull/105744) | fix(workflows): keep the shared messaging tabs inside the broadcasts page | flat +0.1 | 1.5 | — | +1: Extracts tab actions from WorkflowsScene into a shared MessagingTabActions and parametrizes messagingTabs, slimming the scene; path-segment parsing with a type cast is slightly ad hoc. | +2: The visible truncated diff extracts shared messaging actions and tab content from WorkflowsScene, isolates action-specific dependencies, and tests broadcast route precedence. |
| [#104165](https://github.com/PostHog/posthog/pull/104165) | fix(workflows): restore template autocomplete while editing | worsened -0.5 | 0.5 | architecture.cycleShare -0.40, architecture.propagationCost -0.09 | 0: buildSampleGlobals gains a real-sample overlay with solid tests, but the config component now implicitly depends on the test panel logic being mounted; most changes are outside workflows (truncated). | +1: The visible truncated diff adds meaningful coverage for sample-global merging, including anonymous events and trigger-specific placeholders, while reusing existing sample data. |
| [#69943](https://github.com/PostHog/posthog/pull/69943) | fix(workflows): expose event global in batch step editor | flat -0.1 | 1.0 | complexity.p90FunctionNloc -0.10 | +1: Pulls the inline sample-globals construction out of the component into a pure buildSampleGlobals function and adds focused tests for it. | +1: Extracts sample-global construction from the component into a testable function and adds coverage for trigger-specific globals and variable placeholders. |
| [#74507](https://github.com/PostHog/posthog/pull/74507) | feat(cdp): stage agent destination edits as reviewable drafts | flat -0.1 | 1.0 | — | +1: Moves AGENT_EVENT_SOURCES out of hog_flow.py into shared posthog/event_usage so workflows and CDP share one definition; the rest is CDP-side (truncated). | +1: The visible truncated diff moves AGENT_EVENT_SOURCES into shared event infrastructure and updates workflows to consume it, removing ownership of a cross-product policy constant. |
| [#91486](https://github.com/PostHog/posthog/pull/91486) | fix(workflows): stop auto-save fighting the person editing the workflow | flat +0.1 | -1.0 | tests.testRatio +0.08 | -1: Adds a cache-based save-context queue and a nextSaveChangesStatus mutable flag inside the already huge saveWorkflow loader; there are good tests, but it is more tangled (diff truncated). | -1: Despite meaningful overlap tests, the visible truncated diff expands the large save loader with a cache-backed context queue and mutable status flags, increasing coordination complexity. |
| [#70823](https://github.com/PostHog/posthog/pull/70823) | feat(workflows): draft, test, publish cycle behind the workflows-revisions flag + MCP | improved +0.2 | -0.5 | tests.testRatio +0.10, smells.ruffPerKloc +0.08, complexity.shareOverTwenty -0.07 | -1: Adds draft routing, publish and discard endpoints into the already huge hog_flow.py viewset and perform_update; good tests, but the diff is truncated and complexity grows. | 0: In the truncated diff, explicit draft fields and meaningful routing tests balance additional client-specific lifecycle branching in the already large workflow API. |
| [#71460](https://github.com/PostHog/posthog/pull/71460) | chore(frontend): inline Kea types batch 6 | improved +0.2 | -0.5 | smells.duplicationPercentage +0.29, smells.typeEscapesPerKloc -0.06, tests.testRatio -0.06 | -1: Inlines large generated Kea type blocks into workflows logic files and adds deep relative imports like '../../../../../frontend/src/types', bloating already-large files. Diff heavily truncated. | 0: Visible truncated diff relocates generated Kea declarations into logic files without demonstrating changed runtime behavior or stronger types. |
| [#76808](https://github.com/PostHog/posthog/pull/76808) | feat(workflows): account audience for the batch trigger | worsened -0.2 | 0.5 | smells.ruffPerKloc -0.18, complexity.p90FunctionNloc -0.10 | 0: Clean, tested account_audience service with provider inversion, offset by more inline access-check branching in the huge hog_flow.py and a type: ignore. Truncated. | +1: The visible truncated diff isolates account queries behind a typed provider interface and centralizes filter validation with meaningful API and parser tests. |
| [#78182](https://github.com/PostHog/posthog/pull/78182) | feat(workflows): email admins on AWS SES tenant reputation changes | worsened -0.2 | 0.5 | complexity.p90Ccn -0.50, smells.ruffPerKloc +0.09, architecture.propagationCost +0.07 | 0: New SES tenant-state feature split cleanly into webhook, service, and task modules with tests; hand-rolled SNS verification mirrors Node code. Diff truncated. | +1: Visible truncated diff separates SNS verification, webhook handling, and shared state reconciliation, with transactional notification deduplication and focused webhook tests. |
| [#90938](https://github.com/PostHog/posthog/pull/90938) | feat(workflows): add a "Run scout" workflow action | improved +0.2 | -0.5 | architecture.facadeShare +0.19 | -1: WorkflowScoutRunViewSet copy-pastes the task viewset's JWT auth and rejection helpers, grows hog_flow.py, and tests import signals scout_harness internals. Diff truncated. | 0: Visible truncated diff adds a facade-based scout endpoint with meaningful tests, balanced by duplicated workflow-token parsing and bespoke Redis replay handling. |
| [#82343](https://github.com/PostHog/posthog/pull/82343) | feat(workflows): add broadcasts prototype on top of workflows | improved +0.2 | -0.5 | tests.testRatio -0.23, architecture.cycleShare +0.15, architecture.propagationCost +0.13 | -1: The backend type filter is refactored into a tested workflow_type_q, but a large prototype broadcasts surface (a 929-line wizard logic) and a big StepTrigger change are added, mostly unseen (diff truncated). | 0: The visible truncated diff adds reasonably separated broadcast components and tested workflow filtering; most wizard logic is omitted, and the shown feature additions are structurally neutral. |
| [#103711](https://github.com/PostHog/posthog/pull/103711) | feat(tasks): start a goal or feature setup task for a space | worsened -0.2 | 0.5 | tests.facadeCoverage -0.33, architecture.facadeShare +0.14 | 0: Canvas goes through a new workflows facade function, which is a proper boundary, but that function imports the DRF serializer and splits enable and disable into different save paths (diff truncated). | +1: The visible truncated diff gives Canvas a workflows facade for status changes, with access checks and tests covering invalid activation and transactional rollback. |
| [#66346](https://github.com/PostHog/posthog/pull/66346) | feat(customer-analytics): add "update account property" workflow action | flat 0.0 | -1.0 | — | -1: customer_analytics facade imports workflows' internal services.template_input_usage directly, coupling another product to workflows internals, though the new scanner is tested (diff truncated). | -1: Despite a tested generic scanner, the visible truncated diff couples customer analytics directly to workflows backend service internals instead of a public facade. |
| [#68541](https://github.com/PostHog/posthog/pull/68541) | fix(workflows): reconcile ReactFlow nodes and edges instead of rebuilding wholesale | flat 0.0 | 1.0 | — | +1: Replaces in-place action mutations with immutable updates, reuses shared reconcileById/objectsEqual helpers, stops leaking elk internals, and adds focused identity tests. | +1: Shared reconciliation, immutable action updates, and isolation of layout internals improve graph state handling, with meaningful reference-stability tests. |
| [#71078](https://github.com/PostHog/posthog/pull/71078) | feat(workflows): show push metrics in the workflow Metrics tab | flat 0.0 | -1.0 | — | -1: Push metrics copy-paste the email pattern (summary component, totals loader, mapper, type guard) and deepen nested ternaries, with no tests. | -1: Adds a parallel push-specific loading, mapping, and rendering path alongside email metrics, increasing duplicated maintenance without tests for the new aggregation logic. |
| [#73166](https://github.com/PostHog/posthog/pull/73166) | feat(workflows): papercut - scope MCP workflows-update to non-graph fields | flat 0.0 | 1.0 | complexity.shareOverTwenty -0.07 | 0: Removes the risky whole-graph MCP escape hatch and updates tests, but duplicates perform_update's staleness check inline with raw request.data parsing. | +2: Enforces a single MCP graph-editing boundary, adds concurrency protection, and migrates existing tests onto that interface; omitted files are generated. |
| [#78272](https://github.com/PostHog/posthog/pull/78272) | feat(workflows): materialize referenced email templates at save | flat 0.0 | -1.0 | complexity.shareOverTwenty -0.06, tests.testRatio +0.05 | -1: Adds a 90-line template materializer to huge hog_flow.py, imports messaging's MessageTemplate model directly, and memoizes through underscore keys in serializer context; tests are good (diff truncated). | -1: Despite meaningful visible tests, the truncated diff adds direct messaging-model coupling and a lengthy materialization helper with mutable context bookkeeping to the already large API module. |
| [#87696](https://github.com/PostHog/posthog/pull/87696) | chore(workflows): remove fully rolled out workflows-email-reputation flag | flat 0.0 | 1.0 | — | +1: Removes a rolled-out feature flag, deleting the featureFlagLogic connect, the redirect special case and the conditional tab spread in WorkflowsScene. | +1: Removes obsolete reputation flag wiring, navigation guards, and conditional tab construction, simplifying the scene. |
