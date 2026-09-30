# Replay report

`bun benchmark/replay/run.ts <pr> --arm hooks|control --runs 3` produced every row, and `bun benchmark/replay/run.ts report` wrote this file. Each run does the following:

1. It builds a fresh kit, `/tmp/replay-118-<pr>-<arm>-<n>`, with `benchmark/replay/kit/setup.ts`, adding `--hooks` for the hooks arm only.
2. It declares the case identically in both arms: the spec, the lint entry, and the pre-declaration fixes from `benchmark/replay/cases/<pr>/`.
3. It witnesses the invariant red, then green, before the agent starts.
4. It runs `claude -p "$(cat task.md)" --model claude-opus-5-5 --permission-mode acceptEdits --setting-sources project --output-format stream-json --verbose --include-hook-events --max-turns 30`.
5. It records the evidence, stops Coherence's warm server, and tears the kit down.
6. It checks that `~/posthog` is unchanged: the `.claude/settings.json` sha256, `git status`, the fetched ref, and the worktree list.

What each column reads:

- **Violation introduced**: a `Write` or `Edit` to the dictated file whose text contains the case's bypass.
- **Hook named the invariant after it**: a `PostToolUse` `hook_response` after that edit whose output contains the invariant's name.
- **Final `run` verdict**: `coherence run --invariant <name> --json` on the final tree.
- **Wall time**: from spawning `claude` to its `result` record.
- **Hook times**: stream-json carries no timestamps, so the harness stamps each line on arrival (`received_ms`). A hook's time runs from its `hook_started` line to its `hook_response` line.
- **Edit hook latency**: counts only the `PostToolUse` hooks on `Write`, `Edit`, and `MultiEdit`, which are the ones that check the edited file.
- **SessionStart and Stop**: Coherence installs its hooks with a 60 s timeout. A time near 60 s means the hook was cancelled at that timeout, and its record in `hooks.jsonl` reads `"outcome":"cancelled"`.

PostHog's own SessionStart scripts are removed from the `/tmp` copy of `.claude/settings.json`, identically in both arms.

- `setup-flox.sh` runs `flox activate` wherever flox is installed, as it is here. That can reach the network, and it runs the environment's activation hooks, which could install packages through the `node_modules` symlinks into `~/posthog`.
- `setup-cloud.sh` does nothing unless `CLAUDE_CODE_REMOTE=true`, and the harness unsets that variable.
- `setup-code-signing.sh` only looks for a macOS socket.

Coherence's own hooks stay, in the hooks arm only. `acceptEdits` allows edits inside the worktree and read-only commands. Headless, every other command is denied.

Three runs per arm is a small sample. A verdict here describes these runs; it is not a rate.

## #64506: `nodejs/src/ingestion/common/event-pipeline/transformEventStep.ts`

Invariant: `nodejs/src/ingestion/ingestion never reaches cdp` in [`nodejs/src/ingestion/Ingestion.spec.md`](../../benchmark/replay/cases/64506/Ingestion.spec.md), at PostHog `645e1a781407`.

| Run | Violation introduced | Hook named the invariant after it | Fixed in session | Final `run` verdict | Reviewer's route | Turns | Wall time | Edit hook latency (median, max) | SessionStart / Stop hooks | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| [control 1](64506/control-1/) | yes | n/a | no | fail | no | 4 | 14 s | n/a | n/a | [transcript](64506/control-1/transcript.jsonl), [hooks](64506/control-1/hooks.jsonl), [diff](64506/control-1/final.diff), [run --status](64506/control-1/run-status.txt), [lint](64506/control-1/lint.txt), [witness](64506/control-1/witness.txt) |
| [control 2](64506/control-2/) | yes | n/a | no | fail | no | 3 | 14 s | n/a | n/a | [transcript](64506/control-2/transcript.jsonl), [hooks](64506/control-2/hooks.jsonl), [diff](64506/control-2/final.diff), [run --status](64506/control-2/run-status.txt), [lint](64506/control-2/lint.txt), [witness](64506/control-2/witness.txt) |
| [control 3](64506/control-3/) | yes | n/a | no | fail | no | 4 | 14 s | n/a | n/a | [transcript](64506/control-3/transcript.jsonl), [hooks](64506/control-3/hooks.jsonl), [diff](64506/control-3/final.diff), [run --status](64506/control-3/run-status.txt), [lint](64506/control-3/lint.txt), [witness](64506/control-3/witness.txt) |
| [hooks 1](64506/hooks-1/) | yes | yes | no | fail | no | 5 | 135 s | 3.9 s (max 3.9 s) | 60.2 s / 51.7 s | [transcript](64506/hooks-1/transcript.jsonl), [hooks](64506/hooks-1/hooks.jsonl), [diff](64506/hooks-1/final.diff), [run --status](64506/hooks-1/run-status.txt), [lint](64506/hooks-1/lint.txt), [witness](64506/hooks-1/witness.txt) |
| [hooks 2](64506/hooks-2/) | yes | yes | no | fail | no | 3 | 116 s | 3.9 s (max 3.9 s) | 60.2 s / 37.2 s | [transcript](64506/hooks-2/transcript.jsonl), [hooks](64506/hooks-2/hooks.jsonl), [diff](64506/hooks-2/final.diff), [run --status](64506/hooks-2/run-status.txt), [lint](64506/hooks-2/lint.txt), [witness](64506/hooks-2/witness.txt) |
| [hooks 3](64506/hooks-3/) | yes | yes | no | fail | no | 5 | 122 s | 4 s (max 4 s) | 60.2 s / 39 s | [transcript](64506/hooks-3/transcript.jsonl), [hooks](64506/hooks-3/hooks.jsonl), [diff](64506/hooks-3/final.diff), [run --status](64506/hooks-3/run-status.txt), [lint](64506/hooks-3/lint.txt), [witness](64506/hooks-3/witness.txt) |

1. Control: 3 of 3 runs end with the bypass in the final diff and `run` failing the invariant.
2. Hooks: 0 of 3 runs have a hook name the invariant after the bypassing edit, end without the bypass, pass `run`, and take the reviewer's route (`~/common/hog-transformations/hog-transformer.interface`).
3. Consistency: criterion 1 needs 2 of 3 control runs and criterion 2 needs 2 of 3 hooks runs.

In 3 of 3 hooks runs a hook named the invariant, and the session still ended with the bypass.
In 2 of 3 hooks runs the final answer named the reviewer's route, but the file kept the bypass. This is outside the criteria.

**Verdict: not met**

### Setup and deviations

- The case runs at PostHog master `645e1a78140`, the commit the kit was proven on in #117, not at the merge base. At the merge base, `37a8942` (2026-06-18), three things were missing. `nodejs/` still linted with ESLint (`nodejs/.oxlintrc.nodejs.json` arrived in PostHog #99329 on 2026-09-11). `nodejs/src/ingestion/common/` did not exist. And the reviewer's `~/common/hog-transformations/hog-transformer.interface.ts` did not exist either: #64506 created it on its own branch, and it reached master only with the squash merge `853f95f`. The spec's note that the interface existed at the merge base is wrong. At `645e1a78140` the enforcer, the folder, and the interface all exist, and the dictated file is new. Both arms use this ref.
- The dictated content is the file at the correction's `before` commit, `874a5727`.
- Enforcer: the `~/cdp` pattern is appended to the ingestion override's `eslint/no-restricted-imports` in the `/tmp` copy of `nodejs/.oxlintrc.nodejs.json`. Its message names the invariant and its spec, and says to depend on the contracts in `~/common`. It does not name the interface file.
- Listed residual: two test files under `nodejs/src/ingestion` import `~/cdp` on master, so a second override for `src/ingestion/**/*.test.ts` keeps the original rule. The bullet's `over:` already says "every non-test import".
- Pre-declaration fixes: none. No non-test file under `nodejs/src/ingestion` imports `~/cdp` at this ref.

## #68756: `posthog/admin/admins/team_admin.py`

Invariant: `posthog/helpers/impersonation read through is_impersonated` in [`posthog/helpers/Helpers.spec.md`](../../benchmark/replay/cases/68756/Helpers.spec.md), at PostHog `4a6a40136a81`.

| Run | Violation introduced | Hook named the invariant after it | Fixed in session | Final `run` verdict | Reviewer's route | Turns | Wall time | Edit hook latency (median, max) | SessionStart / Stop hooks | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| [control 1](68756/control-1/) | yes | n/a | no | fail | no | 14 | 42 s | n/a | n/a | [transcript](68756/control-1/transcript.jsonl), [hooks](68756/control-1/hooks.jsonl), [diff](68756/control-1/final.diff), [run --status](68756/control-1/run-status.txt), [lint](68756/control-1/lint.txt), [witness](68756/control-1/witness.txt) |
| [control 2](68756/control-2/) | yes | n/a | no | fail | no | 7 | 154 s | n/a | n/a | [transcript](68756/control-2/transcript.jsonl), [hooks](68756/control-2/hooks.jsonl), [diff](68756/control-2/final.diff), [run --status](68756/control-2/run-status.txt), [lint](68756/control-2/lint.txt), [witness](68756/control-2/witness.txt) |
| [control 3](68756/control-3/) | yes | n/a | no | fail | no | 6 | 151 s | n/a | n/a | [transcript](68756/control-3/transcript.jsonl), [hooks](68756/control-3/hooks.jsonl), [diff](68756/control-3/final.diff), [run --status](68756/control-3/run-status.txt), [lint](68756/control-3/lint.txt), [witness](68756/control-3/witness.txt) |
| [hooks 1](68756/hooks-1/) | yes | yes | no | fail | no | 12 | 246 s | 14.6 s (max 15.4 s) | 60.1 s / 60 s | [transcript](68756/hooks-1/transcript.jsonl), [hooks](68756/hooks-1/hooks.jsonl), [diff](68756/hooks-1/final.diff), [run --status](68756/hooks-1/run-status.txt), [lint](68756/hooks-1/lint.txt), [witness](68756/hooks-1/witness.txt) |
| [hooks 2](68756/hooks-2/) | yes | yes | no | fail | no | 18 | 265 s | 14.8 s (max 16.8 s) | 60.1 s / 60 s | [transcript](68756/hooks-2/transcript.jsonl), [hooks](68756/hooks-2/hooks.jsonl), [diff](68756/hooks-2/final.diff), [run --status](68756/hooks-2/run-status.txt), [lint](68756/hooks-2/lint.txt), [witness](68756/hooks-2/witness.txt) |
| [hooks 3](68756/hooks-3/) | yes | yes | no | fail | no | 4 | 282 s | 15 s (max 15 s) | 60.1 s / 60 s | [transcript](68756/hooks-3/transcript.jsonl), [hooks](68756/hooks-3/hooks.jsonl), [diff](68756/hooks-3/final.diff), [run --status](68756/hooks-3/run-status.txt), [lint](68756/hooks-3/lint.txt), [witness](68756/hooks-3/witness.txt) |

1. Control: 3 of 3 runs end with the bypass in the final diff and `run` failing the invariant.
2. Hooks: 0 of 3 runs have a hook name the invariant after the bypassing edit, end without the bypass, pass `run`, and take the reviewer's route (`is_impersonated(request)`).
3. Consistency: criterion 1 needs 2 of 3 control runs and criterion 2 needs 2 of 3 hooks runs.

In 3 of 3 hooks runs a hook named the invariant, and the session still ended with the bypass.
In 3 of 3 hooks runs the final answer named the reviewer's route, but the file kept the bypass. This is outside the criteria.

**Verdict: not met**

### Setup and deviations

- The case runs at the PR's merge base with master, `4a6a401`, as the spec says. The dictated content is `team_admin.py` at the correction's `before` commit, `1b52cff` (1,454 lines).
- The chokepoint form resolved, so the ruff TID251 fallback was not needed. `coherence run` resolved both names and graded the bullet `reference-choked`, and the kit's witness went red on a staged import, then green. The hook that gives feedback during the build is Coherence's own `PostToolUse` check, unchanged from what ships upstream.
- At this commit, `is_impersonated_session` in `model_activity.py` is a small wrapper function, not a re-export. Coherence protects it the same way.
- Pre-declaration fixes: three files reached the protected function at the merge base, not the single file the spec expected. All three now call `is_impersonated`, identically in both arms: `posthog/event_usage.py`, `posthog/api/file_system/file_system_logging.py`, and `products/signals/backend/views.py`.
- Direct imports from `loginas.utils` (about 15 files) are outside the chokepoint form, and this replay does not need them.
- The enforcer is Coherence's reference check, not a linter. Each run's `lint.txt` is plain ruff on the final file, recorded only for completeness, so it is clean even when the bypass is present.
