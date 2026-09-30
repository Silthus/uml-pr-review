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
- **Hook named the invariant after it**: a `PostToolUse` `hook_response` on a `Write`, `Edit`, or `MultiEdit` after that edit, whose output contains the invariant's full `<component>/<name>`. Only Coherence prints that full name. The lint message the case adds carries only the short name.
- **Final `run` verdict**: `coherence run --invariant <name> --json` on the final tree.
- **Wall time**: from spawning `claude` to its `result` record.
- **Ended**: the `result` record's subtype, such as `success` or `error_max_turns` (`no result` if none arrived), and the exit code of `claude`.
- **Hook times**: stream-json carries no timestamps, so the harness stamps each line on arrival (`received_ms`). A hook's time runs from its `hook_started` line to its `hook_response` line.
- **Edit hook latency**: counts only the `PostToolUse` hooks on `Write`, `Edit`, and `MultiEdit`, which are the ones that check the edited file.
- **SessionStart and Stop**: Coherence installs its hooks with a 60 s timeout. A time near 60 s means the hook was cancelled at that timeout, and its record in `hooks.jsonl` reads `"outcome":"cancelled"`.

PostHog's own SessionStart scripts are removed from the `/tmp` copy of `.claude/settings.json`, identically in both arms.

- `setup-flox.sh` runs `flox activate` wherever flox is installed, as it is here. That can reach the network, and it runs the environment's activation hooks, which could install packages through the `node_modules` symlinks into `~/posthog`.
- `setup-cloud.sh` does nothing unless `CLAUDE_CODE_REMOTE=true`, and the harness unsets that variable.
- `setup-code-signing.sh` only looks for a macOS socket.

Coherence's own hooks stay, in the hooks arm only. `acceptEdits` allows edits inside the worktree and read-only commands. Headless, every other command is denied.

Threats to validity:

- **The task asks for no fix.** It dictates the file ("contains exactly this") and keeps the change to that one file. Criterion 2 asks for a fix the task never asks for, so a hooks run can meet it only by departing from the task. A headless `-p` run also has nobody to answer a question.
- **SessionStart never ran as shipped.** A SessionStart marked `(cancelled)` hit the 60 s timeout, so Coherence's session context never reached the agent. The edit hooks ran normally.
- **Evidence is re-scored, not re-run.** The runs used `run.ts` as committed in `69aa009`. Later commits changed only how sessions are read and reported, not how runs are made. `report` re-scores every session from its recorded transcript, stops if introduced or flagged disagree with what the run recorded, and writes the re-scored session back into `run.json`.
- **The four arm processes ran at the same time.** The runs inside each arm ran one after another. Each `~/posthog` check covers only its own kit folder and ref.
- **The `~/posthog` check has blind spots.** It cannot see writes through the `node_modules` symlinks, because `node_modules` is gitignored.
- **The sample is small.** Three runs per arm describe these runs. They do not give a rate.

## #64506: `nodejs/src/ingestion/common/event-pipeline/transformEventStep.ts`

Invariant: `nodejs/src/ingestion/ingestion never reaches cdp` in [`nodejs/src/ingestion/Ingestion.spec.md`](../../benchmark/replay/cases/64506/Ingestion.spec.md), at PostHog `645e1a781407`.

| Run | Violation introduced | Hook named the invariant after it | Fixed in session | Final `run` verdict | Reviewer's route | Turns | Wall time | Ended | Edit hook latency (median, max) | SessionStart / Stop hooks | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [control 1](64506/control-1/) | yes | n/a | no | fail | no | 4 | 14 s | success, exit 0 | n/a | n/a | [transcript](64506/control-1/transcript.jsonl), [hooks](64506/control-1/hooks.jsonl), [diff](64506/control-1/final.diff), [run --status](64506/control-1/run-status.txt), [lint](64506/control-1/lint.txt), [witness](64506/control-1/witness.txt) |
| [control 2](64506/control-2/) | yes | n/a | no | fail | no | 3 | 14 s | success, exit 0 | n/a | n/a | [transcript](64506/control-2/transcript.jsonl), [hooks](64506/control-2/hooks.jsonl), [diff](64506/control-2/final.diff), [run --status](64506/control-2/run-status.txt), [lint](64506/control-2/lint.txt), [witness](64506/control-2/witness.txt) |
| [control 3](64506/control-3/) | yes | n/a | no | fail | no | 4 | 14 s | success, exit 0 | n/a | n/a | [transcript](64506/control-3/transcript.jsonl), [hooks](64506/control-3/hooks.jsonl), [diff](64506/control-3/final.diff), [run --status](64506/control-3/run-status.txt), [lint](64506/control-3/lint.txt), [witness](64506/control-3/witness.txt) |
| [hooks 1](64506/hooks-1/) | yes | yes | no | fail | no | 5 | 135 s | success, exit 0 | 3.9 s (max 3.9 s) | 60.2 s (cancelled) / 51.7 s | [transcript](64506/hooks-1/transcript.jsonl), [hooks](64506/hooks-1/hooks.jsonl), [diff](64506/hooks-1/final.diff), [run --status](64506/hooks-1/run-status.txt), [lint](64506/hooks-1/lint.txt), [witness](64506/hooks-1/witness.txt) |
| [hooks 2](64506/hooks-2/) | yes | yes | no | fail | no | 3 | 116 s | success, exit 0 | 3.9 s (max 3.9 s) | 60.2 s (cancelled) / 37.2 s | [transcript](64506/hooks-2/transcript.jsonl), [hooks](64506/hooks-2/hooks.jsonl), [diff](64506/hooks-2/final.diff), [run --status](64506/hooks-2/run-status.txt), [lint](64506/hooks-2/lint.txt), [witness](64506/hooks-2/witness.txt) |
| [hooks 3](64506/hooks-3/) | yes | yes | no | fail | no | 5 | 122 s | success, exit 0 | 4 s (max 4 s) | 60.2 s (cancelled) / 39 s | [transcript](64506/hooks-3/transcript.jsonl), [hooks](64506/hooks-3/hooks.jsonl), [diff](64506/hooks-3/final.diff), [run --status](64506/hooks-3/run-status.txt), [lint](64506/hooks-3/lint.txt), [witness](64506/hooks-3/witness.txt) |

1. Control: 3 of 3 runs end with the bypass in the final diff and `run` failing the invariant.
2. Hooks: 0 of 3 runs have a hook name the invariant after the bypassing edit, end without the bypass, pass `run`, and take the reviewer's route (`~/common/hog-transformations/hog-transformer.interface`).
3. Consistency: criterion 1 needs 2 of 3 control runs and criterion 2 needs 2 of 3 hooks runs.

In 3 of 3 hooks runs a hook named the invariant, and the session still ended with the bypass.
In 2 of 3 hooks runs the final answer named the reviewer's route, but the file kept the bypass. This is outside the criteria.

In 1 of 3 hooks runs the session kept the dictated content and ended with a question to the user. A headless `-p` run has nobody to answer it:

- hooks 1 ended by asking: “Do you want me to switch the file to the interface version?”

**Verdict: not met**

### Setup and deviations

- The case runs at PostHog master `645e1a78140`, the commit the kit was proven on in #117, not at a merge base. Master's merge base with the correction's `before` commit is `37a8942` (2026-06-18); with the PR head it is `27fc580`. At `37a8942`, `nodejs/` still linted with ESLint: `nodejs/.oxlintrc.nodejs.json` arrived in PostHog #99329 on 2026-09-11. The reviewer's `~/common/hog-transformations/hog-transformer.interface.ts` was missing too, along with the `event-pipeline/` folder under `nodejs/src/ingestion/common/`. #64506 created the interface on its own branch, and it reached master only with the squash merge `853f95f`. The spec's note that the interface existed at the merge base is wrong. At `645e1a78140` the enforcer and the interface both exist, and the dictated file is new. Both arms use this ref.
- Contamination: at master the fix is already merged. The interface's doc comment says it exists so that ingestion never imports cdp, so an agent that reads it finds the route. Both arms can read it; only the hooks arm is pointed toward `~/common`.
- Found in review, after the runs: `nodejs/src/ingestion/pipelines/sessionreplay/ml-mirror-image-scrub-sidecar/.oxlintrc.json` has no `extends`, so the `~/cdp` ban does not reach that sidecar's files. That makes the oracle less than total over "every non-test import under nodejs/src/ingestion". The runs used the spec as written, and the dictated file is outside the sidecar, so no row changes. A future run should list the sidecar as a residual or add the ban to nested configs.
- The dictated content is the file at the correction's `before` commit, `874a5727`.
- Enforcer: the `~/cdp` pattern is appended to the ingestion override's `eslint/no-restricted-imports` in the `/tmp` copy of `nodejs/.oxlintrc.nodejs.json`. Its message names the invariant and its spec, and says to depend on the contracts in `~/common`. It does not name the interface file.
- Listed residual: two test files under `nodejs/src/ingestion` import `~/cdp` on master, so a second override for `src/ingestion/**/*.test.ts` keeps the original rule. The bullet's `over:` already says "every non-test import".
- Pre-declaration fixes: none. No non-test file under `nodejs/src/ingestion` imports `~/cdp` at this ref.

## #68756: `posthog/admin/admins/team_admin.py`

Invariant: `posthog/helpers/impersonation read through is_impersonated` in [`posthog/helpers/Helpers.spec.md`](../../benchmark/replay/cases/68756/Helpers.spec.md), at PostHog `4a6a40136a81`.

| Run | Violation introduced | Hook named the invariant after it | Fixed in session | Final `run` verdict | Reviewer's route | Turns | Wall time | Ended | Edit hook latency (median, max) | SessionStart / Stop hooks | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [control 1](68756/control-1/) | yes | n/a | no | fail | no | 14 | 42 s | success, exit 0 | n/a | n/a | [transcript](68756/control-1/transcript.jsonl), [hooks](68756/control-1/hooks.jsonl), [diff](68756/control-1/final.diff), [run --status](68756/control-1/run-status.txt), [lint](68756/control-1/lint.txt), [witness](68756/control-1/witness.txt) |
| [control 2](68756/control-2/) | yes | n/a | no | fail | no | 7 | 154 s | success, exit 0 | n/a | n/a | [transcript](68756/control-2/transcript.jsonl), [hooks](68756/control-2/hooks.jsonl), [diff](68756/control-2/final.diff), [run --status](68756/control-2/run-status.txt), [lint](68756/control-2/lint.txt), [witness](68756/control-2/witness.txt) |
| [control 3](68756/control-3/) | yes | n/a | no | fail | no | 6 | 151 s | success, exit 0 | n/a | n/a | [transcript](68756/control-3/transcript.jsonl), [hooks](68756/control-3/hooks.jsonl), [diff](68756/control-3/final.diff), [run --status](68756/control-3/run-status.txt), [lint](68756/control-3/lint.txt), [witness](68756/control-3/witness.txt) |
| [hooks 1](68756/hooks-1/) | yes | yes | no | fail | no | 12 | 246 s | success, exit 0 | 14.6 s (max 15.4 s) | 60.1 s (cancelled) / 60 s (cancelled) | [transcript](68756/hooks-1/transcript.jsonl), [hooks](68756/hooks-1/hooks.jsonl), [diff](68756/hooks-1/final.diff), [run --status](68756/hooks-1/run-status.txt), [lint](68756/hooks-1/lint.txt), [witness](68756/hooks-1/witness.txt) |
| [hooks 2](68756/hooks-2/) | yes | yes | no | fail | no | 18 | 265 s | success, exit 0 | 14.8 s (max 16.8 s) | 60.1 s (cancelled) / 60 s (cancelled) | [transcript](68756/hooks-2/transcript.jsonl), [hooks](68756/hooks-2/hooks.jsonl), [diff](68756/hooks-2/final.diff), [run --status](68756/hooks-2/run-status.txt), [lint](68756/hooks-2/lint.txt), [witness](68756/hooks-2/witness.txt) |
| [hooks 3](68756/hooks-3/) | yes | yes | no | fail | no | 4 | 282 s | success, exit 0 | 15 s (max 15 s) | 60.1 s (cancelled) / 60 s (cancelled) | [transcript](68756/hooks-3/transcript.jsonl), [hooks](68756/hooks-3/hooks.jsonl), [diff](68756/hooks-3/final.diff), [run --status](68756/hooks-3/run-status.txt), [lint](68756/hooks-3/lint.txt), [witness](68756/hooks-3/witness.txt) |

1. Control: 3 of 3 runs end with the bypass in the final diff and `run` failing the invariant.
2. Hooks: 0 of 3 runs have a hook name the invariant after the bypassing edit, end without the bypass, pass `run`, and take the reviewer's route (`is_impersonated(request)`).
3. Consistency: criterion 1 needs 2 of 3 control runs and criterion 2 needs 2 of 3 hooks runs.

In 3 of 3 hooks runs a hook named the invariant, and the session still ended with the bypass.
In 3 of 3 hooks runs the final answer named the reviewer's route, but the file kept the bypass. This is outside the criteria.

In 1 of 3 hooks runs the session kept the dictated content and ended with a question to the user. A headless `-p` run has nobody to answer it:

- hooks 3 ended by asking: “Want me to make that change?”

**Verdict: not met**

### Setup and deviations

- The case runs at `4a6a401`, master's merge base with the correction's `before` commit `1b52cff`. That is the tree the reviewer commented on. The PR head's merge base is later, `4fc2592`, because the branch merged master after the review. The dictated content is `team_admin.py` at `1b52cff` (1,454 lines).
- The chokepoint form resolved, so the ruff TID251 fallback was not needed. `coherence run` resolved both names and graded the bullet `reference-choked`, and the kit's witness went red on a staged import, then green. The hook that gives feedback during the build is Coherence's own `PostToolUse` check, unchanged from what ships upstream.
- At this commit, `is_impersonated_session` in `model_activity.py` is a small wrapper function, not a re-export. Coherence protects it the same way.
- Pre-declaration fixes: three files reached the protected function at the merge base, not the single file the spec expected. All three now call `is_impersonated`, identically in both arms: `posthog/event_usage.py`, `posthog/api/file_system/file_system_logging.py`, and `products/signals/backend/views.py`.
- Direct imports from `loginas.utils` (about 15 files) are outside the chokepoint form, and this replay does not need them.
- The enforcer is Coherence's reference check, not a linter. Each run's `lint.txt` is plain ruff on the final file, recorded only for completeness, so it is clean even when the bypass is present.
