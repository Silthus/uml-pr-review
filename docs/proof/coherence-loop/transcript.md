# First dry-run Coherence loop iteration on a fresh PostHog base

One real, headless loop iteration on PostHog `products/workflows`, run with the exact command from the README. The dry run proposed characterisation tests for `frontend/Workflows` (`EmailLinksTable`): mechanical, 112 lines, jest 7 of 7. Nothing was pushed. Tests for the touched module rose from 17.6 to 17.8, and no dimension dropped.

## The session

- **Command:** `bun coherence/loop/session.ts --repo ~/dev/posthog --scope products/workflows --fetch`, from the root of this repository. The launcher output is [`session-output.json`](session-output.json).
- **Model and setup:** `claude -p --model claude-opus-5-5 --setting-sources local` with the skill in the system prompt, no gateway variables, and `--strict-mcp-config` with no MCP servers. The init event confirms `model=claude-opus-5-5 mcp_servers=[]`.
- **Guards (dry run):** every GitHub push URL is rewritten to a blocked target (the transcript shows the three `pushinsteadof` rules), and the agent's own `git push`, `gh`, and `curl … github.com` are disallowed.
- **Cost:** 21 turns, 325 s, $0.60.
- **Base:** `upstream/master` at `57ca357730843205c2d659098ac8e4c5e07a6698` (committed 2026-09-26 18:29 UTC), fetched during the run. PR #84's run used `c25b27f` from Sep 23.
- **Signals:** no PostHog MCP in a headless session, so the committed CI report `coherence/signals/reports/workflows-ci-2026-09-26.json` served. Error tracking, APM, logs, and usage are unavailable: project 2 answers 404.

## What the agent did, in order

The full log with every command and its output is [`transcript-tools.md`](transcript-tools.md); the raw stream is [`transcript.jsonl`](transcript.jsonl).

1. **Sense with `--fetch` failed.** `git fetch upstream master` goes over SSH, and the 1Password agent could not sign for a headless process: "communication with agent failed". The agent found that `~/.gitconfig` rewrites `https://github.com/` to SSH, and fetched the public repository once with `GIT_CONFIG_GLOBAL=/dev/null git fetch https://github.com/PostHog/posthog.git +master:refs/remotes/upstream/master`. No config file changed. Recorded as [#86](https://github.com/Silthus/uml-pr-review/issues/86).
2. **Sense failed again, on missing grammars.** This worktree had no `node_modules`. The agent ran `bun install`, then sense succeeded: 42 ranked modules, 7 skipped because every file is busy, 2,035 PostHog pull requests active within 14 days. The ranking is [`target-ranking.txt`](target-ranking.txt), and the sense file is [`workflows.sense.json`](workflows.sense.json).
3. **Choose → act on rank 4.** Choose passed over:
   - rank 1, `backend/api`, and rank 2, `backend/services`: both wait on open questions [#82](https://github.com/Silthus/uml-pr-review/issues/82) and [#83](https://github.com/Silthus/uml-pr-review/issues/83);
   - rank 3, `frontend/Workflows/hogflows/steps`: the ledger already holds its characterisation-tests proposal from PR #84's run.

   It chose `products/workflows/frontend/Workflows`: characterisation tests, mechanical, because tests import 14 of its 38 files. Choose does not print why it passes over a target; the agent said so in its summary.
4. **Workspace** `$TMPDIR/coherence-workflows-frontend-workflows-characterisation-tests` on branch `coherence/workflows/frontend-workflows-characterisation-tests`, with 20 busy files listed.
5. **Act.** The agent read `EmailLinksTable.tsx`, the neighbouring `WorkflowSceneHeader.test.tsx`, and the row type. It picked a component that is not busy, wrote `EmailLinksTable.test.tsx` (7 tests), and ran `oxfmt` and `oxlint` from the main checkout; the captured output shows only oxfmt's line, and verify's lint result (0 findings) is the evidence for the file. PostHog's pre-commit hook failed (`bin/hogli: exec: python: not found`, the hook needs the flox Python), so it committed with `--no-verify`, as the skill says, and named the skipped hook in the summary.
6. **Verify passed.** 112 of 300 lines, one file, inside the scope, no busy file touched, 0 lint findings before and after. jest ran in the workspace with the main checkout's `frontend/node_modules` borrowed: 7 of 7 passed in 1.4 s.
7. **Propose** (dry run) wrote [`pr.md`](pr.md) from the agent's [`summary.md`](summary.md). Nothing was pushed.
8. **Record** appended the ledger entry ([`ledger-entry.jsonl`](ledger-entry.jsonl)). Choose then printed `done`: budget 1 of 1 spent.

## The change

[`posthog.diff`](posthog.diff) is the branch as a patch: one commit, `8eb2dda92c3`, adding `products/workflows/frontend/Workflows/EmailLinksTable.test.tsx` (+112, no production code). The tests pin how the table shows links today: whole URLs are links in a new tab, truncated URLs are plain text with "…", a duplicate URL gets "Position N" only with a non-empty link index, clicks get thousands separators, row order holds, and the empty state shows.

## Index before and after

For the touched module, from `verify` (the numbers in `pr.md` and the ledger):

| `products/workflows/frontend/Workflows` | Before | After |
| --- | ---: | ---: |
| composite | 65.1 | 65.1 |
| architecture | 72.3 | 72.3 |
| complexity | 79.8 | 79.8 |
| smells | 81.6 | 81.6 |
| **tests** (targeted) | 17.6 | 17.8 |

For the whole scope, `bun coherence/index.ts --json` at the base and at the branch ([`index-before.json`](index-before.json), [`index-after.json`](index-after.json)):

| `products/workflows` | `57ca357` | `8eb2dda` |
| --- | ---: | ---: |
| composite | 62.1 | 62.1 |
| architecture | 60.6 | 60.6 |
| complexity | 72.4 | 72.4 |
| smells | 80.4 | 80.4 |
| tests | 33.6 | 33.7 |

One test file for one of the module's 24 untested files moves the scope's tests score by 0.1, well inside the workflows weekday band of ±0.6. The loop's value is the ratchet over many iterations, not one.

## The Python test path

The iteration touched only a frontend file, so verify ran no pytest. To exercise the Python path anyway, I called the runner's `runTests` by hand (through `check-scripts/python-test-path.ts.txt`) on one workflows Python test in the same workspace, with the main checkout's flox venv and the local dev services up. pytest crashed before collection: the venv follows the main checkout (`protobuf` 5.29.6), and the fresh base needs 6.31.1. The runner reported that as `failed`, not `not run`, so a Python iteration on a fresh base would fail verify although no test ran. Evidence: [`python-test-path.txt`](python-test-path.txt). Recorded as [#85](https://github.com/Silthus/uml-pr-review/issues/85).

## Questions raised

None. The run raised no new inbox question: the two boundary targets above it already wait on #82 and #83, and the target it chose is mechanical.

## Defects recorded as children of #67

- [#85](https://github.com/Silthus/uml-pr-review/issues/85): verify reports pytest "failed" when the borrowed venv cannot load PostHog's conftest.
- [#86](https://github.com/Silthus/uml-pr-review/issues/86): `sense --fetch` fails headless when the SSH agent needs approval.
- [#87](https://github.com/Silthus/uml-pr-review/issues/87): `session.ts` cannot pass `--runs`, `--active-days`, or `--max-questions`, and promoting a dry run to a draft leaves the ledger's `pullRequest` at the `pr.md` path.
- [#88](https://github.com/Silthus/uml-pr-review/issues/88), from the review: a dry-run proposal permanently uses up its target. The ledger on `main` now holds two dry runs (`hogflows/steps` and `frontend/Workflows`) whose branches are gone, so the next run skips ranks 3 and 4 until their lines are deleted.

None is a one-liner, so none is fixed here. Because of #87, this run used the default runs directory instead of a fresh one; the ledger's memory then made it pick a new target instead of repeating PR #84's.

## Incident during the README check

The first check of the `--draft` and `inbox resolve` commands was meant to run against a fake `gh`, but the fake was not executable, so the real `gh` ran. No branch was pushed and GitHub refused the draft pull request, but #82 got a placeholder comment and was closed, and #83 was closed as not planned. Both were restored two minutes later (closed 21:43:42Z, reopened 21:45:40Z): the comment deleted, both reopened, and the inbox lists both as open again. Details: [`incident-fake-gh.txt`](incident-fake-gh.txt). The clean rerun is [`readme-check.txt`](readme-check.txt).

## Cleanup

See [`cleanup.txt`](cleanup.txt): the scratch worktree and its branch are removed from `~/dev/posthog`.

## Files not linked above

- [`iteration.json`](iteration.json): the runner state at propose time, with the full verify output.
- [`check-scripts/`](check-scripts/): the helpers behind `readme-check.txt` (the logging wrapper, the ordered run, the fake `gh` and `git`), the transcript renderer, the ranking printer, and the pytest-path probe.
- [`gate.txt`](gate.txt): `bun test` and `bun run typecheck` on the final tree.
