# Coherence Index: posthog `upstream/master`, 27 weekly points (2026-03-23 to 2026-09-21)

Built 2026-09-26 at `c25b27f874a1`. The last backfill run took 302.2 s: 131 commits measured, 238 reused. The full report with charts is [index-report.html](index-report.html).

## Is the index trustworthy?

| Product | Composite now | Change | Day pairs | Median day-to-day | Noise band (p90) | Weekly steps beyond band |
| --- | --- | --- | --- | --- | --- | --- |
| products/workflows | 59.7 | +7.1 | 23 | 0.1 | ±0.6 | 6 of 26 |
| products/surveys | 46.2 | −12.3 | 17 | 0.0 | ±3.9 | 3 of 26 |
| products/error_tracking | 71.5 | +11.9 | 26 | 0.1 | ±0.4 | 13 of 26 |

## Scores at 2026-09-21

| Product | composite | architecture | complexity | smells | tests |
| --- | --- | --- | --- | --- | --- |
| products/workflows | 59.7 | 59.3 | 71.1 | 79.7 | 26.3 |
| products/surveys | 46.2 | 36.7 | 31.8 | 76.8 | 50.0 |
| products/error_tracking | 71.5 | 83.7 | 81.3 | 82.5 | 27.1 |

## Noise band per dimension

| Product | architecture | complexity | smells | tests |
| --- | --- | --- | --- | --- |
| products/workflows | ±0.5 | ±0.6 | ±0.9 | ±0.8 |
| products/surveys | ±2.6 | ±2.9 | ±2.3 | ±0.0 |
| products/error_tracking | ±0.5 | ±0.2 | ±0.5 | ±0.7 |

## Biggest movers

| Δ composite | × band | Product | Date | Moved most | Change |
| --- | --- | --- | --- | --- | --- |
| −13.7 | 3.5× | surveys | 2026-03-23 | complexity −41.5 | chore(surveys): move survey models and API to products app [#51611](https://github.com/PostHog/posthog/pull/51611) [`731051c`](https://github.com/PostHog/posthog/commit/731051cb6951587692dc1c86eaba65a70add4fbf) |
| +10.4 | 26.0× | error_tracking | 2026-04-15 | tests +50.1 | feat(error_tracking): add issue facade kickoff [#54718](https://github.com/PostHog/posthog/pull/54718) [`4c6495d`](https://github.com/PostHog/posthog/commit/4c6495dec83ced70b5efc763f027ab0189952ea3) |
| −8.3 | 2.1× | surveys | 2026-04-23 | smells −26.3 | feat(devex): generate Zod validation schemas from OpenAPI spec [#54698](https://github.com/PostHog/posthog/pull/54698) [`fbfbfb7`](https://github.com/PostHog/posthog/commit/fbfbfb7a12985fa0d9a252646378be42eea548b2) |
| +5.4 | 1.4× | surveys | 2026-05-20 | smells +27.3 | refactor(onboarding): compose flow from per-product step providers [#57579](https://github.com/PostHog/posthog/pull/57579) [`706db7c`](https://github.com/PostHog/posthog/commit/706db7c3d5ee4ab321334a717d365fc6d43d5616) |
| −4.6 | 11.5× | error_tracking | 2026-04-16 | tests −24.9 | feat(error_tracking): migrate digest and task callers to facade [#54749](https://github.com/PostHog/posthog/pull/54749) [`9a84ad6`](https://github.com/PostHog/posthog/commit/9a84ad66f544fd737550396c036df2280a6c4c1c) |
| +1.6 | 4.0× | error_tracking | 2026-07-06 | architecture +4.6 | chore(error-tracking): seal external boundary and enable contract-check [#65456](https://github.com/PostHog/posthog/pull/65456) [`c5f763e`](https://github.com/PostHog/posthog/commit/c5f763e280d5209a4f243608902c263b51529e6c) |
| +1.5 | 3.8× | error_tracking | 2026-04-16 | architecture +4.4 | feat(error_tracking): migrate issue readers to facade [#54724](https://github.com/PostHog/posthog/pull/54724) [`cf7a565`](https://github.com/PostHog/posthog/commit/cf7a56580c53092b9a2364bfbbb2357e749df153) |
| −1.5 | 0.4× | surveys | 2026-05-21 | complexity −4.6 | feat(surveys): replace 'Default' translation with explicit base_language [#58628](https://github.com/PostHog/posthog/pull/58628) [`1095361`](https://github.com/PostHog/posthog/commit/1095361a044ac7586ab30fc033b035f7b624d322) |
| +0.9 | 2.3× | error_tracking | 2026-07-14 | tests +4.5 | perf(error-tracking): cut weekly digest clickhouse query load [#70471](https://github.com/PostHog/posthog/pull/70471) [`35a43af`](https://github.com/PostHog/posthog/commit/35a43af6cf0b01c7acb7f9acd7adc7583cba048e) |
| +0.6 | 1.0× | workflows | 2026-06-07 | architecture +1.6 | refactor(frontend): remove defunct tabId from workflows scenes [#62026](https://github.com/PostHog/posthog/pull/62026) [`58e8f53`](https://github.com/PostHog/posthog/commit/58e8f530f8be560fc2e59210f1a790d11dbd4a62) |

## products/workflows modules at `6bbc94fa5128`, worst first

The code score weights architecture 35, complexity 25, and smells 20; tests are left out because a module's tests live outside it.

| Module | Files | Code | Architecture | Complexity | Smells | Propagation cost | Files on cycles | p90 CCN | Functions over CCN 10 | ruff / KLOC | Duplicated lines | Type escapes / KLOC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| backend/providers | 4 | 46.1 | 45.8 | 23.0 | 75.6 | 0.250 | 0 | 11 | 10.7% | 1.1 | 0.0% | 17.4 |
| backend/api | 11 | 53.3 | 65.2 | 22.2 | 71.3 | 0.127 | 0 | 14 | 15.5% | 4.7 | 3.7% | 4.9 |
| backend | 69 | 55.2 | 62.5 | 28.6 | 75.5 | 0.077 | 2 | 12 | 12.8% | 3.2 | 2.6% | 7.3 |
| backend/management/commands | 7 | 56.5 | 66.7 | 29.7 | 72.3 | 0.000 | 0 | 14 | 25.8% | 0.0 | 1.1% | 22.3 |
| backend/services | 13 | 62.2 | 71.1 | 30.7 | 85.9 | 0.019 | 0 | 11 | 11.7% | 1.8 | 2.1% | 3.5 |
| frontend/Workflows/hogflows/react_flow_utils | 3 | 66.2 | 72.2 | 77.9 | 41.2 | 0.333 | 0 | 6 | 0.0% | — | 3.5% | 0.0 |
| backend/models/hog_flow | 3 | 66.9 | 38.9 | 95.0 | 80.9 | 0.333 | 0 | 3 | 0.0% | 0.0 | 7.6% | 0.0 |
| frontend/Workflows/hogflows/panel/testing | 4 | 67.6 | 72.2 | 66.1 | 61.6 | 0.333 | 0 | 6 | 3.4% | — | 17.8% | 4.8 |
| frontend/Workflows/hogflows | 98 | 71.8 | 61.0 | 80.1 | 80.3 | 0.277 | 14 | 5 | 2.2% | — | 4.1% | 4.8 |
| backend/tasks | 6 | 72.3 | 58.3 | 69.6 | 100.0 | 0.100 | 0 | 7 | 0.0% | 0.0 | 0.0% | 0.0 |
| backend/models | 10 | 76.2 | 56.5 | 98.0 | 83.6 | 0.122 | 0 | 3 | 0.0% | 0.0 | 4.3% | 4.5 |
| frontend/Workflows | 151 | 77.5 | 74.0 | 79.4 | 81.1 | 0.188 | 14 | 5 | 2.0% | — | 3.8% | 4.3 |
| mcp/apps | 7 | 78.2 | 66.7 | 76.9 | 100.0 | 0.405 | 0 | 6 | 8.3% | — | 0.0% | 0.0 |
| frontend/Workflows/hogflows/registry/triggers | 14 | 78.3 | 88.6 | 82.1 | 55.5 | 0.137 | 0 | 5 | 1.1% | — | 7.8% | 20.2 |
| backend/utils | 4 | 78.5 | 59.7 | 87.5 | 100.0 | 0.083 | 0 | 5 | 0.0% | 0.0 | 0.0% | 0.0 |
| frontend/Workflows/hogflows/registry | 19 | 78.9 | 88.3 | 82.2 | 58.5 | 0.140 | 0 | 5 | 1.0% | — | 7.3% | 18.7 |
| frontend/Workflows/hogflows/panel | 15 | 79.0 | 85.3 | 78.4 | 68.7 | 0.176 | 0 | 5 | 2.6% | — | 9.4% | 3.8 |
| frontend/Workflows/hogflows/tree | 9 | 79.1 | 75.7 | 69.6 | 96.8 | 0.292 | 0 | 6 | 2.0% | — | 0.0% | 0.9 |
| frontend/Workflows/Reputation | 3 | 79.6 | 66.7 | 81.2 | 100.0 | 0.500 | 0 | 3 | 0.0% | — | 0.0% | 0.0 |
| frontend/Channels | 14 | 80.7 | 69.0 | 94.0 | 84.4 | 0.181 | 2 | 3 | 0.0% | — | 5.0% | 2.5 |
| frontend | 202 | 81.5 | 81.6 | 80.5 | 82.6 | 0.115 | 16 | 5 | 1.9% | — | 3.6% | 3.9 |
| frontend/Workflows/hogflows/registry/actions | 4 | 82.0 | 66.7 | 89.0 | 100.0 | 0.417 | 0 | 5 | 0.0% | — | 0.0% | 0.0 |
| frontend/Suppression | 3 | 82.7 | 66.7 | 91.2 | 100.0 | 0.500 | 0 | 4 | 0.0% | — | 0.0% | 0.0 |
| frontend/OptOuts | 14 | 84.4 | 84.0 | 78.9 | 92.1 | 0.192 | 0 | 4 | 2.1% | — | 1.2% | 3.9 |
| frontend/Workflows/templates | 12 | 85.5 | 86.7 | 81.2 | 88.9 | 0.159 | 0 | 5 | 2.4% | — | 0.0% | 5.4 |
| frontend/emptyState | 3 | 87.2 | 72.2 | 98.0 | 100.0 | 0.333 | 0 | 3 | 0.0% | — | 0.0% | 0.0 |
| frontend/Workflows/hogflows/steps | 40 | 88.0 | 91.3 | 81.2 | 90.7 | 0.104 | 0 | 5 | 2.5% | — | 2.3% | 1.6 |
| frontend/TemplateLibrary | 10 | 88.3 | 80.6 | 94.1 | 94.7 | 0.233 | 0 | 3 | 0.0% | — | 0.0% | 0.8 |
| backend/admin | 5 | 88.7 | 83.3 | 87.3 | 100.0 | 0.200 | 0 | 5 | 0.0% | 0.0 | 0.0% | 0.0 |
| frontend/Workflows/hogflows/steps/components | 17 | 89.8 | 95.7 | 73.8 | 99.5 | 0.051 | 0 | 6 | 3.8% | — | 0.0% | 0.4 |
| frontend/scenes/settings | 3 | 96.4 | 100.0 | 88.5 | 100.0 | 0.000 | 0 | 6 | 0.0% | — | 0.0% | 0.0 |
