# PostHog product signals for code-level targeting

Research for [#68](https://github.com/Silthus/uml-pr-review/issues/68), part of the Coherence loop map [#67](https://github.com/Silthus/uml-pr-review/issues/67).

Question: which PostHog product signals can a local loop pull to target code in `products/workflows`, and how exactly?

Every call below was made through the PostHog MCP `exec` tool on 2026-09-26, schema-first (`info` before `call`). The repository facts come from `~/dev/posthog` at `origin/master` `f637db96f1`, read from Git objects only. This file holds aggregate counts, ids, and links. It holds no customer data.

## Summary

| Signal | Tool | Maps to code by | Works today from this MCP |
| --- | --- | --- | --- |
| CI test outcomes per test file | `execute-sql` on `posthog.trace_spans`, project 347861 | `test.file` attribute: an exact repo path | **Yes.** Verified with real numbers |
| Error tracking issues | `query-error-tracking-issues-list` → `query-error-tracking-issue-events` | Stack frame `filename` and `function` | Call shape verified. Production data is in project 2, which is not reachable |
| APM spans per endpoint | `execute-sql` on `posthog.trace_spans` or `query-apm-spans` | Span name or `http.route` → route table → ViewSet file | Aggregate shape verified on project 347861. Production data is in project 2 |
| Logs per service | `logs-count`, `query-logs`, `execute-sql` on `logs` | `service_name` plus logger attribute → package | Tool shape verified. Production data is in project 2 |
| Traffic and usage | `query-trends` or `execute-sql` on `$pageview` | `$pathname` pattern → scene → frontend file | Recipe only. Production data is in project 2 |

**The blocker is access, not tooling.** PostHog's own production data lives in US project 2, the dogfood project. The MCP here is logged in as Michael's staff user, in the one organization "PostHog Inc." (`4dc8564d-…`). Its default project is 19618 "🧪 Test". Both `project-get {"id": 2}` and `switch-project {"projectId": 2}` return 404. Project 2 is not in the organization's project list either. The PostHog repo documents that access to the dogfood project is gated by membership (`.agents/skills/analyzing-insights-across-teams/SKILL.md:18,75`), and that the per-cluster OTel collector ships all container stdout "into the region's internal PostHog project" (`docs/internal/sandboxes-setup-guide.md:308`).

**The one production-adjacent signal that works today is CI.** Project 347861 "DevEx" receives CI traces from GitHub Actions as spans. Each backend test is a span with `test.file`, `test.outcome`, `test.attempts`, and `test.owner_team`. That signal maps to files with no route table at all.

## Which project, and where the MCP points

| Project | Id | What it holds | Useful for signals |
| --- | --- | --- | --- |
| 🧪 Test (MCP default) | 19618 | 545 events in 7 days, 0 `$exception` | No |
| DevEx | 347861 | Spans from `ci-backend`, `ci-frontend`, `ci-workflows`; 11,688 spans in one hour | **CI signal** |
| Infrastructure | 238302 | 27,954 events in 7 days, no `$exception`, no logs | No |
| Platform Ops Telemetry | 380297 | No logs, no spans in the last hour | No |
| Internal Grafana | 263877 | No logs, no spans in the last hour | No |
| PostHog App + Website (dogfood) | 2 | Production errors, logs, traces, and product analytics | **Yes, once access is granted** |

Recommendation: request membership in US project 2 for the MCP user, then pin the provider to `projectId: 2` with a `switch-project` call at the start of each loop run. Until then, the provider runs the CI recipe on 347861 and reports the other four signals as `unavailable` with a reason. It does not fail.

## 1. Error tracking

**Fetch.** Two calls per window. First list the issues whose frames mention the scope, then sample frames per issue:

```
call query-error-tracking-issues-list {"dateRange": {"date_from": "-30d"}, "status": "all", "filePath": "products/workflows", "orderBy": "occurrences", "limit": 100}
call query-error-tracking-issues-list {"dateRange": {"date_from": "-90d"}, "status": "all", "filePath": "products/workflows", "orderBy": "occurrences", "limit": 100}
call query-error-tracking-issue-events {"issueId": "<uuid>", "dateRange": {"date_from": "-30d"}, "include": ["stacktrace"], "onlyAppFrames": true, "limit": 5}
```

`filePath` is a text search over stack-frame source paths, so one filter catches both the Django backend (`products/workflows/backend/…`) and the frontend (`products/workflows/frontend/…`). Each issue row carries `occurrences`, `users`, and `sessions` for the window. Paginate with `offset` while `hasMore` is true.

**Sample output (trimmed).** On project 19618 the list call returns `results: []`, `hasMore: false`, and `_posthogUrl: https://us.posthog.com/project/19618/error_tracking`. The call shape is verified. The data is not there.

**Map to code.** Take the in-app frames of each sampled event. Strip the deploy prefix up to the first `products/`, `posthog/`, `ee/`, `frontend/`, or `nodejs/` segment. That gives a repo path plus the frame's function. The top in-app frame inside the scope is the issue's owner file. Count `occurrences` against that file, and against its module by longest folder prefix. Whether backend frames carry absolute container paths (for example `/code/products/…`) and frontend frames carry source-mapped paths has to be confirmed on the first run against project 2.

**Never request `code_variables`.** The tool warns that it can hold SDK-masked sensitive values. `stacktrace` alone is enough for the mapping.

**Cost and latency.** Each call returned in a few seconds. The list call costs one query per window. The events call costs one query per issue, so cap it at the top 20 issues by occurrences.

## 2. APM and traces

**What the spans are called.** Django's OTel response hook renames each request span to `"{METHOD} {resolver_match.route}"` (`posthog/otel_instrumentation.py:39-49`). A workflows request therefore looks like `POST api/projects/(?P<parent_lookup_team_id>[^/.]+)/hog_flows/(?P<pk>[^/.]+)/publish/?$`. `/api/environments/…` paths are rewritten to `/api/projects/…` before resolution (`posthog/middleware.py:559-613`), so one route name covers both. Django's `service.name` comes from `OTEL_SERVICE_NAME` (`posthog/otel_instrumentation.py:129-130`). The production values live in the charts repo, not here. Node CDP services are named `node-${PLUGIN_SERVER_MODE}` (`nodejs/src/common/tracing/otel.ts:37`). The workflows ones are `node-cdp-cyclotron-worker-hogflow`, `node-cdp-cyclotron-worker-email`, `node-cdp-cyclotron-worker-batch-resolve`, `node-cdp-hogflow-subscription-matcher`, `node-cdp-hogflow-scheduler`, `node-cdp-rerun-worker`, and `node-cdp-api`.

**Fetch.** First discover the services with `apm-services-list`, then aggregate with SQL. The typed `query-apm-spans` returns rows, not aggregates:

```sql
SELECT
    service_name,
    name,
    count() AS spans,
    round(countIf(status_code = 2) / count(), 4) AS error_rate,
    round(quantile(0.95)(duration_nano) / 1e6, 1) AS p95_ms
FROM posthog.trace_spans
WHERE timestamp >= now() - INTERVAL 1 DAY
  AND is_root_span
  AND (name LIKE '%hog_flow%' OR name LIKE '%messaging_%' OR name LIKE '%workflow_%' OR service_name LIKE 'node-cdp-%')
GROUP BY service_name, name
ORDER BY spans DESC
LIMIT 200
```

**Sample output (trimmed).** The shape is verified on project 347861, where the spans are CI jobs:

```
service_name|name|spans|error_rate|p95_ms
ci-backend|Backend CI / core (1)|205|0.0|522883.4
ci-backend|Backend CI / core (5)|176|0.0227|503591.5
```

**Map to code.** Strip the method, then match the path after `(?P<parent_lookup_team_id>[^/.]+)/` against this prefix table. Nested `@action` paths inherit their ViewSet file. The route map comes from `products/workflows/backend/routes.py:7-22`, `products/messaging/backend/routes.py:10-22`, and `posthog/urls.py`.

| Route prefix | ViewSet | File |
| --- | --- | --- |
| `hog_flows/` | `HogFlowViewSet` | `products/workflows/backend/api/hog_flow.py:3853` |
| `hog_flow_templates/` | `HogFlowTemplateViewSet` | `products/workflows/backend/api/hog_flow_template.py:222` |
| `workflow_tasks/` | `WorkflowTaskViewSet` | `products/workflows/backend/api/workflow_tasks.py:176` |
| `workflow_scout_runs/` | `WorkflowScoutRunViewSet` | `products/workflows/backend/api/workflow_scout_runs.py:85` |
| `messaging_templates/` | `MessageTemplatesViewSet` | `products/messaging/backend/api/message_templates.py:283` |
| `messaging_categories/` | `MessageCategoryViewSet` | `products/messaging/backend/api/message_categories.py:61` |
| `messaging_preferences/` | `MessagePreferencesViewSet` | `products/messaging/backend/api/message_preferences.py:180` |
| `messaging_suppressions/` | `MessageSuppressionViewSet` | `products/messaging/backend/api/message_suppression.py:99` |
| `api/projects/<team_id>/internal/hog_flows/*`, `api/internal/hog_flows/*` | `InternalHogFlowViewSet` | `products/workflows/backend/api/hog_flow.py:5841` |
| `webhooks/workflows/ses-events` | `ses_tenant_events_webhook` | `products/workflows/backend/api/ses_events_webhook.py:49` |
| `hog_flows/{pk}/logs/`, `…/metrics/` | mixins | `posthog/api/log_entries.py:143`, `posthog/api/app_metrics2.py:464` |

`hog_flow.py` is about 6,100 lines and serves 26 custom actions, so route-level attribution lands most traffic on one file. Endpoint-level evidence (the action name) is what makes that file splittable.

Node spans map by service. `node-cdp-cyclotron-worker-hogflow` maps to `nodejs/src/cdp/consumers/cdp-cyclotron-worker-hogflow.consumer.ts` and `nodejs/src/cdp/services/hogflows/`. `node-cdp-hogflow-scheduler` maps to `nodejs/src/cdp/services/hogflow-schedule/`. Custom spans from `instrumentFn` carry their key as the name, for example `hogFlow.action.hogFunction.executeWithAsyncFunctions` from `services/hogflows/actions/hog_function.ts:428`. These are outside `products/workflows` but inside the workflows domain.

Celery tasks keep their default names, which are module path plus function, for example `products.workflows.backend.tasks.hog_flows.refresh_affected_hog_flows`. So a Celery span name maps straight to a file. There are seven workflows tasks and one messaging task. Temporal is not used by workflows.

**Cost and latency.** HogQL on `posthog.trace_spans` is capped at 50 GB read per query. Keep the window to one day per query, and loop over days for 30 days. On 347861 a 30-day aggregate filtered by an attribute returned in a few seconds.

## 3. Logs

**Fetch.** Discover first, then count. `query-logs` itself refuses unfiltered queries and returns rows, not aggregates:

```
call logs-attribute-values-list {"key": "service.name", "attribute_type": "resource"}
call logs-count {"query": {"serviceNames": ["<service>"], "severityLevels": ["warn", "error", "fatal"], "dateRange": {"date_from": "-1d"}}}
```

For a per-module breakdown, use SQL on `logs`. Keep it on its own: `logs` and `events` sit on different clusters and cannot share a query.

```sql
SELECT
    service_name,
    attributes['logger'] AS logger,
    severity_text,
    count() AS lines
FROM logs
WHERE timestamp >= now() - INTERVAL 1 DAY
  AND severity_text IN ('warn', 'error', 'fatal')
  AND (attributes['logger'] LIKE 'products.workflows.%' OR attributes['logger'] LIKE 'products.messaging.%' OR service_name LIKE 'node-cdp-%')
GROUP BY service_name, logger, severity_text
ORDER BY lines DESC
LIMIT 200
```

The attribute key for the logger (`logger` above) is a guess. Confirm it with `logs-attributes-list` on the first run against project 2.

**Map to code.** Python modules log through `structlog.get_logger(__name__)` or `logging.getLogger(__name__)`, so the logger name is the module path. For example, `products.workflows.backend.api.hog_flow` maps to `products/workflows/backend/api/hog_flow.py`. That attribution is exact. Node is coarse: one global pino logger per process, named after `PLUGIN_SERVER_MODE` (`nodejs/src/common/utils/logger.ts:114`). So Node logs attribute only to a service, plus whatever prefix sits in the message text (`[HogFlowExecutor]`, `[HogFlowManager]`).

**Sample output.** None. No reachable project has logs: 19618 and 238302 returned 0 lines, and 380297 and 263877 returned 0 for the last hour.

**Cost and latency.** Same 50 GB cap. `logs-count` and `logs-count-ranges` are cheap. Use `logs-count-ranges` to find a spike before pulling any rows.

## 4. Traffic and usage

**Fetch.** Pageviews per scene, with `read-data-schema` for `$pageview` and `$pathname` first:

```sql
SELECT
    multiIf(
        match(properties.$pathname, '^(/project/[0-9]+)?/workflows/new/'), 'workflows/new',
        match(properties.$pathname, '^(/project/[0-9]+)?/workflows/library/templates/'), 'workflows/library/template',
        match(properties.$pathname, '^(/project/[0-9]+)?/workflows/[^/]+/[^/]+'), 'workflows/:id/:tab',
        match(properties.$pathname, '^(/project/[0-9]+)?/workflows(/[^/]+)?/?$'), 'workflows/:tab',
        'other'
    ) AS scene,
    count() AS pageviews,
    uniq(person_id) AS users
FROM events
WHERE event = '$pageview'
  AND timestamp >= now() - INTERVAL 30 DAY
  AND properties.$pathname LIKE '%/workflows%'
GROUP BY scene
ORDER BY pageviews DESC
```

The syntax is verified on 19618, which returned `other|2|2`. That project has no workflows traffic. For API usage, use the span counts from section 2. They count real requests per endpoint, which is a better safety weight than pageviews.

**Map to code.** Scenes come from `products/workflows/manifest.tsx:34-47`.

| Scene | File |
| --- | --- |
| `workflows/:tab` | `products/workflows/frontend/WorkflowsScene.tsx`. Tabs: `workflows` → `Workflows/WorkflowsTable`, `library` → `TemplateLibrary/`, `channels` → `Channels/`, `opt-outs` → `OptOuts/`, `suppression` → `Suppression/`, `reputation` → `Workflows/Reputation/` |
| `workflows/:id/:tab` | `products/workflows/frontend/Workflows/WorkflowScene.tsx`. Tabs: `workflow` (the `hogflows/` graph editor, 129 files), `invocations`, `metrics`, `assets`, `history` |
| `workflows/library/template` | `products/workflows/frontend/TemplateLibrary/MessageTemplate.tsx` |

To attribute per tab, add `extract(properties.$pathname, '/workflows/(?:[^/]+/)?([^/?]+)$')` to the query.

**Cost and latency.** One query on `events` for 30 days, filtered by event and path. It is cheap on a normal project. On project 2 it scans a lot of pageviews, so keep the `LIKE` prefilter and consider a 7-day window.

## 5. CI test outcomes (works today)

This signal wasn't asked for, but it is the one that works from this MCP right now, and it maps to files exactly.

**Fetch.** On project 347861:

```sql
SELECT
    attributes['test.file'] AS test_file,
    count() AS runs,
    countIf(attributes['test.outcome'] = 'failed') AS failed,
    countIf(toInt(attributes['test.attempts']) > 1) AS retried,
    round(quantile(0.95)(duration_nano) / 1e6, 0) AS p95_ms
FROM posthog.trace_spans
WHERE timestamp >= now() - INTERVAL 30 DAY
  AND service_name IN ('ci-backend', 'ci-frontend')
  AND attributes['test.file'] LIKE 'products/workflows/%'
GROUP BY test_file
ORDER BY failed DESC, runs DESC
LIMIT 200
```

**Sample output (real, trimmed, 30 days up to 2026-09-26).**

```
test_file|runs|failed|retried|p95_ms
products/workflows/backend/api/test/test_hog_flow.py|3781|10|10|920.0
products/workflows/backend/api/test/test_workflow_proposals.py|357|6|1|748.0
products/workflows/backend/test/test_ses_provider.py|24464|0|0|2014.0
products/workflows/backend/api/test/test_email_reputation.py|6277|0|0|27025.0
```

Across 30 days: 37 backend test files owned by `team-workflows`, 43,806 passed runs, and 16 failed. On the frontend, 3 files had 21 failed runs and 1 file had 9 `rerun_passed` runs. Span attributes are `test.file`, `test.name`, `test.classname`, `test.outcome`, `test.attempts`, `test.owner_team`, and `test.runner`.

**Map to code.** `test.file` is a repo path. The code under test is the test's module. Flaky tests, meaning retried or `rerun_passed`, are a pain signal for the module. Slow tests (`p95_ms`) are a cost signal for the loop's verify step.

**Cost and latency.** One query for 30 days, filtered by service and attribute. It returned in a few seconds.

## 6. Stamphog

Stamphog is PostHog's approve-first pull request reviewer (`products/stamphog/README.md`). It runs deterministic gates, then a scoped LLM review in a sandbox. When the policy allows it, it posts a real GitHub approval as `stamphog[bot]`. The verdicts are `APPROVED`, `REFUSED`, `ESCALATE`, `WAIT`, and `ERROR`. It never requests changes.

How auto-approval is configured:
- **Per repository in a PostHog project.** Each repo config has `enabled`, a review mode ("All PRs" or "Label-triggered" with a trigger label), and `digest_enabled`. The gating fields need `manager` access on the `stamphog` resource.
- **Policy in the repo.** `.stamphog/policy.yml`, `review-guidance.md`, and `steering.md` are read from the default branch, never from the PR head. Each section of `policy.yml` replaces the hosted default's section wholesale (`products/stamphog/backend/logic/policy_defaults/policy.yml`). The sections are `deny` (auth, crypto_secrets, migrations, infra_cicd, billing, public_api, deps_toolchain, stamphog_policy), `allow`, `size_gate` (default 800 lines and 30 files), `tiers`, `overrides`, `familiarity`, and `ownership`.
- **Folder overrides.** `AGENT_APPROVALS.md` files add per-folder overrides. They are read from the PR head, so their frontmatter is a bounded allow-list.
- **PostHog itself** carries `.stamphog/policy.yml` and `review-guidance.md` on `master`. There is no `AGENT_APPROVALS.md` under `products/workflows`.

The MCP tools are `stamphog-repo-configs-list`, `stamphog-review-runs-list` (filter by `repository`, `pr_number`, `status`, and `trigger`, including `self_driving` for bot-authored PRs), and `stamphog-review-runs-get`. On 347861 `stamphog-repo-configs-list` returns `count: 0`, so PostHog/posthog is configured in another project, most likely project 2. What this means for the loop later: a loop PR that stays under the size gate and off the deny list is eligible for `self_driving` review. Boundary-class PRs hit `deny` or `ESCALATE` by design.

## 7. What the benchmark plumbing and routing files contribute

- **Jev** (`benchmark/lib/jev.ts`, `jev-gateway.ts`) is an LLM judge. It grades files, tests, and diffs against fixed questions: readability, single responsibility, naming, error handling, and more. It does no endpoint → file mapping. Its value to signals is a per-file opinion score, which #67 already keeps out of the index.
- **`benchmark/lib/tach.ts`** does the useful part. `parseTach(...).moduleOf(file)` lifts any repo path to its tach module by longest prefix. It is the natural roll-up for every file-exact signal above. The repository index (`src/architecture/index`) can do the same from folders.
- **The routing files carry the mapping.** `products/*/backend/routes.py` (discovered by `posthog/api/rest_router.py:592-595`), `posthog/urls.py`, the default Celery task names, and `manifest.tsx` scenes give a static table. Build it from Git objects at the loop's commit, the same way the index is built. That way the span → file map never drifts from the code being changed.

## Recommended provider interface

One provider run produces one document. The signals module validates it with zod and ranks modules. Each row is one measurement for one code location. Absent signals are listed with a reason rather than dropped, so a missing access grant shows up in the loop's report.

```ts
type SignalKind =
  | "errors.occurrences"
  | "errors.users"
  | "apm.requests"
  | "apm.error_rate"
  | "apm.p95_ms"
  | "logs.warn_error_lines"
  | "usage.pageviews"
  | "usage.users"
  | "ci.test_failures"
  | "ci.test_retries"
  | "ci.test_p95_ms";

type Evidence = { kind: "error_issue" | "route" | "service" | "logger" | "scene" | "test_file"; id: string; url?: string; count?: number };

type SignalRow = {
  path: string;
  signal: SignalKind;
  value: number;
  window: "1d" | "7d" | "30d" | "90d";
  attribution: "exact" | "route" | "service";
  evidence: Evidence[];
};

type SignalReport = {
  provider: "posthog";
  source: { host: "us.posthog.com"; projectId: number };
  scope: string;
  collectedAt: string;
  rows: SignalRow[];
  unavailable: { signal: SignalKind; reason: string }[];
};
```

- `path` is a repo path, either a file or a folder. The consumer lifts it to its module with the index's longest-prefix match. So the provider never needs to know the module tree.
- `attribution` says how sure the mapping is: `exact` for a frame path, logger name, or `test.file`; `route` for a span name resolved through the route table; `service` for a Node service or other coarse match. The ranking can down-weight `service`.
- `evidence` holds ids and links only: issue UUIDs with their app URL, route strings, service names, and test files. No payloads, no people.
- The axis is the consumer's call, not the provider's. `errors.*`, `apm.error_rate`, `logs.*`, and `ci.test_failures` and `ci.test_retries` feed pain. `usage.*` and `apm.requests` feed the safety weight. `apm.p95_ms` and `ci.test_p95_ms` are cost.

Example:

```json
{
  "provider": "posthog",
  "source": { "host": "us.posthog.com", "projectId": 347861 },
  "scope": "products/workflows",
  "collectedAt": "2026-09-26T19:40:00Z",
  "rows": [
    {
      "path": "products/workflows/backend/api/test/test_hog_flow.py",
      "signal": "ci.test_failures",
      "value": 10,
      "window": "30d",
      "attribution": "exact",
      "evidence": [{ "kind": "test_file", "id": "products/workflows/backend/api/test/test_hog_flow.py", "count": 3781 }]
    }
  ],
  "unavailable": [
    { "signal": "errors.occurrences", "reason": "project 2 not reachable: switch-project returned 404" }
  ]
}
```

## Loop-time recipe

The loop skill runs this through `mcp__plugin_posthog_posthog__exec`. Pass `llm_model` and a short abstract `context` on every call, and reuse the returned `conversation_id`.

1. `call switch-project {"projectId": 2}`. On a 404, mark `errors.*`, `apm.*`, `logs.*`, and `usage.*` unavailable and skip to step 6.
2. **Errors.** Run `query-error-tracking-issues-list` for `-30d` and `-90d` with `filePath: "<scope>"` and `status: "all"`. Then run `query-error-tracking-issue-events` with `include: ["stacktrace"]` for the top 20 issues. Emit `errors.occurrences` and `errors.users` on the top in-scope frame's file, with `attribution: "exact"` and evidence `{kind: "error_issue", id, url}`.
3. **APM.** Run `apm-services-list`, then the section 2 SQL once per day for the window. Resolve each span name through the route table built from the loop commit's `routes.py` and `urls.py`. Emit `apm.requests`, `apm.error_rate`, and `apm.p95_ms` with `attribution: "route"`, and for Node services with `attribution: "service"`.
4. **Logs.** Run `logs-attribute-values-list` for `service.name` and `logs-attributes-list` to confirm the logger key, then the section 3 SQL per day. Emit `logs.warn_error_lines` on the logger's module file with `exact`, or on the service with `service`.
5. **Usage.** Run `read-data-schema` for `$pageview` and `$pathname`, then the section 4 SQL. Emit `usage.pageviews` and `usage.users` on the scene file.
6. **CI.** `call switch-project {"projectId": 347861}`, then run the section 5 SQL. Emit `ci.test_failures`, `ci.test_retries`, and `ci.test_p95_ms` on the test file with `exact`.
7. Switch back to the user's default project (`19618` today), and write the `SignalReport` JSON next to the loop's run artifacts.

Each step is one to three MCP calls of a few seconds. Error events add one call per sampled issue. A full run is about 40 calls and a few minutes, dominated by the per-day APM and logs loops on project 2.

## Open items

- **Access.** Request membership in US project 2 for the MCP user. That is the only step between these recipes and real production numbers. When it lands, re-verify three things on the first run: backend frame path prefixes, the logs logger attribute key, and the production Django `service.name`.
- **`hog_flow.py` concentration.** One 6,100-line file serves most workflows endpoints. Endpoint-level evidence (action names in the route string) is what will let the loop target inside it.
