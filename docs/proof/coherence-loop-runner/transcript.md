# One real dry-run iteration on PostHog `products/workflows`

## The session

- **Launcher:** `bun coherence/loop/session.ts --repo ~/dev/posthog --scope products/workflows --posthog-signals coherence/signals/reports/workflows-ci-2026-09-26.json`.
- **Model and setup:** `claude -p --model claude-opus-5-5 --setting-sources local`, with the gateway variables dropped, `--strict-mcp-config` and no MCP servers, and the skill passed through `--append-system-prompt`. The init event confirms `model=claude-opus-5-5 mcp=[]`.
- **Guards (dry run):**
  - GitHub push URLs are rewritten to a blocked target;
  - the agent's own `git push`, `gh`, and `curl … github.com` are disallowed;
  - auto-memory is off.
- **Signals:** the PostHog MCP needs user settings, so the committed CI SignalReport served instead. Production signals are unavailable (project 2 returns 404).
- **Base:** `upstream/master` at `c25b27f874a1`, the local remote-tracking ref. No fetch was run, so `~/dev/posthog` stayed read-only.
- **Cost:** 39 turns, 346 s, $1.29.

## What the agent did, in order

1. **Sense.** `sense.ts` ranked 42 modules. 2,032 open pull requests were active within 14 days; 78 files in the ranked modules were busy; 7 modules were skipped because every one of their files is busy.
2. **Choose → ask.** Rank 1, `backend/api`, needs a facade (boundary). The agent read the bypassing imports in PostHog and raised a sharper question than the draft: [#82](https://github.com/Silthus/uml-pr-review/issues/82). It asks whether the workflows facade may export DRF viewsets and a serializer, because three of the four bypasses are `posthog/urls.py` router registrations and a management command. Recorded as `question`.
3. **Choose → ask.** Rank 2, `backend/services`, needs a facade (boundary): [#83](https://github.com/Silthus/uml-pr-review/issues/83). It asks whether the account-audience provider hook that `customer_analytics` implements becomes part of the public workflows boundary, since that code belongs to another team. Recorded as `question`. That reached the question cap of 2.
4. **Choose → act.** Rank 3, `frontend/Workflows/hogflows/steps`: characterisation tests, mechanical. Tests import 10 of 23 files.
5. **Workspace.** A scratch worktree on `coherence/workflows/frontend-workflows-hogflows-steps-characterisation-tests`.
6. **Act.** The agent wrote `HogFlowBranchCard.test.tsx` (99 lines), and no production code changed. To run it, it linked the main checkout's `frontend/node_modules` for the run and removed the link before committing. An import cycle makes jest run the mock factory twice, so it wrapped the mock lazily. It dropped two colour assertions, because jsdom discards `var(...)` values. PostHog's pre-commit hook needs the flox Python, so it committed with `--no-verify` after running `oxfmt` and `oxlint` itself.
7. **Verify** passed. 99 of 300 lines, 0 lint findings before and after, no busy file touched. jest was reported as "not run": the runner searched only the ancestors of the test for jest, and PostHog keeps it in `frontend/` (see "Found by the run").
8. **Propose** (dry run) wrote [`pr.md`](pr.md). Nothing was pushed.
9. **Record** appended the entry; `choose` then printed `done`, because the budget of 1 was spent. See [`ledger.jsonl`](ledger.jsonl).

## Index delta for `products/workflows/frontend/Workflows/hogflows/steps`

| Dimension | Before | After |
| --- | ---: | ---: |
| composite | 74.0 | 74.1 |
| architecture | 91.6 | 91.6 |
| complexity | 81.2 | 81.2 |
| smells | 90.6 | 90.6 |
| **tests** (targeted) | 17.7 | 18.3 |

## Found by the run, fixed before merge

- **Frontend tests could never run in a workspace.** A fresh worktree has no `node_modules`, and PostHog's jest config lives in `frontend/`, which is not an ancestor of `products/*`. `test-runs.ts` now finds the jest package: the nearest ancestor with a jest config, or a top-level package whose config covers the test's top-level directory. It borrows that package's `node_modules` from the main checkout for the run, then removes the link. Re-verifying the same iteration with the fixed runner: jest **passed 5 of 5**, verdict pass, 4 s ([`reverify-after-review.json`](reverify-after-review.json)).
- **Commit hooks that need the repository's dev environment.** The skill now tells the agent to commit with `--no-verify`, run the hook's formatter and linter itself, and name the skipped hook.

## Files

- [`pr.md`](pr.md): the proposed pull request body, as the run wrote it.
- [`posthog.diff`](posthog.diff): the change on the dry-run branch, and [`branch.txt`](branch.txt): its commit.
- [`iteration.json`](iteration.json): the runner state at propose time.
- [`ledger.jsonl`](ledger.jsonl): the three ledger entries (two questions, one proposal).
- [`cleanup.txt`](cleanup.txt): the scratch worktree and branch removed from `~/dev/posthog`.
- `red-targets.txt`, `red-runner.txt`, `green.txt`, and `gate.txt`: the test proof.
