# Coherence Index: posthog `c25b27f874a162fb5510cc5b26cc4c6e853ddde8`, 27 weekly points (2026-03-23 to 2026-09-21)

Built 2026-09-27 at `c25b27f874a1`. 472 commits measured in 512.8 s across all backfill runs; the last run took 8.5 s (0 measured, 342 reused). The full report with charts is [index-report.html](index-report.html).

## Is the index trustworthy?

The index has no measurement noise; the band is the 90th percentile of one weekday of ordinary commits, measured on Wednesday→Thursday pairs in weeks where the product changed.

| Product | Composite now | Change | Day pairs | Weekday median | Weekday band (p90) | Typical week | Largest week |
| --- | --- | --- | --- | --- | --- | --- | --- |
| products/workflows | 76.0 | +4.1 | 23 | 0.1 | ±0.3 | 0.2 | +1.6 (ending 2026-06-08) |
| products/surveys | 54.8 | −20.0 | 17 | 0.1 | ±1.4 | 0.5 | −22.2 (ending 2026-03-30) |
| products/error_tracking | 83.1 | +4.6 | 26 | 0.0 | ±0.3 | 0.2 | +1.1 (ending 2026-06-15) |

## Scores at 2026-09-21

| Product | composite | architecture | complexity | smells | tests |
| --- | --- | --- | --- | --- | --- |
| products/workflows | 76.0 | 83.6 | 71.1 | 79.7 | 52.6 |
| products/surveys | 54.8 | 49.8 | 31.8 | 76.8 | 100.0 |
| products/error_tracking | 83.1 | 95.6 | 81.3 | 82.5 | 39.2 |

## Weekday band per dimension

| Product | architecture | complexity | smells | tests |
| --- | --- | --- | --- | --- |
| products/workflows | ±0.5 | ±0.7 | ±0.9 | ±1.0 |
| products/surveys | ±9.7 | ±2.9 | ±2.3 | ±0.1 |
| products/error_tracking | ±0.2 | ±0.2 | ±0.5 | ±0.6 |

## Biggest movers, per product

Every facade bypass costs the same per thousand production lines. A commit that moves code into a product, such as models moving into a products app, can expose imports that already crossed into it: they count as new bypasses. Under the rule that is correct, since the coupling was always there, but it is a change in what the index sees, not new coupling.

| Product | Δ composite | × band | Date | Moved most | Change |
| --- | --- | --- | --- | --- | --- |
| workflows | −1.3 | 5.2× | 2026-03-24 | tests −4.4 | chore(messaging): move messaging models to products app [#51608](https://github.com/PostHog/posthog/pull/51608) [`d56970d`](https://github.com/PostHog/posthog/commit/d56970d60bf90aa7281699171b8a42792be850cd) |
| workflows | −0.9 | 3.3× | 2026-05-29 | tests +7.5 | chore(devex): move workflows + cdp models to products apps [#60248](https://github.com/PostHog/posthog/pull/60248) [`fefcae2`](https://github.com/PostHog/posthog/commit/fefcae2b83f33439bc9e179596fed91c9649e1cf) |
| workflows | +0.7 | 2.8× | 2026-03-27 | smells +1.3 | feat(workflows): Add recurring schedule support for batch triggers [#51875](https://github.com/PostHog/posthog/pull/51875) [`3724fa6`](https://github.com/PostHog/posthog/commit/3724fa6cb2cc5767458e0391d7b30fd3c9db66ff) |
| workflows | +0.6 | 2.5× | 2026-06-07 | architecture +1.6 | refactor(frontend): remove defunct tabId from workflows scenes [#62026](https://github.com/PostHog/posthog/pull/62026) [`58e8f53`](https://github.com/PostHog/posthog/commit/58e8f530f8be560fc2e59210f1a790d11dbd4a62) |
| workflows | +0.4 | 1.5× | 2026-06-01 | smells +1.2 | feat(workflows): add base MCP tools for workflows product [#60388](https://github.com/PostHog/posthog/pull/60388) [`6970121`](https://github.com/PostHog/posthog/commit/6970121e6400d8766641cb3a7d33ce3b6c661d85) |
| surveys | −21.9 | 15.2× | 2026-03-23 | tests +42.0 | chore(surveys): move survey models and API to products app [#51611](https://github.com/PostHog/posthog/pull/51611) [`731051c`](https://github.com/PostHog/posthog/commit/731051cb6951587692dc1c86eaba65a70add4fbf) |
| surveys | −7.3 | 5.0× | 2026-04-23 | smells −26.3 | feat(devex): generate Zod validation schemas from OpenAPI spec [#54698](https://github.com/PostHog/posthog/pull/54698) [`fbfbfb7`](https://github.com/PostHog/posthog/commit/fbfbfb7a12985fa0d9a252646378be42eea548b2) |
| surveys | +5.8 | 4.0× | 2026-03-30 | complexity +11.4 | refactor: Multitude of simplifications for MCP Apps [#51379](https://github.com/PostHog/posthog/pull/51379) [`cd4d507`](https://github.com/PostHog/posthog/commit/cd4d507fd89b9a50dedac829d7926a0e4d0939c6) |
| surveys | −0.3 | 0.2× | 2026-03-26 | architecture −0.6 | fix(feature-flags): update null checks to enable per-condition aggregation_group_type_index [#52179](https://github.com/PostHog/posthog/pull/52179) [`f950f8e`](https://github.com/PostHog/posthog/commit/f950f8e267af213b2f2ced4718110131d1a6f72f) |
| surveys | +0.2 | 0.1× | 2026-04-23 | smells +0.8 | chore(devex): enforce type annotations in product backend code [#55443](https://github.com/PostHog/posthog/pull/55443) [`7d69f05`](https://github.com/PostHog/posthog/commit/7d69f056cc748e537af13ff15e997e1b5c552b98) |
| error_tracking | −0.9 | 3.4× | 2026-04-09 | smells −3.6 | feat: error tracking v3 query [#53303](https://github.com/PostHog/posthog/pull/53303) [`3a3205c`](https://github.com/PostHog/posthog/commit/3a3205c09caa01811e195c3556965f57a3722785) |
| error_tracking | +0.5 | 1.7× | 2026-06-12 | smells +1.5 | chore(error-tracking): make V3 the only error tracking query path [#63007](https://github.com/PostHog/posthog/pull/63007) [`5fdf681`](https://github.com/PostHog/posthog/commit/5fdf6815648a739a66a6641adcdb42b9c9474b8e) |
| error_tracking | +0.4 | 1.6× | 2026-04-19 | complexity +1.0 | feat: et recommendations - alerts [#55053](https://github.com/PostHog/posthog/pull/55053) [`8b91349`](https://github.com/PostHog/posthog/commit/8b91349d26b29fa8cad780f01c8949d7b37cc6d8) |
| error_tracking | +0.4 | 1.5× | 2026-04-15 | complexity +1.0 | feat(error_tracking): add issue facade kickoff [#54718](https://github.com/PostHog/posthog/pull/54718) [`4c6495d`](https://github.com/PostHog/posthog/commit/4c6495dec83ced70b5efc763f027ab0189952ea3) |
| error_tracking | −0.3 | 1.2× | 2026-04-16 | complexity −1.0 | feat(error-tracking): exception steps and adaptive loading [#52593](https://github.com/PostHog/posthog/pull/52593) [`e126f1b`](https://github.com/PostHog/posthog/commit/e126f1bc9f1e4400a7ba1979610792b565fb146d) |

## products/workflows modules at `c25b27f874a1`, worst first

Each directory is scored as its own scope at the repository head. The code score weights architecture 40, complexity 30, and smells 20; tests are left out because a module's tests live outside it. Parents and children are both listed.

| Module | Files | Code | Architecture | Complexity | Smells | Propagation cost | Files on cycles | p90 CCN | Functions over CCN 10 | ruff / KLOC | Duplicated lines | Type escapes / KLOC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| backend/providers | 4 | 54.8 | 68.3 | 23.0 | 75.6 | 0.250 | 0 | 11 | 10.7% | 1.1 | 0.0% | 17.4 |
| backend/api | 10 | 58.8 | 79.7 | 22.2 | 72.1 | 0.156 | 0 | 15 | 15.0% | 4.7 | 3.5% | 4.6 |
| backend | 70 | 61.0 | 76.4 | 30.6 | 75.9 | 0.088 | 2 | 12 | 12.7% | 3.2 | 2.3% | 7.6 |
| backend/services | 13 | 64.2 | 82.4 | 24.5 | 87.1 | 0.019 | 0 | 12 | 13.1% | 1.9 | 0.8% | 4.8 |
| backend/models/hog_flow | 3 | 66.9 | 38.9 | 95.0 | 81.0 | 0.333 | 0 | 3 | 0.0% | 0.0 | 7.6% | 0.0 |
| frontend/Workflows/hogflows/react_flow_utils | 3 | 67.2 | 72.2 | 77.9 | 41.2 | 0.333 | 0 | 6 | 0.0% | — | 3.5% | 0.0 |
| backend/management/commands | 7 | 67.3 | 92.9 | 29.7 | 72.3 | 0.000 | 0 | 14 | 25.8% | 0.0 | 1.1% | 22.3 |
| frontend/Workflows/hogflows/panel/testing | 4 | 68.6 | 72.2 | 68.0 | 62.3 | 0.333 | 0 | 5 | 3.1% | — | 16.3% | 4.5 |
| frontend/Workflows/hogflows | 105 | 70.9 | 59.1 | 80.2 | 80.9 | 0.276 | 17 | 5 | 2.1% | — | 4.0% | 4.7 |
| backend/tasks | 6 | 71.3 | 58.3 | 69.6 | 100.0 | 0.100 | 0 | 7 | 0.0% | 0.0 | 0.0% | 0.0 |
| backend/models | 11 | 76.5 | 57.6 | 98.0 | 81.9 | 0.109 | 0 | 3 | 0.0% | 0.0 | 3.6% | 7.3 |
| frontend/Workflows | 158 | 76.6 | 72.1 | 79.3 | 81.4 | 0.191 | 17 | 5 | 2.0% | — | 3.7% | 4.3 |
| mcp/apps | 7 | 77.5 | 66.7 | 76.9 | 100.0 | 0.405 | 0 | 6 | 8.3% | — | 0.0% | 0.0 |
| backend/utils | 4 | 77.9 | 59.7 | 87.5 | 100.0 | 0.083 | 0 | 5 | 0.0% | 0.0 | 0.0% | 0.0 |
| frontend/Workflows/Reputation | 3 | 78.9 | 66.7 | 81.2 | 100.0 | 0.500 | 0 | 3 | 0.0% | — | 0.0% | 0.0 |
| frontend/Workflows/hogflows/registry/triggers | 14 | 79.0 | 88.5 | 82.1 | 55.5 | 0.137 | 0 | 5 | 1.1% | — | 7.8% | 20.2 |
| frontend/Workflows/hogflows/panel | 15 | 79.6 | 85.3 | 78.5 | 69.9 | 0.176 | 0 | 5 | 2.5% | — | 9.0% | 3.7 |
| frontend/Workflows/hogflows/registry | 19 | 79.6 | 88.3 | 82.2 | 58.5 | 0.140 | 0 | 5 | 1.0% | — | 7.3% | 18.7 |
| frontend/Workflows/hogflows/filters | 3 | 80.3 | 86.1 | 82.4 | 65.6 | 0.167 | 0 | 8 | 0.0% | — | 0.0% | 7.5 |
| frontend/Channels | 14 | 80.8 | 69.0 | 94.0 | 84.4 | 0.181 | 2 | 3 | 0.0% | — | 5.0% | 2.5 |
| frontend/Workflows/hogflows/registry/actions | 4 | 81.5 | 66.7 | 89.0 | 100.0 | 0.417 | 0 | 5 | 0.0% | — | 0.0% | 0.0 |
| frontend | 226 | 81.6 | 81.6 | 80.7 | 82.8 | 0.109 | 19 | 5 | 1.8% | — | 3.6% | 3.9 |
| frontend/Suppression | 3 | 82.3 | 66.7 | 91.2 | 100.0 | 0.500 | 0 | 4 | 0.0% | — | 0.0% | 0.0 |
| frontend/OptOuts | 14 | 84.1 | 84.0 | 78.9 | 92.1 | 0.192 | 0 | 4 | 2.1% | — | 1.2% | 3.9 |
| frontend/Workflows/hogflows/tree | 12 | 84.3 | 79.8 | 81.5 | 97.3 | 0.242 | 0 | 5 | 1.5% | — | 0.0% | 0.7 |
| frontend/Workflows/templates | 12 | 85.4 | 86.7 | 81.2 | 88.8 | 0.159 | 0 | 5 | 2.4% | — | 0.0% | 5.4 |
| frontend/emptyState | 3 | 87.0 | 72.2 | 98.0 | 100.0 | 0.333 | 0 | 3 | 0.0% | — | 0.0% | 0.0 |
| frontend/Workflows/hogflows/steps | 43 | 87.9 | 91.6 | 81.2 | 90.5 | 0.101 | 0 | 5 | 2.7% | — | 2.2% | 1.9 |
| frontend/Broadcasts | 17 | 87.9 | 83.8 | 88.8 | 94.9 | 0.195 | 0 | 5 | 0.8% | — | 0.0% | 4.0 |
| frontend/TemplateLibrary | 10 | 88.2 | 80.6 | 94.1 | 94.7 | 0.233 | 0 | 3 | 0.0% | — | 0.0% | 0.8 |
| backend/admin | 5 | 88.4 | 83.3 | 87.3 | 100.0 | 0.200 | 0 | 5 | 0.0% | 0.0 | 0.0% | 0.0 |
| frontend/Workflows/hogflows/steps/components | 19 | 88.8 | 96.3 | 74.9 | 94.7 | 0.044 | 0 | 6 | 4.2% | — | 0.0% | 1.2 |
| frontend/Broadcasts/steps | 5 | 89.8 | 100.0 | 69.5 | 100.0 | 0.000 | 0 | 7 | 0.0% | — | 0.0% | 0.0 |
| frontend/scenes/settings | 3 | 96.2 | 100.0 | 88.5 | 100.0 | 0.000 | 0 | 6 | 0.0% | — | 0.0% | 0.0 |
