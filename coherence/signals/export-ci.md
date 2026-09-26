# Export the CI signals report

The loop skill runs this recipe before `bun coherence/targets.ts`. It writes one `SignalReport` JSON file for a scope. The CLI reads that file through `--posthog-signals` and never calls PostHog itself.

The schema is `coherence/signals/report.ts`. It follows the provider shape from [#68](https://github.com/Silthus/uml-pr-review/issues/68) (`docs/research/posthog-signals-for-coherence.md` on `research/posthog-signals`).

## Inputs

- `SCOPE`: the repository path to rank, for example `products/workflows`.
- `UNTIL`: the end of the window, a UTC day such as `2026-09-26`. `FROM` is 30 days earlier. Fixed dates keep the export reproducible.

## Steps

Run every call through `mcp__plugin_posthog_posthog__exec`. Pass `llm_model` and a short abstract `context` on every call, and reuse the `conversation_id` that the first call returns.

1. **Check production access.** Run `call switch-project {"projectId": 2}`.
   - If it returns 404, production data is not reachable. Put these eight signals in `unavailable`, each with the reason `project 2 not reachable: switch-project returned 404`: `errors.occurrences`, `errors.users`, `apm.requests`, `apm.error_rate`, `apm.p95_ms`, `logs.warn_error_lines`, `usage.pageviews`, `usage.users`.
   - If it succeeds, follow the production recipes in the research doc (errors, APM, logs, usage), then continue here.
2. **Switch to CI.** Run `call switch-project {"projectId": 347861}` (DevEx).
3. **Confirm the schema.** Run `info execute-sql`. Then confirm the span columns:

   ```sql
   SELECT column_name, data_type FROM system.information_schema.columns WHERE table_name = 'posthog.trace_spans' ORDER BY ordinal_position
   ```

   The query below needs `timestamp`, `service_name`, `duration_nano`, and `attributes`. Stop and report if any is missing.
4. **Export the per-file outcomes.** Put `governed catalog consulted: no match` in the SQL `context`.

   ```sql
   SELECT
       attributes['test.file'] AS test_file,
       count() AS runs,
       countIf(attributes['test.outcome'] = 'failed') AS failed,
       countIf(toIntOrZero(attributes['test.attempts']) > 1 OR attributes['test.outcome'] = 'rerun_passed') AS retried,
       round(quantile(0.95)(duration_nano) / 1e6, 0) AS p95_ms
   FROM posthog.trace_spans
   WHERE timestamp >= toDateTime('<FROM> 00:00:00')
     AND timestamp < toDateTime('<UNTIL> 00:00:00')
     AND service_name IN ('ci-backend', 'ci-frontend')
     AND attributes['test.file'] LIKE '<SCOPE>/%'
   GROUP BY test_file
   ORDER BY failed DESC, retried DESC, runs DESC, test_file
   LIMIT 500
   ```

   The frontend runner records only `failed` and `rerun_passed` outcomes, so `retried` counts both retry forms.
5. **Switch back** to the default project: `call switch-project {"projectId": 19618}`.
6. **Write the report.** Emit rows for each result row:
   - `ci.test_failures` with the value `failed`, only when it is above 0;
   - `ci.test_retries` with the value `retried`, only when it is above 0;
   - `ci.test_p95_ms` with the value `p95_ms`, always.

   Each row has `path` set to the test file, `window` set to `"30d"`, and `attribution` set to `"exact"`. Its evidence is `[{"kind": "test_file", "id": <test file>, "count": <runs>}]`. The document is:

   ```json
   {
     "provider": "posthog",
     "source": { "host": "us.posthog.com", "projectId": 347861 },
     "scope": "<SCOPE>",
     "collectedAt": "<ISO timestamp of the export>",
     "rows": [],
     "unavailable": []
   }
   ```

7. **Validate.** Run `bun coherence/targets.ts --repo <repo> --scope <SCOPE> --posthog-signals <file>`. The command rejects a file that does not match the schema and names the offending field.

## What the report holds

It holds aggregate counts and repository paths only. It holds no test names, no people, and no payloads.

The ranking lifts each test file to the module that owns its path. So `products/workflows/backend/api/test/test_hog_flow.py` counts against `products/workflows/backend/api`. Tests under a shared `backend/test/` folder count against the backend module itself.

## Proof

`coherence/signals/reports/workflows-ci-2026-09-26.json` is the report from this recipe for `products/workflows`, with the window 2026-08-27 to 2026-09-26. It has 40 test files, 43,317 runs, 37 failed runs, and 23 retried runs. Project 2 returned 404, so the production signals are listed as unavailable.
