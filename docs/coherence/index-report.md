# Coherence Index: posthog `c25b27f874a162fb5510cc5b26cc4c6e853ddde8`, 27 weekly points (2026-03-23 to 2026-09-21)

Built 2026-09-27 at `c25b27f874a1`. 427 commits measured in 427.1 s across all backfill runs; the last run took 96.8 s (59 measured, 287 reused). The full report with charts is [index-report.html](index-report.html).

## Is the index trustworthy?

The index has no measurement noise; the band is the 90th percentile of one weekday of ordinary commits, measured on Wednesday→Thursday pairs in weeks where the product changed.

| Product | Composite now | Change | Day pairs | Weekday median | Weekday band (p90) | Typical week | Largest week |
| --- | --- | --- | --- | --- | --- | --- | --- |
| products/workflows | 70.6 | −0.1 | 23 | 0.1 | ±0.3 | 0.2 | +1.5 (ending 2026-06-08) |
| products/surveys | 57.6 | −19.9 | 17 | 0.1 | ±4.2 | 0.4 | −19.1 (ending 2026-03-30) |
| products/error_tracking | 79.4 | +3.7 | 26 | 0.0 | ±0.2 | 0.3 | +2.8 (ending 2026-04-20) |

## Scores at 2026-09-21

| Product | composite | architecture | complexity | smells | tests |
| --- | --- | --- | --- | --- | --- |
| products/workflows | 70.6 | 70.2 | 71.1 | 79.7 | 52.6 |
| products/surveys | 57.6 | 52.9 | 31.8 | 76.8 | 100.0 |
| products/error_tracking | 79.4 | 91.2 | 81.3 | 82.5 | 27.1 |

## Weekday band per dimension

| Product | architecture | complexity | smells | tests |
| --- | --- | --- | --- | --- |
| products/workflows | ±0.5 | ±0.7 | ±0.9 | ±1.0 |
| products/surveys | ±2.6 | ±2.9 | ±2.3 | ±0.1 |
| products/error_tracking | ±0.1 | ±0.2 | ±0.5 | ±0.6 |

## Biggest movers, per product

| Product | Δ composite | × band | Date | Moved most | Change |
| --- | --- | --- | --- | --- | --- |
| workflows | −1.3 | 4.3× | 2026-05-29 | tests +7.5 | chore(devex): move workflows + cdp models to products apps [#60248](https://github.com/PostHog/posthog/pull/60248) [`fefcae2`](https://github.com/PostHog/posthog/commit/fefcae2b83f33439bc9e179596fed91c9649e1cf) |
| workflows | −0.7 | 2.2× | 2026-08-03 | architecture −1.3 | feat(workflows): surgical email patching for workflow email steps [#76015](https://github.com/PostHog/posthog/pull/76015) [`ae741c0`](https://github.com/PostHog/posthog/commit/ae741c00f9689f9ee00314d71c4ed2d801294463) |
| workflows | +0.6 | 2.1× | 2026-06-07 | architecture +1.6 | refactor(frontend): remove defunct tabId from workflows scenes [#62026](https://github.com/PostHog/posthog/pull/62026) [`58e8f53`](https://github.com/PostHog/posthog/commit/58e8f530f8be560fc2e59210f1a790d11dbd4a62) |
| workflows | −0.6 | 2.1× | 2026-08-04 | architecture −0.9 | feat(workflows): account audience for the batch trigger [#76808](https://github.com/PostHog/posthog/pull/76808) [`80e0a4a`](https://github.com/PostHog/posthog/commit/80e0a4a8348d0e4ea58fbef1946a968193254f58) |
| workflows | +0.4 | 1.3× | 2026-06-01 | smells +1.2 | feat(workflows): add base MCP tools for workflows product [#60388](https://github.com/PostHog/posthog/pull/60388) [`6970121`](https://github.com/PostHog/posthog/commit/6970121e6400d8766641cb3a7d33ce3b6c661d85) |
| surveys | −18.9 | 4.5× | 2026-03-23 | tests +42.0 | chore(surveys): move survey models and API to products app [#51611](https://github.com/PostHog/posthog/pull/51611) [`731051c`](https://github.com/PostHog/posthog/commit/731051cb6951587692dc1c86eaba65a70add4fbf) |
| surveys | −9.3 | 2.2× | 2026-04-23 | smells −26.3 | feat(devex): generate Zod validation schemas from OpenAPI spec [#54698](https://github.com/PostHog/posthog/pull/54698) [`fbfbfb7`](https://github.com/PostHog/posthog/commit/fbfbfb7a12985fa0d9a252646378be42eea548b2) |
| surveys | +6.0 | 1.4× | 2026-05-20 | smells +27.3 | refactor(onboarding): compose flow from per-product step providers [#57579](https://github.com/PostHog/posthog/pull/57579) [`706db7c`](https://github.com/PostHog/posthog/commit/706db7c3d5ee4ab321334a717d365fc6d43d5616) |
| surveys | −1.6 | 0.4× | 2026-05-21 | complexity −4.6 | feat(surveys): replace 'Default' translation with explicit base_language [#58628](https://github.com/PostHog/posthog/pull/58628) [`1095361`](https://github.com/PostHog/posthog/commit/1095361a044ac7586ab30fc033b035f7b624d322) |
| surveys | −0.4 | 0.1× | 2026-05-21 | architecture −1.0 | chore(devex): move alert and action models to product folders [#59224](https://github.com/PostHog/posthog/pull/59224) [`54d24c8`](https://github.com/PostHog/posthog/commit/54d24c825c63ac7f957f308f6ae2c9b15fdecf49) |
| error_tracking | +1.9 | 8.0× | 2026-04-16 | tests +15.6 | feat(error_tracking): migrate digest and task callers to facade [#54749](https://github.com/PostHog/posthog/pull/54749) [`9a84ad6`](https://github.com/PostHog/posthog/commit/9a84ad66f544fd737550396c036df2280a6c4c1c) |
| error_tracking | −1.0 | 4.2× | 2026-04-09 | smells −3.6 | feat: error tracking v3 query [#53303](https://github.com/PostHog/posthog/pull/53303) [`3a3205c`](https://github.com/PostHog/posthog/commit/3a3205c09caa01811e195c3556965f57a3722785) |
| error_tracking | −0.8 | 3.2× | 2026-06-23 | smells −2.9 | chore(error_tracking): complete facade presentation wave [#64880](https://github.com/PostHog/posthog/pull/64880) [`2063736`](https://github.com/PostHog/posthog/commit/2063736de527ca41df6eed008d879f6232540a94) |
| error_tracking | +0.4 | 1.7× | 2026-04-16 | architecture +1.0 | feat(error_tracking): migrate issue readers to facade [#54724](https://github.com/PostHog/posthog/pull/54724) [`cf7a565`](https://github.com/PostHog/posthog/commit/cf7a56580c53092b9a2364bfbbb2357e749df153) |
| error_tracking | +0.4 | 1.6× | 2026-04-19 | complexity +1.0 | feat: et recommendations - alerts [#55053](https://github.com/PostHog/posthog/pull/55053) [`8b91349`](https://github.com/PostHog/posthog/commit/8b91349d26b29fa8cad780f01c8949d7b37cc6d8) |

## products/workflows modules at `c25b27f874a1`, worst first

Each directory is scored as its own scope at the repository head. The code score weights architecture 35, complexity 25, and smells 20; tests are left out because a module's tests live outside it. Parents and children are both listed.

| Module | Files | Code | Architecture | Complexity | Smells | Propagation cost | Files on cycles | p90 CCN | Functions over CCN 10 | ruff / KLOC | Duplicated lines | Type escapes / KLOC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| backend | 70 | 60.1 | 72.2 | 30.6 | 75.9 | 0.088 | 2 | 12 | 12.7% | 3.2 | 2.3% | 7.6 |
| backend/providers | 4 | 60.3 | 78.2 | 23.0 | 75.6 | 0.250 | 0 | 11 | 10.7% | 1.1 | 0.0% | 17.4 |
| backend/api | 10 | 60.7 | 81.7 | 22.2 | 72.1 | 0.156 | 0 | 15 | 15.0% | 4.7 | 3.5% | 4.6 |
| frontend/Workflows/hogflows/react_flow_utils | 3 | 66.2 | 72.2 | 77.9 | 41.2 | 0.333 | 0 | 6 | 0.0% | — | 3.5% | 0.0 |
| frontend/Workflows/hogflows/panel/testing | 4 | 68.4 | 72.2 | 68.0 | 62.3 | 0.333 | 0 | 5 | 3.1% | — | 16.3% | 4.5 |
| backend/management/commands | 7 | 70.8 | 99.3 | 29.7 | 72.3 | 0.000 | 0 | 14 | 25.8% | 0.0 | 1.1% | 22.3 |
| backend/services | 13 | 71.0 | 95.1 | 24.5 | 87.1 | 0.019 | 0 | 12 | 13.1% | 1.9 | 0.8% | 4.8 |
| frontend/Workflows/hogflows | 105 | 71.1 | 59.1 | 80.2 | 80.9 | 0.276 | 17 | 5 | 2.1% | — | 4.0% | 4.7 |
| frontend/Workflows | 158 | 76.7 | 72.1 | 79.3 | 81.4 | 0.191 | 17 | 5 | 2.0% | — | 3.7% | 4.3 |
| mcp/apps | 7 | 78.2 | 66.7 | 76.9 | 100.0 | 0.405 | 0 | 6 | 8.3% | — | 0.0% | 0.0 |
| frontend/Workflows/hogflows/registry/triggers | 14 | 78.3 | 88.5 | 82.1 | 55.5 | 0.137 | 0 | 5 | 1.1% | — | 7.8% | 20.2 |
| frontend/Workflows/hogflows/registry | 19 | 78.9 | 88.3 | 82.2 | 58.5 | 0.140 | 0 | 5 | 1.0% | — | 7.3% | 18.7 |
| frontend/Workflows/hogflows/panel | 15 | 79.3 | 85.3 | 78.5 | 69.9 | 0.176 | 0 | 5 | 2.5% | — | 9.0% | 3.7 |
| frontend/Workflows/Reputation | 3 | 79.5 | 66.7 | 81.2 | 100.0 | 0.500 | 0 | 3 | 0.0% | — | 0.0% | 0.0 |
| frontend/Workflows/hogflows/filters | 3 | 79.8 | 86.1 | 82.4 | 65.6 | 0.167 | 0 | 8 | 0.0% | — | 0.0% | 7.5 |
| backend/models/hog_flow | 3 | 80.2 | 69.2 | 95.0 | 81.0 | 0.333 | 0 | 3 | 0.0% | 0.0 | 7.6% | 0.0 |
| frontend/Channels | 14 | 80.7 | 69.0 | 94.0 | 84.4 | 0.181 | 2 | 3 | 0.0% | — | 5.0% | 2.5 |
| frontend | 226 | 81.6 | 81.6 | 80.7 | 82.8 | 0.109 | 19 | 5 | 1.8% | — | 3.6% | 3.9 |
| frontend/Workflows/hogflows/registry/actions | 4 | 82.0 | 66.7 | 89.0 | 100.0 | 0.417 | 0 | 5 | 0.0% | — | 0.0% | 0.0 |
| frontend/Suppression | 3 | 82.7 | 66.7 | 91.2 | 100.0 | 0.500 | 0 | 4 | 0.0% | — | 0.0% | 0.0 |
| frontend/OptOuts | 14 | 84.4 | 84.0 | 78.9 | 92.1 | 0.192 | 0 | 4 | 2.1% | — | 1.2% | 3.9 |
| frontend/Workflows/hogflows/tree | 12 | 84.7 | 79.8 | 81.5 | 97.3 | 0.242 | 0 | 5 | 1.5% | — | 0.0% | 0.7 |
| frontend/Workflows/templates | 12 | 85.5 | 86.7 | 81.2 | 88.8 | 0.159 | 0 | 5 | 2.4% | — | 0.0% | 5.4 |
| backend/tasks | 6 | 86.1 | 90.0 | 69.6 | 100.0 | 0.100 | 0 | 7 | 0.0% | 0.0 | 0.0% | 0.0 |
| frontend/emptyState | 3 | 87.2 | 72.2 | 98.0 | 100.0 | 0.333 | 0 | 3 | 0.0% | — | 0.0% | 0.0 |
| frontend/Workflows/hogflows/steps | 43 | 88.1 | 91.6 | 81.2 | 90.5 | 0.101 | 0 | 5 | 2.7% | — | 2.2% | 1.9 |
| frontend/Broadcasts | 17 | 88.1 | 83.8 | 88.8 | 94.9 | 0.195 | 0 | 5 | 0.8% | — | 0.0% | 4.0 |
| frontend/TemplateLibrary | 10 | 88.3 | 80.6 | 94.1 | 94.7 | 0.233 | 0 | 3 | 0.0% | — | 0.0% | 0.8 |
| backend/admin | 5 | 88.7 | 83.3 | 87.3 | 100.0 | 0.200 | 0 | 5 | 0.0% | 0.0 | 0.0% | 0.0 |
| backend/models | 11 | 89.0 | 86.6 | 98.0 | 81.9 | 0.109 | 0 | 3 | 0.0% | 0.0 | 3.6% | 7.3 |
| frontend/Workflows/hogflows/steps/components | 19 | 89.2 | 96.3 | 74.9 | 94.7 | 0.044 | 0 | 6 | 4.2% | — | 0.0% | 1.2 |
| frontend/Broadcasts/steps | 5 | 90.5 | 100.0 | 69.5 | 100.0 | 0.000 | 0 | 7 | 0.0% | — | 0.0% | 0.0 |
| backend/utils | 4 | 92.6 | 92.1 | 87.5 | 100.0 | 0.083 | 0 | 5 | 0.0% | 0.0 | 0.0% | 0.0 |
| frontend/scenes/settings | 3 | 96.4 | 100.0 | 88.5 | 100.0 | 0.000 | 0 | 6 | 0.0% | — | 0.0% | 0.0 |
