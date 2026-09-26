# Coherence Index: posthog `upstream/master`, 27 weekly points (2026-03-23 to 2026-09-21)

Built 2026-09-26 at `c25b27f874a1`. 368 commits measured in 330.3 s across all backfill runs; the last run took 330.3 s (368 measured, 0 reused). The full report with charts is [index-report.html](index-report.html).

## Is the index trustworthy?

The index has no measurement noise; the band is the 90th percentile of one weekday of ordinary commits, measured on Wednesday→Thursday pairs in weeks where the product changed.

| Product | Composite now | Change | Day pairs | Weekday median | Weekday band (p90) | Typical week | Largest week |
| --- | --- | --- | --- | --- | --- | --- | --- |
| products/workflows | 59.7 | +7.1 | 23 | 0.1 | ±0.6 | 0.2 | +1.6 (ending 2026-06-08) |
| products/surveys | 46.2 | −12.3 | 17 | 0.0 | ±3.9 | 0.3 | −13.8 (ending 2026-03-30) |
| products/error_tracking | 71.5 | +11.9 | 26 | 0.1 | ±0.4 | 0.4 | +7.5 (ending 2026-04-20) |

## Scores at 2026-09-21

| Product | composite | architecture | complexity | smells | tests |
| --- | --- | --- | --- | --- | --- |
| products/workflows | 59.7 | 59.3 | 71.1 | 79.7 | 26.3 |
| products/surveys | 46.2 | 36.7 | 31.8 | 76.8 | 50.0 |
| products/error_tracking | 71.5 | 83.7 | 81.3 | 82.5 | 27.1 |

## Weekday band per dimension

| Product | architecture | complexity | smells | tests |
| --- | --- | --- | --- | --- |
| products/workflows | ±0.5 | ±0.6 | ±0.9 | ±0.8 |
| products/surveys | ±2.6 | ±2.9 | ±2.3 | ±0.0 |
| products/error_tracking | ±0.5 | ±0.2 | ±0.5 | ±0.7 |

## Biggest movers, per product

| Product | Δ composite | × band | Date | Moved most | Change |
| --- | --- | --- | --- | --- | --- |
| workflows | +0.6 | 1.0× | 2026-06-07 | architecture +1.6 | refactor(frontend): remove defunct tabId from workflows scenes [#62026](https://github.com/PostHog/posthog/pull/62026) [`58e8f53`](https://github.com/PostHog/posthog/commit/58e8f530f8be560fc2e59210f1a790d11dbd4a62) |
| workflows | +0.6 | 1.0× | 2026-06-29 | architecture +1.3 | feat(workflows): make the builder aware of edits from MCP/API [#64001](https://github.com/PostHog/posthog/pull/64001) [`c617e72`](https://github.com/PostHog/posthog/commit/c617e72bbb8eb6b8d5b855592b099802f1736604) |
| workflows | +0.4 | 0.7× | 2026-06-01 | smells +1.2 | feat(workflows): add base MCP tools for workflows product [#60388](https://github.com/PostHog/posthog/pull/60388) [`6970121`](https://github.com/PostHog/posthog/commit/6970121e6400d8766641cb3a7d33ce3b6c661d85) |
| workflows | +0.3 | 0.5× | 2026-06-01 | smells +0.7 | fix(admin): register moved hogflow and cdp admins via package init [#60652](https://github.com/PostHog/posthog/pull/60652) [`cb5b59f`](https://github.com/PostHog/posthog/commit/cb5b59f6da85bbb6c568e335fa2e7521d96804d9) |
| workflows | +0.3 | 0.5× | 2026-06-09 | tests +0.7 | feat(workflows): add invocation debugging MCP tools and align names [#61655](https://github.com/PostHog/posthog/pull/61655) [`64c5a4e`](https://github.com/PostHog/posthog/commit/64c5a4efdd391e86ef1157bfa93e3952f97b5519) |
| surveys | −13.7 | 3.5× | 2026-03-23 | complexity −41.5 | chore(surveys): move survey models and API to products app [#51611](https://github.com/PostHog/posthog/pull/51611) [`731051c`](https://github.com/PostHog/posthog/commit/731051cb6951587692dc1c86eaba65a70add4fbf) |
| surveys | −8.3 | 2.1× | 2026-04-23 | smells −26.3 | feat(devex): generate Zod validation schemas from OpenAPI spec [#54698](https://github.com/PostHog/posthog/pull/54698) [`fbfbfb7`](https://github.com/PostHog/posthog/commit/fbfbfb7a12985fa0d9a252646378be42eea548b2) |
| surveys | +5.4 | 1.4× | 2026-05-20 | smells +27.3 | refactor(onboarding): compose flow from per-product step providers [#57579](https://github.com/PostHog/posthog/pull/57579) [`706db7c`](https://github.com/PostHog/posthog/commit/706db7c3d5ee4ab321334a717d365fc6d43d5616) |
| surveys | −1.5 | 0.4× | 2026-05-21 | complexity −4.6 | feat(surveys): replace 'Default' translation with explicit base_language [#58628](https://github.com/PostHog/posthog/pull/58628) [`1095361`](https://github.com/PostHog/posthog/commit/1095361a044ac7586ab30fc033b035f7b624d322) |
| surveys | +0.2 | 0.1× | 2026-04-23 | smells +0.8 | chore(devex): enforce type annotations in product backend code [#55443](https://github.com/PostHog/posthog/pull/55443) [`7d69f05`](https://github.com/PostHog/posthog/commit/7d69f056cc748e537af13ff15e997e1b5c552b98) |
| error_tracking | +10.4 | 26.0× | 2026-04-15 | tests +50.1 | feat(error_tracking): add issue facade kickoff [#54718](https://github.com/PostHog/posthog/pull/54718) [`4c6495d`](https://github.com/PostHog/posthog/commit/4c6495dec83ced70b5efc763f027ab0189952ea3) |
| error_tracking | −4.6 | 11.5× | 2026-04-16 | tests −24.9 | feat(error_tracking): migrate digest and task callers to facade [#54749](https://github.com/PostHog/posthog/pull/54749) [`9a84ad6`](https://github.com/PostHog/posthog/commit/9a84ad66f544fd737550396c036df2280a6c4c1c) |
| error_tracking | +1.6 | 4.0× | 2026-07-06 | architecture +4.6 | chore(error-tracking): seal external boundary and enable contract-check [#65456](https://github.com/PostHog/posthog/pull/65456) [`c5f763e`](https://github.com/PostHog/posthog/commit/c5f763e280d5209a4f243608902c263b51529e6c) |
| error_tracking | +1.5 | 3.8× | 2026-04-16 | architecture +4.4 | feat(error_tracking): migrate issue readers to facade [#54724](https://github.com/PostHog/posthog/pull/54724) [`cf7a565`](https://github.com/PostHog/posthog/commit/cf7a56580c53092b9a2364bfbbb2357e749df153) |
| error_tracking | +0.9 | 2.3× | 2026-07-14 | tests +4.5 | perf(error-tracking): cut weekly digest clickhouse query load [#70471](https://github.com/PostHog/posthog/pull/70471) [`35a43af`](https://github.com/PostHog/posthog/commit/35a43af6cf0b01c7acb7f9acd7adc7583cba048e) |

## products/workflows modules at `c25b27f874a1`, worst first

Each directory is scored as its own scope at the repository head. The code score weights architecture 35, complexity 25, and smells 20; tests are left out because a module's tests live outside it. Parents and children are both listed.

| Module | Files | Code | Architecture | Complexity | Smells | Propagation cost | Files on cycles | p90 CCN | Functions over CCN 10 | ruff / KLOC | Duplicated lines | Type escapes / KLOC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| backend/providers | 4 | 46.1 | 45.8 | 23.0 | 75.6 | 0.250 | 0 | 11 | 10.7% | 1.1 | 0.0% | 17.4 |
| backend/api | 10 | 52.4 | 62.8 | 22.2 | 72.1 | 0.156 | 0 | 15 | 15.0% | 4.7 | 3.5% | 4.6 |
| backend | 70 | 56.1 | 62.9 | 30.6 | 75.9 | 0.088 | 2 | 12 | 12.7% | 3.2 | 2.3% | 7.6 |
| backend/management/commands | 7 | 56.5 | 66.7 | 29.7 | 72.3 | 0.000 | 0 | 14 | 25.8% | 0.0 | 1.1% | 22.3 |
| backend/services | 13 | 60.3 | 70.6 | 24.5 | 87.1 | 0.019 | 0 | 12 | 13.1% | 1.9 | 0.8% | 4.8 |
| frontend/Workflows/hogflows/react_flow_utils | 3 | 66.2 | 72.2 | 77.9 | 41.2 | 0.333 | 0 | 6 | 0.0% | — | 3.5% | 0.0 |
| backend/models/hog_flow | 3 | 67.0 | 38.9 | 95.0 | 81.0 | 0.333 | 0 | 3 | 0.0% | 0.0 | 7.6% | 0.0 |
| frontend/Workflows/hogflows/panel/testing | 4 | 68.4 | 72.2 | 68.0 | 62.3 | 0.333 | 0 | 5 | 3.1% | — | 16.3% | 4.5 |
| frontend/Workflows/hogflows | 105 | 71.1 | 59.0 | 80.2 | 80.9 | 0.276 | 17 | 5 | 2.1% | — | 4.0% | 4.7 |
| backend/tasks | 6 | 72.3 | 58.3 | 69.6 | 100.0 | 0.100 | 0 | 7 | 0.0% | 0.0 | 0.0% | 0.0 |
| backend/models | 11 | 76.3 | 57.6 | 98.0 | 81.9 | 0.109 | 0 | 3 | 0.0% | 0.0 | 3.6% | 7.3 |
| frontend/Workflows | 158 | 76.7 | 72.1 | 79.3 | 81.4 | 0.191 | 17 | 5 | 2.0% | — | 3.7% | 4.3 |
| mcp/apps | 7 | 78.2 | 66.7 | 76.9 | 100.0 | 0.405 | 0 | 6 | 8.3% | — | 0.0% | 0.0 |
| frontend/Workflows/hogflows/registry/triggers | 14 | 78.3 | 88.6 | 82.1 | 55.5 | 0.137 | 0 | 5 | 1.1% | — | 7.8% | 20.2 |
| backend/utils | 4 | 78.5 | 59.7 | 87.5 | 100.0 | 0.083 | 0 | 5 | 0.0% | 0.0 | 0.0% | 0.0 |
| frontend/Workflows/hogflows/registry | 19 | 78.9 | 88.3 | 82.2 | 58.5 | 0.140 | 0 | 5 | 1.0% | — | 7.3% | 18.7 |
| frontend/Workflows/hogflows/panel | 15 | 79.3 | 85.3 | 78.5 | 69.9 | 0.176 | 0 | 5 | 2.5% | — | 9.0% | 3.7 |
| frontend/Workflows/Reputation | 3 | 79.6 | 66.7 | 81.2 | 100.0 | 0.500 | 0 | 3 | 0.0% | — | 0.0% | 0.0 |
| frontend/Workflows/hogflows/filters | 3 | 79.8 | 86.1 | 82.4 | 65.6 | 0.167 | 0 | 8 | 0.0% | — | 0.0% | 7.5 |
| frontend/Channels | 14 | 80.7 | 69.0 | 94.0 | 84.4 | 0.181 | 2 | 3 | 0.0% | — | 5.0% | 2.5 |
| frontend | 226 | 81.6 | 81.6 | 80.7 | 82.8 | 0.109 | 19 | 5 | 1.8% | — | 3.6% | 3.9 |
| frontend/Workflows/hogflows/registry/actions | 4 | 82.0 | 66.7 | 89.0 | 100.0 | 0.417 | 0 | 5 | 0.0% | — | 0.0% | 0.0 |
| frontend/Suppression | 3 | 82.7 | 66.7 | 91.2 | 100.0 | 0.500 | 0 | 4 | 0.0% | — | 0.0% | 0.0 |
| frontend/OptOuts | 14 | 84.4 | 84.0 | 78.9 | 92.1 | 0.192 | 0 | 4 | 2.1% | — | 1.2% | 3.9 |
| frontend/Workflows/hogflows/tree | 12 | 84.7 | 79.8 | 81.5 | 97.3 | 0.242 | 0 | 5 | 1.5% | — | 0.0% | 0.7 |
| frontend/Workflows/templates | 12 | 85.5 | 86.7 | 81.2 | 88.9 | 0.159 | 0 | 5 | 2.4% | — | 0.0% | 5.4 |
| frontend/emptyState | 3 | 87.2 | 72.2 | 98.0 | 100.0 | 0.333 | 0 | 3 | 0.0% | — | 0.0% | 0.0 |
| frontend/Workflows/hogflows/steps | 43 | 88.1 | 91.6 | 81.2 | 90.6 | 0.101 | 0 | 5 | 2.7% | — | 2.2% | 1.9 |
| frontend/Broadcasts | 17 | 88.2 | 83.8 | 88.9 | 95.0 | 0.195 | 0 | 5 | 0.8% | — | 0.0% | 4.0 |
| frontend/TemplateLibrary | 10 | 88.3 | 80.6 | 94.1 | 94.7 | 0.233 | 0 | 3 | 0.0% | — | 0.0% | 0.8 |
| backend/admin | 5 | 88.7 | 83.3 | 87.3 | 100.0 | 0.200 | 0 | 5 | 0.0% | 0.0 | 0.0% | 0.0 |
| frontend/Workflows/hogflows/steps/components | 19 | 89.2 | 96.3 | 74.9 | 94.7 | 0.044 | 0 | 6 | 4.2% | — | 0.0% | 1.2 |
| frontend/Broadcasts/steps | 5 | 90.5 | 100.0 | 69.5 | 100.0 | 0.000 | 0 | 7 | 0.0% | — | 0.0% | 0.0 |
| frontend/scenes/settings | 3 | 96.4 | 100.0 | 88.5 | 100.0 | 0.000 | 0 | 6 | 0.0% | — | 0.0% | 0.0 |
