# Benchmark harness

Replays Michael's PostHog pull requests to measure whether the uml-pr-review tools and the `planning-architecture` skill change how an agent builds. The design is in issue #61; the method and results land in `docs/benchmark/report.md`.

## Pipeline

Run from the repository root. PostHog is read from `~/dev/posthog` (override with `BENCH_POSTHOG`) and is never modified: every run works in a scratch worktree under `/tmp` that is removed afterwards.

```sh
bun benchmark/original.ts benchmark/tasks/<pr>.json        # arm A: the PR's own diff and session trace
bun benchmark/run.ts benchmark/tasks/<pr>.json B --repeat 2 # arm B: Claude Opus 5.5, no tools
bun benchmark/run.ts benchmark/tasks/<pr>.json C --repeat 2 # arm C: plus the MCP server and the skill
bun benchmark/score.ts <pr>                                 # architecture, static quality, tests, alignment, consistency, process
bun benchmark/judge.ts <pr>                                 # blind Astra judge (codex exec -m gpt-6-astra)
AI_GATEWAY_API_KEY=… bun benchmark/jev-grade.ts <pr>        # Jev grades (typesafe-ai/jev)
bun benchmark/report.ts                                     # docs/benchmark/report.md
```

Arm C needs the uml-pr-review server on `http://127.0.0.1:4477/mcp` (`bun run start`). Each run writes `benchmark/runs/<pr>/<arm>-<n>/` with `transcript.jsonl`, `diff.patch`, and `meta.json`; a run that exceeds 40 minutes is killed and recorded as `timed-out`.

## Environment

- `AI_GATEWAY_API_KEY`: the Vercel AI Gateway key for Jev. Pass it only at run time; never write it to a file in this repository. Without it, `jev-grade.ts` records `jev: unavailable` and the report leaves the Jev angle out.
- `BENCH_POSTHOG`: the PostHog checkout to replay against. Defaults to `~/dev/posthog`.
- `lizard` and `ruff` run through `uvx`, found on `PATH` or in PostHog's flox environment. When neither is available, those grades are recorded as unavailable.

## Fixtures

- `runs/_smoke/` is one real arm-B run of a synthetic one-function task, proving the runner end to end.
- `runs/_example-103523/` holds PR #103523's first push and final diff: the first push bypasses the workflows facade once, the final PR does not.

Directories starting with `_` are left out of the report.
