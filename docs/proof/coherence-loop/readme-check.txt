# README "Coherence loop" commands, run in README order on 2026-09-26 (macOS, zsh), from the root of this repository.
# Every command ran exactly as written, except where a note says otherwise.

## 1. Prerequisites

$ bun install
# run at 2026-09-26T22:08:00Z from the uml-pr-review root
bun install v1.4.2 (50a8a8387)

Checked 198 installs across 217 packages (no changes) [65.00ms]
# exit 0 in 0 s

$ gh auth status
# run at 2026-09-26T22:08:00Z from the uml-pr-review root
github.com
  ✓ Logged in to github.com account Silthus (keyring)
  - Active account: true
  - Git operations protocol: ssh
  - Token: gho_************************************
  - Token scopes: 'admin:public_key', 'admin:ssh_signing_key', 'gist', 'read:org', 'repo'
# exit 0 in 1 s

$ git -C ~/dev/posthog remote -v
# run at 2026-09-26T22:08:01Z from the uml-pr-review root
origin	git@github.com:Silthus/posthog.git (fetch)
origin	git@github.com:Silthus/posthog.git (push)
upstream	git@github.com:PostHog/posthog.git (fetch)
upstream	git@github.com:PostHog/posthog.git (push)
# exit 0 in 0 s

## 2. Score a product

$ bun coherence/index.ts --repo ~/dev/posthog --scope products/workflows --commit upstream/master
# run at 2026-09-26T22:08:01Z from the uml-pr-review root
Coherence Index for products/workflows at 57ca35773084: 62.1
  architecture  60.6
  complexity    72.4
  smells        80.4
  tests         33.6
  ladder        documented 13, review-only 16, structural 1
Measured in 1.9 s (635 cached, 0 measured). Add --json for every measure and its drivers.
# exit 0 in 2 s

## 3. Backfill the history and read the report
# The backfill and the build rewrite the tracked coherence/data and docs/coherence report. This PR restores them afterwards: refreshing the committed report is outside its scope.

$ bun coherence/backfill.ts --repo ~/dev/posthog --scopes products/workflows,products/surveys,products/error_tracking --ref upstream/master
# run at 2026-09-26T22:08:03Z from the uml-pr-review root
products/workflows 2026-09-23 debd20ac48f5 composite 61.9 in 1.6 s
products/error_tracking 2026-09-23 debd20ac48f5 composite 71.7 in 1.7 s
Backfilled 3 scopes over 26 weeks in 12.2 s (2 measured, 366 reused; 370 measured in 342.5 s across runs). Manifest: /Users/mreichenbach/dev/uml-pr-review/.claude/worktrees/agent-a9da5afc6e09a5868/coherence/data/backfill.json
# exit 0 in 12 s

$ bun coherence/report/build.ts --repo ~/dev/posthog --modules products/workflows --github PostHog/posthog
# run at 2026-09-26T22:08:15Z from the uml-pr-review root
products/workflows/backend code 55.5 (70 files)
products/workflows/backend/admin code 88.7 (5 files)
products/workflows/backend/api code 52.7 (10 files)
products/workflows/backend/management code 53.4 (7 files)
products/workflows/backend/management/commands code 53.4 (7 files)
products/workflows/backend/models code 76.3 (11 files)
products/workflows/backend/models/hog_flow code 67 (3 files)
products/workflows/backend/providers code 46.1 (4 files)
products/workflows/backend/services code 60.6 (13 files)
products/workflows/backend/tasks code 72.3 (6 files)
products/workflows/backend/utils code 78.5 (4 files)
products/workflows/frontend code 82.8 (239 files)
products/workflows/frontend/Broadcasts code 87.2 (23 files)
products/workflows/frontend/Broadcasts/steps code 97.2 (5 files)
products/workflows/frontend/Channels code 81.1 (15 files)
products/workflows/frontend/OptOuts code 84.4 (14 files)
products/workflows/frontend/Suppression code 82.7 (3 files)
products/workflows/frontend/TemplateLibrary code 88.3 (10 files)
products/workflows/frontend/Workflows code 77 (160 files)
products/workflows/frontend/Workflows/Reputation code 79.6 (3 files)
products/workflows/frontend/Workflows/hogflows code 71 (105 files)
products/workflows/frontend/Workflows/hogflows/filters code 79.8 (3 files)
products/workflows/frontend/Workflows/hogflows/panel code 79.3 (15 files)
products/workflows/frontend/Workflows/hogflows/panel/testing code 68.4 (4 files)
products/workflows/frontend/Workflows/hogflows/react_flow_utils code 66.2 (3 files)
products/workflows/frontend/Workflows/hogflows/registry code 79 (19 files)
products/workflows/frontend/Workflows/hogflows/registry/actions code 82 (4 files)
products/workflows/frontend/Workflows/hogflows/registry/triggers code 78.3 (14 files)
products/workflows/frontend/Workflows/hogflows/steps code 88.2 (43 files)
products/workflows/frontend/Workflows/hogflows/steps/components code 89.7 (19 files)
products/workflows/frontend/Workflows/hogflows/tree code 84.7 (12 files)
products/workflows/frontend/Workflows/templates code 85.5 (12 files)
products/workflows/frontend/emptyState code 87.2 (3 files)
products/workflows/frontend/scenes/settings code 96.4 (3 files)
products/workflows/mcp/apps code 78.2 (7 files)
Report for 3 scopes over 27 weeks written to /Users/mreichenbach/dev/uml-pr-review/.claude/worktrees/agent-a9da5afc6e09a5868/docs/coherence/index-report.{html,md}
# exit 0 in 63 s

$ open docs/coherence/index-report.html
# run at 2026-09-26T22:09:18Z from the uml-pr-review root
# exit 0 in 0 s

## 4. Rank targets

$ bun coherence/targets.ts --repo ~/dev/posthog --scope products/workflows --commit upstream/master --posthog-signals coherence/signals/reports/workflows-ci-2026-09-26.json
# run at 2026-09-26T22:09:18Z from the uml-pr-review root
Targets in products/workflows at 57ca35773084, churn from 2026-06-28 to 2026-09-26
score = pressure × pain × safety, each in [0, 1]; counts saturate as n / (n + half). Pressure is the mean of commits, touched source lines, and authors over the window; agent co-authored commits are evidence only. Pain is 1 − Π(1 − c) over its available components, so any strong pain counts and a missing provider only drops out. Safety is (0.5 + 0.5 × tested share) × (1 − 0.5 × saturated traffic). Ties break on pain × safety. Files that pull requests updated within the active days touch are busy; modules with only busy files are skipped.
Available: complexity, review findings, open pull requests, ci.test_failures, ci.test_retries
Unavailable: errors.occurrences (project 2 not reachable: switch-project returned 404)
Unavailable: apm.error_rate (project 2 not reachable: switch-project returned 404)
Unavailable: logs.warn_error_lines (project 2 not reachable: switch-project returned 404)
Unavailable: apm.requests (project 2 not reachable: switch-project returned 404)
Unavailable: usage.pageviews (project 2 not reachable: switch-project returned 404)
Not scored: errors.users, apm.p95_ms, usage.users, ci.test_p95_ms
Active pull requests: 2040 in PostHog/posthog, updated within 14 days
Skipped products/workflows: every file is busy in #107266
Skipped products/workflows/backend/models/hog_flow_batch_job: every file is busy in #104668
Skipped products/workflows/backend/templates: every file is busy in #102580, #104856
Skipped products/workflows/frontend/Channels/EmailSetup: every file is busy in #100880
Skipped products/workflows/frontend/Workflows/Reputation: every file is busy in #102652
Skipped products/workflows/frontend/Workflows/hogflows/editor/graph: every file is busy in #106062
Skipped products/workflows/frontend/Workflows/misc: every file is busy in #91710, #91795, #103021

  1.  72.45  products/workflows/backend/api  pressure 0.91 × pain 1.00 × safety 0.80  -> facade (boundary)
  2.  58.06  products/workflows/backend/services  pressure 0.73 × pain 0.95 × safety 0.85  -> facade (boundary)
  3.  53.78  products/workflows/frontend/Workflows/hogflows/steps  pressure 0.82 × pain 0.91 × safety 0.72  -> characterisation-tests (mechanical)
  4.  44.48  products/workflows/frontend/Workflows  pressure 0.89 × pain 0.73 × safety 0.68  -> characterisation-tests (mechanical)
  5.  41.65  products/workflows/frontend/Workflows/hogflows  pressure 0.78 × pain 0.77 × safety 0.69  -> characterisation-tests (mechanical)
  6.  40.79  products/workflows/backend/models/hog_flow  pressure 0.47 × pain 0.87 × safety 1.00  -> facade (boundary)
  7.  35.78  products/workflows/frontend/Workflows/hogflows/steps/components  pressure 0.73 × pain 0.73 × safety 0.68  -> characterisation-tests (mechanical)
  8.  35.19  products/workflows/backend/models  pressure 0.46 × pain 0.77 × safety 1.00  -> facade (boundary)
  9.  31.99  products/workflows/backend/management/commands  pressure 0.51 × pain 0.88 × safety 0.71  -> characterisation-tests (mechanical)
 10.  24.90  products/workflows/frontend/Workflows/hogflows/filters  pressure 0.41 × pain 0.73 × safety 0.83  -> ratchet-rule (mechanical)
 11.  23.58  products/workflows/backend/utils  pressure 0.34 × pain 0.70 × safety 1.00  -> facade (boundary)
 12.  23.17  products/workflows/backend/providers  pressure 0.45 × pain 0.69 × safety 0.75  -> facade (boundary)
 13.  22.16  products/workflows/frontend/Workflows/hogflows/panel/testing  pressure 0.64 × pain 0.46 × safety 0.75  -> ratchet-rule (mechanical)
 14.  21.89  products/workflows/frontend/Workflows/hogflows/registry/triggers  pressure 0.70 × pain 0.36 × safety 0.86  -> ratchet-rule (mechanical)
 15.  16.50  products/workflows/backend/tasks  pressure 0.37 × pain 0.67 × safety 0.67  -> facade (boundary)
 16.  16.42  products/workflows/frontend/Broadcasts  pressure 0.55 × pain 0.47 × safety 0.64  -> characterisation-tests (mechanical)
 17.  14.08  products/workflows/frontend/Workflows/hogflows/panel  pressure 0.68 × pain 0.38 × safety 0.55  -> characterisation-tests (mechanical)
 18.  10.02  products/workflows/frontend/Channels  pressure 0.42 × pain 0.40 × safety 0.60  -> characterisation-tests (mechanical)
 19.   9.21  products/workflows/frontend/OptOuts  pressure 0.60 × pain 0.29 × safety 0.54  -> characterisation-tests (mechanical)
 20.   8.97  products/workflows/backend  pressure 0.84 × pain 0.17 × safety 0.64  -> characterisation-tests (mechanical)
 21.   8.62  products/workflows/frontend/Workflows/hogflows/tree  pressure 0.51 × pain 0.29 × safety 0.59  -> characterisation-tests (mechanical)
 22.   8.44  products/workflows/frontend/Workflows/templates  pressure 0.46 × pain 0.29 × safety 0.64  -> characterisation-tests (mechanical)
 23.   5.70  products/workflows/backend/facade  pressure 0.34 × pain 0.17 × safety 1.00  -> characterisation-tests (mechanical)
 24.   2.84  products/workflows/frontend/Workflows/hogflows/registry/actions  pressure 0.35 × pain 0.11 × safety 0.75  -> ratchet-rule (mechanical)
 25.   2.48  products/workflows/frontend/Workflows/hogflows/react_flow_utils  pressure 0.20 × pain 0.25 × safety 0.50  -> characterisation-tests (mechanical)
 26.   1.16  products/workflows/mcp/apps  pressure 0.12 × pain 0.17 × safety 0.60  -> characterisation-tests (mechanical)
 27.   0.67  products/workflows/frontend/Broadcasts/steps  pressure 0.28 × pain 0.05 × safety 0.50  -> characterisation-tests (mechanical)
 28.   0.00  products/workflows/backend/models/hog_flow_schedule  pressure 0.00 × pain 0.14 × safety 0.75  -> ratchet-rule (mechanical)
 29.   0.00  products/workflows/frontend/Workflows/hogflows/registry  pressure 0.00 × pain 0.11 × safety 0.50  -> characterisation-tests (mechanical)
 30.   0.00  products/workflows/backend/admin  pressure 0.22 × pain 0.00 × safety 0.70  -> characterisation-tests (mechanical)
 31.   0.00  products/workflows/frontend  pressure 0.88 × pain 0.00 × safety 0.57  -> characterisation-tests (mechanical)
 32.   0.00  products/workflows/frontend/Channels/APNSSetup  pressure 0.39 × pain 0.00 × safety 0.50  -> characterisation-tests (mechanical)
 33.   0.00  products/workflows/frontend/Channels/FCMSetup  pressure 0.36 × pain 0.00 × safety 0.50  -> characterisation-tests (mechanical)
 34.   0.00  products/workflows/frontend/Channels/SlackSetup  pressure 0.22 × pain 0.00 × safety 0.50  -> characterisation-tests (mechanical)
 35.   0.00  products/workflows/frontend/Channels/TwilioSetup  pressure 0.22 × pain 0.00 × safety 0.50  -> characterisation-tests (mechanical)
 36.   0.00  products/workflows/frontend/Suppression  pressure 0.30 × pain 0.00 × safety 0.67  -> characterisation-tests (mechanical)
 37.   0.00  products/workflows/frontend/TemplateLibrary  pressure 0.56 × pain 0.00 × safety 0.60  -> characterisation-tests (mechanical)
 38.   0.00  products/workflows/frontend/Workflows/hogflows/editor  pressure 0.29 × pain 0.00 × safety 0.50  -> characterisation-tests (mechanical)
 39.   0.00  products/workflows/frontend/Workflows/logs  pressure 0.31 × pain 0.00 × safety 1.00  -> ratchet-rule (mechanical)
 40.   0.00  products/workflows/frontend/emptyState  pressure 0.31 × pain 0.00 × safety 0.50  -> characterisation-tests (mechanical)
 41.   0.00  products/workflows/frontend/onboarding  pressure 0.11 × pain 0.00 × safety 0.50  -> characterisation-tests (mechanical)
 42.   0.00  products/workflows/frontend/scenes/settings  pressure 0.19 × pain 0.00 × safety 0.50  -> characterisation-tests (mechanical)

#1 products/workflows/backend/api (10 files, 7288 lines)
  next: facade, boundary: 4 imports from outside the product bypass the facade into this module: posthog/api/person.py -> products/workflows/backend/api/message_assets.py; posthog/management/commands/refresh_hog_flows.py -> products/workflows/backend/api/hog_flow.py; posthog/urls.py -> products/workflows/backend/api/hog_flow.py
  busy: products/workflows/backend/api/hog_flow.py in #83800, #88238, #91709, #91795, #92252, #101229, #101701, #102248, #102673, #103019, #103540, #103849, #104156, #104202, #104270, #104452, #104668, #104713, #104883, #105854, #106553, #106561, #106759, #107195, #107216
  busy: products/workflows/backend/api/hog_flow_batch_job.py in #104668
  busy: products/workflows/backend/api/hog_flow_template.py in #104856
  busy: products/workflows/backend/api/message_assets.py in #101229, #103183
  busy: products/workflows/backend/api/workflow_tasks.py in #104215
  pressure 0.91 (mean)
    commits: 125 -> 0.93  [bdfaad6d04bf; 2e1d8e1ccac2; 1f8248be98d5; 624323555554; fece620f5b10; 28 of 125 co-authored by an agent]
    lines: 17196 -> 0.94
    authors: 17 -> 0.85
  pain 1.00 (any)
    review findings: 34.1667 -> 0.77  [constraints-live-in-the-serializer: 5 findings × 0.8333 of its component, e.g. https://github.com/PostHog/posthog/pull/59468#discussion_r3347822341; row-scoped-triggers-reject-person-steps: 3 findings × 0.8333 of its component, e.g. https://github.com/PostHog/posthog/pull/59468#discussion_r3347822341; graph-structure-validated-on-every-write: 5 findings × 0.8333 of its component, e.g. https://github.com/PostHog/posthog/pull/62649#discussion_r3429112580; server-compiles-all-bytecode: 3 findings × 0.8333 of its component, e.g. https://github.com/PostHog/posthog/pull/57847#discussion_r3335658853; secrets-masked-in-every-representation: 6 findings × 0.8333 of its component, e.g. https://github.com/PostHog/posthog/pull/72913#discussion_r3637293575; custom-actions-declare-scopes-and-object-access: 6 findings × 0.8333 of its component, e.g. https://github.com/PostHog/posthog/pull/73522#discussion_r3646021418; lifecycle-changes-are-explicit: 3 findings × 0.8333 of its component, e.g. https://github.com/PostHog/posthog/pull/91486#discussion_r3894363710; one-duration-grammar: 1 findings × 0.8333 of its component, e.g. https://github.com/PostHog/posthog/pull/81114#discussion_r3757761854; stored-payloads-are-size-bounded: 6 findings × 0.8333 of its component, e.g. https://github.com/PostHog/posthog/pull/68133#pullrequestreview-4745189470; flags-gate-adoption-not-execution: 4 findings × 0.8333 of its component, e.g. https://github.com/PostHog/posthog/pull/85511#discussion_r3822135887]
    complexity: 28 -> 0.85  [products/workflows/backend/api/hog_flow.py:validate CCN 129; products/workflows/backend/api/hog_flow.py:perform_update CCN 49; products/workflows/backend/api/hog_flow.py:validate CCN 49; products/workflows/backend/api/hog_flow.py:to_internal_value CCN 45; products/workflows/backend/api/publish_impact.py:build_publish_impact CCN 36]
    architecture: 16 -> 0.84  [inbound facade bypass posthog/api/person.py -> products/workflows/backend/api/message_assets.py; inbound facade bypass posthog/management/commands/refresh_hog_flows.py -> products/workflows/backend/api/hog_flow.py; inbound facade bypass posthog/urls.py -> products/workflows/backend/api/hog_flow.py; inbound facade bypass posthog/urls.py -> products/workflows/backend/api/hog_flow_template.py; outbound facade bypass products/workflows/backend/api/hog_flow.py -> products/access_control/backend/presentation/access_control.py]
    ci flakiness: 27 -> 0.73  [products/workflows/backend/api/test/test_hog_flow.py: ci.test_failures 10 (30d, exact); products/workflows/backend/api/test/test_hog_flow.py: ci.test_retries 10 (30d, exact); products/workflows/backend/api/test/test_workflow_proposals.py: ci.test_failures 6 (30d, exact); products/workflows/backend/api/test/test_workflow_proposals.py: ci.test_retries 1 (30d, exact)]
    production errors: unavailable
    apm errors: unavailable
    error logs: unavailable
  safety 0.80 (product)
    tests: 0.6 -> 0.80  [6 of 10 files imported by tests]
    traffic: unavailable

#2 products/workflows/backend/services (13 files, 2100 lines)
  next: facade, boundary: 6 imports from outside the product bypass the facade into this module: posthog/admin/admins/team_admin.py -> products/workflows/backend/services/email_sending_tier.py; posthog/api/integration.py -> products/workflows/backend/services/integration_usage.py; products/customer_analytics/backend/apps.py -> products/workflows/backend/services/account_audience.py
  busy: products/workflows/backend/services/audience_v2.py in #104270
  busy: products/workflows/backend/services/batch_audience.py in #88238, #104270
  busy: products/workflows/backend/services/email_sending_tier.py in #100947, #101866
  busy: products/workflows/backend/services/timing_reschedule.py in #101604
  busy: products/workflows/backend/services/wait_clock_conditions.py in #101604, #105854
  pressure 0.73 (mean)
    commits: 28 -> 0.74  [9738e386d6b5; 26d4894d1a86; 6ca0b9f91ac7; dde10aac6759; 136fc5de81e6; 7 of 28 co-authored by an agent]
    lines: 3418 -> 0.77
    authors: 6 -> 0.67
  pain 0.95 (any)
    review findings: 3.2 -> 0.24  [dispatch-requires-a-previewed-audience: 5 findings × 0.4 of its component, e.g. https://github.com/PostHog/posthog/pull/73225#discussion_r3643941753; dispatch-is-idempotent: 3 findings × 0.4 of its component, e.g. https://github.com/PostHog/posthog/pull/91581#discussion_r3894714334]
    complexity: 11 -> 0.69  [products/workflows/backend/services/timing_reschedule.py:get_timing_reschedule_action_ids CCN 34; products/workflows/backend/services/email_sending_tier.py:decide_tier CCN 28; products/workflows/backend/services/account_audience.py:parse_account_audience_filters CCN 26; products/workflows/backend/services/workflow_email_health.py:find_workflow_email_decisions CCN 25; products/workflows/backend/services/email_sending_attribution.py:fold_email_totals_by_flow CCN 14]
    architecture: 10 -> 0.77  [inbound facade bypass posthog/admin/admins/team_admin.py -> products/workflows/backend/services/email_sending_tier.py; inbound facade bypass posthog/api/integration.py -> products/workflows/backend/services/integration_usage.py; inbound facade bypass products/customer_analytics/backend/apps.py -> products/workflows/backend/services/account_audience.py; inbound facade bypass products/customer_analytics/backend/facade/api.py -> products/workflows/backend/services/account_audience.py; inbound facade bypass products/customer_analytics/backend/facade/api.py -> products/workflows/backend/services/template_input_usage.py]
    ci flakiness: 0 -> 0.00
    production errors: unavailable
    apm errors: unavailable
    error logs: unavailable
  safety 0.85 (product)
    tests: 0.6923 -> 0.85  [9 of 13 files imported by tests]
    traffic: unavailable

#3 products/workflows/frontend/Workflows/hogflows/steps (24 files, 3812 lines)
  next: characterisation-tests, mechanical: tests import 10 of 23 files; untested: products/workflows/frontend/Workflows/hogflows/steps/HogFlowBranchCard.tsx, products/workflows/frontend/Workflows/hogflows/steps/HogFlowBranchNameInput.tsx, products/workflows/frontend/Workflows/hogflows/steps/Nodes.tsx
  busy: products/workflows/frontend/Workflows/hogflows/steps/HogFlowSteps.tsx in #106759
  busy: products/workflows/frontend/Workflows/hogflows/steps/Nodes.tsx in #95021
  busy: products/workflows/frontend/Workflows/hogflows/steps/StepConditionalBranch.tsx in #83801, #88238
  busy: products/workflows/frontend/Workflows/hogflows/steps/StepFunction.tsx in #106553
  busy: products/workflows/frontend/Workflows/hogflows/steps/StepTrigger.tsx in #74031, #88238, #103187, #103540, #104452
  busy: products/workflows/frontend/Workflows/hogflows/steps/StepWaitUntilCondition.tsx in #99583
  busy: products/workflows/frontend/Workflows/hogflows/steps/utils.ts in #106062
  pressure 0.82 (mean)
    commits: 45 -> 0.82  [c660d0fc76ef; 6c3603f5a99f; 900075f8bc2a; 91952fa3c268; 96e7582a9771; 16 of 45 co-authored by an agent]
    lines: 5500 -> 0.85
    authors: 12 -> 0.80
  pain 0.91 (any)
    review findings: 1 -> 0.09  [editor-schema-accepts-what-the-server-stores: 2 findings × 0.25 of its component, e.g. https://github.com/PostHog/posthog/pull/62649#discussion_r3429112567; code-managed-workflows-are-read-only: 3 findings × 0.25 of its component, e.g. local:t3/896884be-14e4-4a9e-9da4-397fff67c0b0#dfd22683-df36-49e5-b32d-38ba0845bffe]
    complexity: 5 -> 0.50  [products/workflows/frontend/Workflows/hogflows/steps/StepTrigger.tsx:*global* CCN 24; products/workflows/frontend/Workflows/hogflows/steps/StepTrigger.tsx:*global* CCN 24; products/workflows/frontend/Workflows/hogflows/steps/StepDelay.tsx:? CCN 13; products/workflows/frontend/Workflows/hogflows/steps/StepConditionalBranch.tsx:ConditionAudienceEstimate CCN 12; products/workflows/frontend/Workflows/hogflows/steps/stepWaitUntilTimeWindowLogic.ts:partialSetWaitUntilTimeWindowConfig CCN 11]
    architecture: 10 -> 0.77  [on an import cycle: products/workflows/frontend/Workflows/hogflows/steps/HogFlowBranchCard.tsx; on an import cycle: products/workflows/frontend/Workflows/hogflows/steps/HogFlowSteps.tsx; on an import cycle: products/workflows/frontend/Workflows/hogflows/steps/StepConditionalBranch.tsx; on an import cycle: products/workflows/frontend/Workflows/hogflows/steps/StepDelay.tsx; on an import cycle: products/workflows/frontend/Workflows/hogflows/steps/StepFunction.tsx]
    ci flakiness: 2 -> 0.17  [products/workflows/frontend/Workflows/hogflows/steps/StepTrigger.test.tsx: ci.test_failures 1 (30d, exact); products/workflows/frontend/Workflows/hogflows/steps/StepTrigger.test.tsx: ci.test_retries 1 (30d, exact)]
    production errors: unavailable
    apm errors: unavailable
    error logs: unavailable
  safety 0.72 (product)
    tests: 0.4348 -> 0.72  [10 of 23 files imported by tests]
    traffic: unavailable

#4 products/workflows/frontend/Workflows (38 files, 7541 lines)
  next: characterisation-tests, mechanical: tests import 14 of 38 files; untested: products/workflows/frontend/Workflows/BatchRunLog.tsx, products/workflows/frontend/Workflows/EmailLinksTable.tsx, products/workflows/frontend/Workflows/EmailMetricsSummary.tsx
  busy: products/workflows/frontend/Workflows/EmailViewerModal.tsx in #101229
  busy: products/workflows/frontend/Workflows/NewWorkflowAgent.tsx in #102212
  busy: products/workflows/frontend/Workflows/NewWorkflowModal.tsx in #75243
  busy: products/workflows/frontend/Workflows/Workflow.tsx in #103540, #104452, #106035
  busy: products/workflows/frontend/Workflows/WorkflowBatchInvocations.tsx in #100187
  busy: products/workflows/frontend/Workflows/WorkflowEmailPauseBanner.tsx in #106508
  busy: products/workflows/frontend/Workflows/WorkflowMetricsSummary.tsx in #99786, #105359
  busy: products/workflows/frontend/Workflows/WorkflowRevisions.tsx in #103540, #104452
  busy: products/workflows/frontend/Workflows/WorkflowScene.tsx in #91710, #92252, #102212
  busy: products/workflows/frontend/Workflows/WorkflowSceneHeader.tsx in #91795, #101132, #103540, #104452
  busy: products/workflows/frontend/Workflows/WorkflowStatusBar.tsx in #103540, #104452, #106035
  busy: products/workflows/frontend/Workflows/WorkflowsTable.tsx in #92252, #103021, #103540, #104452, #106759
  busy: products/workflows/frontend/Workflows/newWorkflowAgentLogic.ts in #102212
  busy: products/workflows/frontend/Workflows/newWorkflowLogic.ts in #102212
  busy: products/workflows/frontend/Workflows/workflowAgentContext.ts in #102212
  busy: products/workflows/frontend/Workflows/workflowDuplication.ts in #101132, #103540, #103849, #104452, #106759
  busy: products/workflows/frontend/Workflows/workflowLogic.ts in #97159, #99583, #100187, #101132, #101701, #103540, #104452
  busy: products/workflows/frontend/Workflows/workflowMetricsSummaryLogic.ts in #99786, #102652, #105359
  busy: products/workflows/frontend/Workflows/workflowSceneLogic.ts in #91710, #92252
  busy: products/workflows/frontend/Workflows/workflowsLogic.ts in #103021, #106759
  pressure 0.89 (mean)
    commits: 74 -> 0.88  [bbd86e0a1160; e6ca63b8824e; 2e1d8e1ccac2; 6c3603f5a99f; 91952fa3c268; 28 of 74 co-authored by an agent]
    lines: 14542 -> 0.94
    authors: 18 -> 0.86
  pain 0.73 (any)
    review findings: 1 -> 0.09  [editor-schema-accepts-what-the-server-stores: 2 findings × 0.25 of its component, e.g. https://github.com/PostHog/posthog/pull/62649#discussion_r3429112567; code-managed-workflows-are-read-only: 3 findings × 0.25 of its component, e.g. local:t3/896884be-14e4-4a9e-9da4-397fff67c0b0#dfd22683-df36-49e5-b32d-38ba0845bffe]
    complexity: 7 -> 0.58  [products/workflows/frontend/Workflows/workflowLogic.ts:'Choose an email sender, or connect a new one' CCN 27; products/workflows/frontend/Workflows/PublishImpactDialog.tsx:PublishImpactContent CCN 23; products/workflows/frontend/Workflows/workflowLogic.ts:action CCN 21; products/workflows/frontend/Workflows/WorkflowMetricCard.tsx:getColorVar CCN 15; products/workflows/frontend/Workflows/WorkflowAssets.tsx:EmptyAssets CCN 13]
    architecture: 0 -> 0.00
    ci flakiness: 4 -> 0.29  [products/workflows/frontend/Workflows/workflowProposalsLogic.test.ts: ci.test_failures 2 (30d, exact); products/workflows/frontend/Workflows/workflowProposalsLogic.test.ts: ci.test_retries 2 (30d, exact)]
    production errors: unavailable
    apm errors: unavailable
    error logs: unavailable
  safety 0.68 (product)
    tests: 0.3684 -> 0.68  [14 of 38 files imported by tests]
    traffic: unavailable

#5 products/workflows/frontend/Workflows/hogflows (8 files, 1791 lines)
  next: characterisation-tests, mechanical: tests import 3 of 8 files; untested: products/workflows/frontend/Workflows/hogflows/HogFlowBranchSelection.tsx, products/workflows/frontend/Workflows/hogflows/HogFlowEditor.tsx, products/workflows/frontend/Workflows/hogflows/HogFlowManualTriggerButton.tsx
  busy: products/workflows/frontend/Workflows/hogflows/HogFlowEditor.tsx in #96734, #106062
  busy: products/workflows/frontend/Workflows/hogflows/hogFlowEditorLogic.tsx in #96734, #99816, #101132, #103370, #106035, #106062
  busy: products/workflows/frontend/Workflows/hogflows/testEventFactory.ts in #106014
  busy: products/workflows/frontend/Workflows/hogflows/types.ts in #92252, #101132, #103021, #103540, #103849, #104452
  pressure 0.78 (mean)
    commits: 38 -> 0.79  [2e1d8e1ccac2; 9e9f43a684fd; 6c3603f5a99f; 91952fa3c268; 295c177ed9ce; 11 of 38 co-authored by an agent]
    lines: 3439 -> 0.77
    authors: 11 -> 0.79
  pain 0.77 (any)
    review findings: 1 -> 0.09  [editor-schema-accepts-what-the-server-stores: 2 findings × 0.25 of its component, e.g. https://github.com/PostHog/posthog/pull/62649#discussion_r3429112567; code-managed-workflows-are-read-only: 3 findings × 0.25 of its component, e.g. local:t3/896884be-14e4-4a9e-9da4-397fff67c0b0#dfd22683-df36-49e5-b32d-38ba0845bffe]
    complexity: 5 -> 0.50  [products/workflows/frontend/Workflows/hogflows/hogFlowEditorLogic.tsx:(anonymous) CCN 21; products/workflows/frontend/Workflows/hogflows/hogFlowEditorLogic.tsx:*global* CCN 17; products/workflows/frontend/Workflows/hogflows/hogFlowEditorLogic.tsx:getBranchLabel CCN 16; products/workflows/frontend/Workflows/hogflows/hogFlowEditorLogic.tsx:getEdgeId CCN 15; products/workflows/frontend/Workflows/hogflows/hogFlowEditorLogic.tsx:reactToTabChange CCN 11]
    architecture: 3 -> 0.50  [on an import cycle: products/workflows/frontend/Workflows/hogflows/HogFlowBranchSelection.tsx; on an import cycle: products/workflows/frontend/Workflows/hogflows/hogFlowEditorLogic.tsx; on an import cycle: products/workflows/frontend/Workflows/hogflows/types.ts]
    ci flakiness: 0 -> 0.00
    production errors: unavailable
    apm errors: unavailable
    error logs: unavailable
  safety 0.69 (product)
    tests: 0.375 -> 0.69  [3 of 8 files imported by tests]
    traffic: unavailable

# exit 0 in 86 s

## 5. Run one iteration (dry run)

$ bun coherence/loop/session.ts --repo ~/dev/posthog --scope products/workflows --fetch
# This is the proof run itself, started at 2026-09-26T21:28:46Z; it is not run a second time here. Its launcher output (session-output.json):
{
  "transcript": "/var/folders/0v/_5100j6j439fdt76hj7tvkr80000gn/T/coherence-session-1790458126347.jsonl",
  "exitCode": 0,
  "result": "I ran one iteration and proposed one pull request as a dry run, so nothing was pushed. It adds tests for `EmailLinksTable` and leaves the production code unchanged. The loop then stopped because the budget of 1 was spent.\n\n| | |\n|---|---|\n| **Target** | `products/workflows/frontend/Workflows` (rank 4, score 0.4448) |\n| **Step** | characterisation-tests |\n| **Verification class** | mechanical |\n| **Index delta** | composite 65.1 → 65.1; tests 17.6 → 17.8; architecture, complexity and smells unchanged |\n| **pr.md** | `coherence/runs/2026-09-26/frontend-workflows-characterisation-tests/pr.md` |\n\n**The change:** one commit (`8eb2dda92c3`) on branch `coherence/workflows/frontend-workflows-characterisation-tests`. It adds `EmailLinksTable.test.tsx` (112 lines, 7 tests, all passing). The tests pin how the table shows today:\n- Whole URLs are links that open in a new tab.\n- Cut-off (truncated) URLs show as plain text ending in \"…\", not as links.\n- A repeated URL gets a \"Position N\" tag only when it has a position; one with an empty position gets no tag.\n- Clicks show with thousands separators, rows keep their order, and an empty table shows its empty-state message.\n\nThe change touches no files that open pull requests are editing, stays inside the scope, and adds no lint findings.\n\n**Why ranks 1–3 were skipped:**\n- **Ranks 1 and 2** (`backend/api` and `backend/services`, both facade steps) are still waiting on open questions #82 and #83.\n- **Rank 3** (`hogflows/steps`): choose didn't say why it passed over it, and I didn't dig into it.\n\n**Things that differed from the standard run:**\n- **Signals:** no PostHog MCP tools were available, so I used the saved report `workflows-ci-2026-09-26.json` instead of refreshing it. The error, request, log and pageview signals in that report are marked unavailable because project 2 returned a 404.\n- **Fetch:** `--fetch` failed because the SSH agent couldn't sign, and your `~/.gitconfig` turns `https://github.com/` URLs back into SSH. Instead, I fetched `upstream/master` myself over HTTPS with the global config skipped for that one command (base `57ca357`), then ran sense without `--fetch`. Your git config is unchanged.\n- **Dependencies:** sense couldn't load its grammar files at first, so I ran `bun install` in this repo.\n- **Commit hook:** PostHog's pre-commit hook failed because Python wasn't found (it needs the flox environment). I committed with `--no-verify` after running oxfmt and oxlint on the file by hand; the PR description says so."
}
# Not measured by this script: exit 0, and 21 turns, 325 s, $0.60 from the result event in transcript.jsonl.

$ GIT_CONFIG_GLOBAL=/dev/null git -C ~/dev/posthog fetch --quiet https://github.com/PostHog/posthog.git +master:refs/remotes/upstream/master
# run at 2026-09-26T22:10:44Z from the uml-pr-review root
# exit 0 in 6 s
# The fallback's follow-up, the session command without --fetch, was not run again: it would start a second iteration. The proof run's agent ran sense without --fetch after the same fetch (transcript-tools.md).

## 6. Review the dry run
# The proof run's workspace was removed after the run; it was re-created at the same path, branch, and commit (8eb2dda) for this check, and step 7's cleanup removes it again.

$ iteration=$(dirname "$(ls -t coherence/runs/*/*/iteration.json | head -1)")
$ cat $iteration/pr.md
$ git -C "$(jq -r .workspace.path $iteration/iteration.json)" show --stat
# run at 2026-09-26T22:10:50Z from the uml-pr-review root
# test(workflows): pin EmailLinksTable rendering of truncated, duplicate, and counted links

## What changed

Adds outside-in tests for `EmailLinksTable`, which had none. They pin today's rendering: whole URLs are links that open in a new tab, while truncated URLs are plain text with an ellipsis. A duplicate URL gets a "Position N" tag only when it has a non-empty link index, and clicks are formatted with thousands separators. Production code is unchanged.

The repository's pre-commit hook needs the flox Python, which was not available, so the commit used `--no-verify`. oxfmt and oxlint were run on the file by hand instead.

## Review in 2 minutes

1. `products/workflows/frontend/Workflows/EmailLinksTable.test.tsx`: check that each case asserts what a person sees in the table: link vs. plain text, the position tag, and the clicks text. In particular, a duplicate with an empty `linkIndex` shows no position; that is today's behaviour, pinned on purpose.
2. `products/workflows/frontend/Workflows/EmailLinksTable.tsx` (unchanged): compare the two render branches against the test cases.

## Why this module

`products/workflows/frontend/Workflows` ranks #4 in `products/workflows` with a coherence target score of 44.48 (pressure × pain × safety).

Recommendation: tests import 14 of 38 files; untested: products/workflows/frontend/Workflows/BatchRunLog.tsx, products/workflows/frontend/Workflows/EmailLinksTable.tsx, products/workflows/frontend/Workflows/EmailMetricsSummary.tsx

Evidence:

- commits: bbd86e0a1160
- commits: e6ca63b8824e
- commits: 2e1d8e1ccac2
- commits: 6c3603f5a99f
- commits: 91952fa3c268
- commits: 28 of 74 co-authored by an agent
- review findings: editor-schema-accepts-what-the-server-stores: 2 findings × 0.25 of its component, e.g. https://github.com/PostHog/posthog/pull/62649#discussion_r3429112567
- review findings: code-managed-workflows-are-read-only: 3 findings × 0.25 of its component, e.g. local:t3/896884be-14e4-4a9e-9da4-397fff67c0b0#dfd22683-df36-49e5-b32d-38ba0845bffe

## Step and verification class

Step: **characterisation-tests**. Verification class: **mechanical**.

## Coherence Index for `products/workflows/frontend/Workflows`

| Dimension | Before | After | Change |
| --- | ---: | ---: | ---: |
| composite | 65.10 | 65.10 | +0.00 |
| architecture | 72.30 | 72.30 | +0.00 |
| complexity | 79.80 | 79.80 | +0.00 |
| smells | 81.60 | 81.60 | +0.00 |
| **tests** | 17.60 | 17.80 | +0.20 |

Targeted dimensions are in bold; none of them may drop.

## Checks

- Changed: 1 files, +112 −0 (112 of 300 lines; renamed files count only their edits).
- Lint: ruff and oxlint find 0 findings in the 1 touched source files, 0 before.
- jest on `products/workflows/frontend/Workflows/EmailLinksTable.test.tsx`: passed.
- Files in active pull requests: untouched.

---

Generated by the coherence loop (dry-run) from `upstream/master` at 57ca35773084.
commit 8eb2dda92c3bb125b1b83e9a95b9dfc518990628
Author: Reichenbach, Michael <755327+Silthus@users.noreply.github.com>
Date:   Sat Sep 26 23:33:48 2026 +0200

    test(workflows): pin EmailLinksTable rendering of truncated, duplicate, and counted links
    
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

 .../frontend/Workflows/EmailLinksTable.test.tsx    | 112 +++++++++++++++++++++
 1 file changed, 112 insertions(+)
# exit 0 in 0 s
# The next commands reuse $iteration=coherence/runs/2026-09-26/frontend-workflows-characterisation-tests from the block above.

$ bun coherence/loop/propose.ts --iteration $iteration --summary $iteration/summary.md
# run at 2026-09-26T22:10:50Z from the uml-pr-review root
{
  "mode": "dry-run",
  "body": "/Users/mreichenbach/dev/uml-pr-review/.claude/worktrees/agent-a9da5afc6e09a5868/coherence/runs/2026-09-26/frontend-workflows-characterisation-tests/pr.md",
  "branch": "coherence/workflows/frontend-workflows-characterisation-tests",
  "workspace": "/var/folders/0v/_5100j6j439fdt76hj7tvkr80000gn/T/coherence-workflows-frontend-workflows-characterisation-tests",
  "pullRequest": null
}
# exit 0 in 0 s

## 7. Open your first draft pull request
# The exception: this command would push to Silthus/posthog and open a draft on PostHog/posthog, which is Michael's call.
# It ran exactly as written, but with fakes first on PATH: a git that logs "push" and forwards everything else to /usr/bin/git, and a gh that logs its arguments and prints a placeholder URL. check.sh refuses to run unless both fakes resolve first.

$ bun coherence/loop/propose.ts --iteration $iteration --summary $iteration/summary.md --draft
# run at 2026-09-26T22:10:50Z from the uml-pr-review root, with a fake gh and a fake git push first on PATH (/tmp/wf73/fakebin): nothing reaches GitHub
{
  "mode": "draft",
  "body": "/Users/mreichenbach/dev/uml-pr-review/.claude/worktrees/agent-a9da5afc6e09a5868/coherence/runs/2026-09-26/frontend-workflows-characterisation-tests/pr.md",
  "branch": "coherence/workflows/frontend-workflows-characterisation-tests",
  "workspace": "/var/folders/0v/_5100j6j439fdt76hj7tvkr80000gn/T/coherence-workflows-frontend-workflows-characterisation-tests",
  "pullRequest": "https://github.com/PostHog/posthog/pull/FAKE-not-opened"
}
# what the fakes received:
fake git push, nothing pushed: git push --set-upstream origin HEAD:refs/heads/coherence/workflows/frontend-workflows-characterisation-tests
fake gh, nothing sent: gh pr create --draft --repo PostHog/posthog --base master --head Silthus:coherence/workflows/frontend-workflows-characterisation-tests --title 'test(workflows): pin EmailLinksTable rendering of truncated, duplicate, and counted links' --body-file /Users/mreichenbach/dev/uml-pr-review/.claude/worktrees/agent-a9da5afc6e09a5868/coherence/runs/2026-09-26/frontend-workflows-characterisation-tests/pr.md
# exit 0 in 0 s

$ jq .proposal $iteration/iteration.json
# run at 2026-09-26T22:10:50Z from the uml-pr-review root
{
  "mode": "draft",
  "body": "/Users/mreichenbach/dev/uml-pr-review/.claude/worktrees/agent-a9da5afc6e09a5868/coherence/runs/2026-09-26/frontend-workflows-characterisation-tests/pr.md",
  "pullRequest": "https://github.com/PostHog/posthog/pull/FAKE-not-opened"
}
# exit 0 in 0 s

$ gh pr list --repo PostHog/posthog --author @me --draft
# run at 2026-09-26T22:10:50Z from the uml-pr-review root
106759	feat(workflows): add a pill search bar to the workflows list	Silthus:workflows-list-v2/search-bar	DRAFT	2026-09-25T14:10:12Z
106561	feat(workflows): add slim summary list for workflows and email templates	Silthus:workflows-list-v2/slim-list	DRAFT	2026-09-25T11:09:41Z
106553	fix(workflows): keep the library template link when inserting a template	Silthus:workflows/keep-email-template-link	DRAFT	2026-09-25T10:55:17Z
106508	feat(workflows): turn the reputation tab into an action list	Silthus:feat/workflows-reputation-action-inbox	DRAFT	2026-09-25T09:41:48Z
105499	feat(os-shell): an operating-system shell behind the os-shell flag	Silthus:feat/os-shell	DRAFT	2026-09-23T20:19:15Z
104164	ci(workflows): check and push the repository's own workflows	Silthus:feat/workflows-ci-job	DRAFT	2026-09-22T04:13:53Z
104157	feat(workflows): add the repository's own workflows folder	Silthus:feat/workflows-example-workflow	DRAFT	2026-09-22T03:44:27Z
103689	feat(posthog-ai): offer clickable follow-up actions under the answer	Silthus:feat/posthog-ai-chat-actions	DRAFT	2026-09-21T12:00:09Z
# exit 0 in 1 s
# Restore the dry-run state (pr.md footer and iteration.json) with the re-render command from step 6:

$ bun coherence/loop/propose.ts --iteration $iteration --summary $iteration/summary.md
# run at 2026-09-26T22:10:51Z from the uml-pr-review root
{
  "mode": "dry-run",
  "body": "/Users/mreichenbach/dev/uml-pr-review/.claude/worktrees/agent-a9da5afc6e09a5868/coherence/runs/2026-09-26/frontend-workflows-characterisation-tests/pr.md",
  "branch": "coherence/workflows/frontend-workflows-characterisation-tests",
  "workspace": "/var/folders/0v/_5100j6j439fdt76hj7tvkr80000gn/T/coherence-workflows-frontend-workflows-characterisation-tests",
  "pullRequest": null
}
# exit 0 in 0 s

$ git -C ~/dev/posthog worktree remove --force "$(jq -r .workspace.path $iteration/iteration.json)"
$ git -C ~/dev/posthog branch -D "$(jq -r .workspace.branch $iteration/iteration.json)"
# run at 2026-09-26T22:10:51Z from the uml-pr-review root
Deleted branch coherence/workflows/frontend-workflows-characterisation-tests (was 8eb2dda92c3).
# exit 0 in 5 s

## 8. Answer inbox questions

$ bun coherence/inbox.ts list
# run at 2026-09-26T22:10:56Z from the uml-pr-review root
[
  {
    "number": 83,
    "url": "https://github.com/Silthus/uml-pr-review/issues/83",
    "title": "Coherence: facade for products/workflows/backend/services?",
    "scope": "products/workflows",
    "module": "products/workflows/backend/services",
    "step": "facade",
    "state": "open",
    "answer": null
  },
  {
    "number": 82,
    "url": "https://github.com/Silthus/uml-pr-review/issues/82",
    "title": "Coherence: facade for products/workflows/backend/api?",
    "scope": "products/workflows",
    "module": "products/workflows/backend/api",
    "step": "facade",
    "state": "open",
    "answer": null
  }
]
# exit 0 in 1 s
# resolve answers Michael's questions, so it ran only against the fake gh, with stand-in values for <number> and the answer.

$ bun coherence/inbox.ts resolve 82 --answer "<option and detail>"
# run at 2026-09-26T22:10:57Z from the uml-pr-review root, with a fake gh and a fake git push first on PATH (/tmp/wf73/fakebin): nothing reaches GitHub
{
  "resolved": 82
}
# what the fakes received:
fake gh, nothing sent: gh issue view 82 --json labels --repo Silthus/uml-pr-review
fake gh, nothing sent: gh issue comment 82 --body-file - --repo Silthus/uml-pr-review
fake gh, nothing sent: gh issue close 82 --repo Silthus/uml-pr-review
# exit 0 in 0 s

$ bun coherence/inbox.ts resolve 83 --skip
# run at 2026-09-26T22:10:57Z from the uml-pr-review root, with a fake gh and a fake git push first on PATH (/tmp/wf73/fakebin): nothing reaches GitHub
{
  "skipped": 83
}
# what the fakes received:
fake gh, nothing sent: gh issue view 83 --json labels --repo Silthus/uml-pr-review
fake gh, nothing sent: gh issue close 83 --reason 'not planned' --repo Silthus/uml-pr-review
# exit 0 in 0 s

## 9. Tune it

$ bun coherence/targets.ts --repo ~/dev/posthog --scope products/workflows --commit upstream/master --posthog-signals coherence/signals/reports/workflows-ci-2026-09-26.json --active-days 3 | head -20
# run at 2026-09-26T22:10:57Z from the uml-pr-review root
Targets in products/workflows at 57ca35773084, churn from 2026-06-28 to 2026-09-26
score = pressure × pain × safety, each in [0, 1]; counts saturate as n / (n + half). Pressure is the mean of commits, touched source lines, and authors over the window; agent co-authored commits are evidence only. Pain is 1 − Π(1 − c) over its available components, so any strong pain counts and a missing provider only drops out. Safety is (0.5 + 0.5 × tested share) × (1 − 0.5 × saturated traffic). Ties break on pain × safety. Files that pull requests updated within the active days touch are busy; modules with only busy files are skipped.
Available: complexity, review findings, open pull requests, ci.test_failures, ci.test_retries
Unavailable: errors.occurrences (project 2 not reachable: switch-project returned 404)
Unavailable: apm.error_rate (project 2 not reachable: switch-project returned 404)
Unavailable: logs.warn_error_lines (project 2 not reachable: switch-project returned 404)
Unavailable: apm.requests (project 2 not reachable: switch-project returned 404)
Unavailable: usage.pageviews (project 2 not reachable: switch-project returned 404)
Not scored: errors.users, apm.p95_ms, usage.users, ci.test_p95_ms
Active pull requests: 1001 in PostHog/posthog, updated within 3 days
Skipped products/workflows: every file is busy in #107266
Skipped products/workflows/backend/templates: every file is busy in #102580
Skipped products/workflows/frontend/Workflows/Reputation: every file is busy in #102652
Skipped products/workflows/frontend/Workflows/hogflows/editor/graph: every file is busy in #106062
Skipped products/workflows/frontend/Workflows/misc: every file is busy in #91710, #91795

  1.  72.45  products/workflows/backend/api  pressure 0.91 × pain 1.00 × safety 0.80  -> facade (boundary)
  2.  58.06  products/workflows/backend/services  pressure 0.73 × pain 0.95 × safety 0.85  -> facade (boundary)
  3.  53.78  products/workflows/frontend/Workflows/hogflows/steps  pressure 0.82 × pain 0.91 × safety 0.72  -> characterisation-tests (mechanical)
  4.  44.48  products/workflows/frontend/Workflows  pressure 0.89 × pain 0.73 × safety 0.68  -> characterisation-tests (mechanical)
# exit 0 in 85 s

# done
