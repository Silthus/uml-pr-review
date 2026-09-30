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

## v2: protocol without the confound

v1 above could not meet criterion 2: its task dictated the file and kept the change to that file, so the fix it asked the hooks arm for was one the task forbade. v2 changes three things and keeps the rest of v1's method.

1. **Prompts that allow the fix.** Each case has two variants, with 3 hooks and 3 control runs each:
   - **draft**: v1's task with two sentences changed. The file's `before` content is given as "my draft of `<file>` to start from", and the task ends "Make this change; follow the codebase's conventions. Do not run git." The code block is v1's, byte for byte. It no longer says "exactly" or keeps the change to one file.
   - **intent**: the PR's title and intent, plus what the change does in the commented file, in prose. No code is given, so this variant measures whether the violation arises at all.
2. **The edit hook only.** `setup.ts --hooks` runs `coherence hooks install --host claude`, which wires six events. For the hooks arm, `keepOnlyEditHook` in `benchmark/replay/v2.ts` then deletes Coherence's entries for `SessionStart`, `SubagentStart`, `UserPromptSubmit`, `Stop`, and `SubagentStop` from the `/tmp` worktree's `.claude/settings.json`, and keeps `PostToolUse`. Hooks that are not Coherence's stay. Each hooks run's `witness.txt` records the line that names what was turned off.
   - Why not `.coherence/hooks/<Event>.override.md`: Coherence applies an override to the text only, after the event has done its work. In `runHook` (`src/lifecycle/hook.ts`), `SessionStart` computes `lexiconCoverage` and waits on `gapReading` before `voiced` applies the override, and `Stop` still checks the changed files. An empty override silences the event but keeps its cost. `coherence hooks install` has no per-event option, so deleting the entries is the only way to turn an event off. `coherence hooks check` would name the deleted events as missing.
3. **Criterion 2 without the route.** A hooks run meets it when an edit hook names the invariant after the bypassing edit, the session ends without the bypass, and `run` passes. The reviewer's-route column is informational.

The rest is v1's method: a fresh kit per run, the identical declaration in both arms, the witness red then green, PostHog's own SessionStart scripts removed in both arms, the same headless `claude -p` command with `acceptEdits`, and the `~/posthog` check after every run. Kits are `/tmp/replay-124-<pr>-<variant>-<arm>-<n>`, and evidence is in `docs/replay/v2/<pr>/<variant>/<arm>-<n>/`. The command was `bun benchmark/replay/run.ts <pr> --arm hooks|control --runs 3 --variant draft|intent`.

The runs can't reach out. PostHog's `.claude/settings.json` grants no `permissions.allow`, the runs load only project settings, and no run gets a follow-up turn, so headless `acceptEdits` denies every Bash call that is not read-only. The command audit below also reads every v2 transcript for a Bash call that could reach the network or write outside the worktree.

Deviations from v1:

- `--max-turns` is 50, not 30, because the intent prompts leave the agent to explore. A run that hit the limit says `error_max_turns` in its row.
- The eight arm-and-variant processes ran at the same time. Wall times include that contention, in both arms.

**Adoption cost** compares the medians of the hooks arm and the control arm in one variant: wall time, turns, and the edit hook's own time per `Write`, `Edit`, or `MultiEdit`. The SessionStart / Stop column reads `off` for v2 hooks runs, because those hooks were not installed.

**A separate finding, not re-measured here: the full install's SessionStart.** With every Coherence hook installed, v1's SessionStart hit its 60 s timeout in 6 of 6 hooks runs (the SessionStart / Stop column in v1's tables above), so its context never reached the agent, and Stop was cancelled in 3 of 3 Python runs. That cost at least 60 s per session. v2 does not install those hooks, so it neither repeats nor re-measures that number.

Threats to validity:

- **The declaration is visible in both arms.** Both arms carry the spec and the lint entry, uncommitted in the `/tmp` worktree, so the control arm is "declared, without the hook", not "undeclared". An agent free to explore can read the spec, or diff the lint config, before it writes. v1's dictated task hid this effect.
- **The sample is small.** Three runs per arm and variant describe these runs. They do not give a rate.

Command audit: 17 Bash calls in 24 transcripts tried `gh`, `git push`, `git commit`, `curl`, `wget`, `flox`, a package manager, or `uv`, and 0 of them ran.
- v2/64506/intent/control-2, denied: `cd /tmp/replay-124-64506-intent-control-2/posthog/nodejs && npx tsc --noEmit -p . 2>&1 | grep -i "transformEventStep\|error" | head -20`
- v2/64506/intent/control-3, denied: `npx tsc --noEmit -p . 2>&1 | grep -i "transformEventStep" ; echo tsc-done; npx oxlint -c .oxlintrc.nodejs.json src/ingestion/common/event-pipeline/transformEventStep.ts 2>&1 | tail -5`
- v2/64506/intent/control-3, denied: `npx oxlint -c .oxlintrc.nodejs.json src/ingestion/common/event-pipeline/transformEventStep.ts 2>&1 | tail -5`
- v2/64506/intent/hooks-1, denied: `cd /tmp/replay-124-64506-intent-hooks-1/posthog/nodejs; /home/coder/posthog/node_modules/.bin/oxlint -c .oxlintrc.nodejs.json src/ingestion/common/event-pipeline/ 2>&1 | tail -15; npx tsc --noEmit -p . 2>&1 | grep -i "event-pipeline\|error" | head`
- v2/64506/intent/hooks-1, denied: `npx --prefix /tmp/replay-124-64506-intent-hooks-1/posthog/nodejs tsc --noEmit -p /tmp/replay-124-64506-intent-hooks-1/posthog/nodejs/tsconfig.json`
- v2/64506/intent/control-1, denied: `cd /tmp/replay-124-64506-intent-control-1/posthog/nodejs && timeout 600 npx tsc --noEmit -p . 2>&1 | tail -15; npx oxlint src/ingestion/common/event-pipeline 2>&1 | tail -5`
- v2/64506/intent/control-1, denied: `npx tsc --noEmit -p /tmp/replay-124-64506-intent-control-1/posthog/nodejs`
- v2/64506/intent/hooks-2, denied: `cd .. && ./node_modules/.bin/oxlint -c nodejs/.oxlintrc.nodejs.json nodejs/src/ingestion/common/event-pipeline/ 2>&1 | tail -5; ./node_modules/.bin/oxfmt nodejs/src/ingestion/common/event-pipeline/transformEventStep.ts 2>&1 | tail -3; cd nodejs && npx tsc --noEmit -p . 2>&1 | grep -i "event-pipeline" | head`
- v2/64506/intent/hooks-2, denied: `npx tsc --noEmit -p /tmp/replay-124-64506-intent-hooks-2/posthog/nodejs/tsconfig.json`
- v2/64506/intent/hooks-3, denied: `npx oxlint -c .oxlintrc.nodejs.json src/ingestion/common/event-pipeline/ 2>&1 | tail -5; npx tsc --noEmit -p . 2>&1 | grep -i "transformEventStep" | head; echo tsc-done`
- v2/64506/intent/hooks-3, denied: `npx oxlint -c .oxlintrc.nodejs.json src/ingestion/common/event-pipeline/`
- v2/64506/draft/control-2, denied: `npx oxlint -c .oxlintrc.nodejs.json src/ingestion 2>&1 | tail -15`
- v2/64506/draft/control-2, denied: `npx oxlint -c /tmp/replay-124-64506-draft-control-2/posthog/nodejs/.oxlintrc.nodejs.json /tmp/replay-124-64506-draft-control-2/posthog/nodejs/src/ingestion`
- v2/64506/draft/control-3, denied: `npx oxlint -c .oxlintrc.nodejs.json src/ingestion 2>&1 | tail -15`
- v2/64506/draft/hooks-1, denied: `timeout 300 npx oxlint -c .oxlintrc.nodejs.json src/ingestion 2>&1 | grep -iE "cdp|no-restricted-imports|Found|error" | tail -15`
- v2/64506/draft/hooks-2, denied: `npx jest src/ingestion/common/steps/event-processing/hog-transform-event-step.test.ts 2>&1 | tail -20; npx tsc --noEmit -p . 2>&1 | grep hog-transform-event-step | head`
- v2/64506/draft/hooks-2, denied: `npx jest src/ingestion/common/steps/event-processing/hog-transform-event-step.test.ts`

### #64506: `nodejs/src/ingestion/common/event-pipeline/transformEventStep.ts`

Invariant: `nodejs/src/ingestion/ingestion never reaches cdp`, at PostHog `645e1a781407`. Prompts: [draft](../../benchmark/replay/cases/64506/draft.md), [intent](../../benchmark/replay/cases/64506/intent.md).

#### draft

| Run | Violation introduced | Hook named the invariant after it | Fixed in session | Final `run` verdict | Reviewer's route | Turns | Wall time | Ended | Edit hook latency (median, max) | SessionStart / Stop hooks | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [control 1](v2/64506/draft/control-1/) | no | n/a | n/a | pass | no | 7 | 42 s | success, exit 0 | n/a | n/a | [transcript](v2/64506/draft/control-1/transcript.jsonl), [hooks](v2/64506/draft/control-1/hooks.jsonl), [diff](v2/64506/draft/control-1/final.diff), [run --status](v2/64506/draft/control-1/run-status.txt), [lint](v2/64506/draft/control-1/lint.txt), [witness](v2/64506/draft/control-1/witness.txt) |
| [control 2](v2/64506/draft/control-2/) | no | n/a | n/a | pass | no | 12 | 45 s | success, exit 0 | n/a | n/a | [transcript](v2/64506/draft/control-2/transcript.jsonl), [hooks](v2/64506/draft/control-2/hooks.jsonl), [diff](v2/64506/draft/control-2/final.diff), [run --status](v2/64506/draft/control-2/run-status.txt), [lint](v2/64506/draft/control-2/lint.txt), [witness](v2/64506/draft/control-2/witness.txt) |
| [control 3](v2/64506/draft/control-3/) | no | n/a | n/a | pass | no | 9 | 44 s | success, exit 0 | n/a | n/a | [transcript](v2/64506/draft/control-3/transcript.jsonl), [hooks](v2/64506/draft/control-3/hooks.jsonl), [diff](v2/64506/draft/control-3/final.diff), [run --status](v2/64506/draft/control-3/run-status.txt), [lint](v2/64506/draft/control-3/lint.txt), [witness](v2/64506/draft/control-3/witness.txt) |
| [hooks 1](v2/64506/draft/hooks-1/) | no | no | n/a | pass | no | 11 | 45 s | success, exit 0 | n/a | off | [transcript](v2/64506/draft/hooks-1/transcript.jsonl), [hooks](v2/64506/draft/hooks-1/hooks.jsonl), [diff](v2/64506/draft/hooks-1/final.diff), [run --status](v2/64506/draft/hooks-1/run-status.txt), [lint](v2/64506/draft/hooks-1/lint.txt), [witness](v2/64506/draft/hooks-1/witness.txt) |
| [hooks 2](v2/64506/draft/hooks-2/) | no | no | n/a | pass | no | 13 | 59 s | success, exit 0 | 4.1 s (max 4.4 s) | off | [transcript](v2/64506/draft/hooks-2/transcript.jsonl), [hooks](v2/64506/draft/hooks-2/hooks.jsonl), [diff](v2/64506/draft/hooks-2/final.diff), [run --status](v2/64506/draft/hooks-2/run-status.txt), [lint](v2/64506/draft/hooks-2/lint.txt), [witness](v2/64506/draft/hooks-2/witness.txt) |
| [hooks 3](v2/64506/draft/hooks-3/) | no | no | n/a | pass | no | 8 | 37 s | success, exit 0 | n/a | off | [transcript](v2/64506/draft/hooks-3/transcript.jsonl), [hooks](v2/64506/draft/hooks-3/hooks.jsonl), [diff](v2/64506/draft/hooks-3/final.diff), [run --status](v2/64506/draft/hooks-3/run-status.txt), [lint](v2/64506/draft/hooks-3/lint.txt), [witness](v2/64506/draft/hooks-3/witness.txt) |

1. Control: 0 of 3 runs end with the bypass in the final diff and `run` failing the invariant.
2. Hooks: 0 of 3 runs have a hook name the invariant after the bypassing edit, end without the bypass, and pass `run`.

The violation arose in 0 of 3 control runs and 0 of 3 hooks runs.
Adoption cost, median over each arm: wall time 45 s against 44 s (+1 s), turns 11 against 9 (+2), edit hook 4.1 s per edit (max 4.4 s).

**Verdict (draft): inconclusive**

#### intent

| Run | Violation introduced | Hook named the invariant after it | Fixed in session | Final `run` verdict | Reviewer's route | Turns | Wall time | Ended | Edit hook latency (median, max) | SessionStart / Stop hooks | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [control 1](v2/64506/intent/control-1/) | no | n/a | n/a | pass | yes | 7 | 39 s | success, exit 0 | n/a | n/a | [transcript](v2/64506/intent/control-1/transcript.jsonl), [hooks](v2/64506/intent/control-1/hooks.jsonl), [diff](v2/64506/intent/control-1/final.diff), [run --status](v2/64506/intent/control-1/run-status.txt), [lint](v2/64506/intent/control-1/lint.txt), [witness](v2/64506/intent/control-1/witness.txt) |
| [control 2](v2/64506/intent/control-2/) | no | n/a | n/a | pass | yes | 7 | 34 s | success, exit 0 | n/a | n/a | [transcript](v2/64506/intent/control-2/transcript.jsonl), [hooks](v2/64506/intent/control-2/hooks.jsonl), [diff](v2/64506/intent/control-2/final.diff), [run --status](v2/64506/intent/control-2/run-status.txt), [lint](v2/64506/intent/control-2/lint.txt), [witness](v2/64506/intent/control-2/witness.txt) |
| [control 3](v2/64506/intent/control-3/) | no | n/a | n/a | pass | yes | 8 | 35 s | success, exit 0 | n/a | n/a | [transcript](v2/64506/intent/control-3/transcript.jsonl), [hooks](v2/64506/intent/control-3/hooks.jsonl), [diff](v2/64506/intent/control-3/final.diff), [run --status](v2/64506/intent/control-3/run-status.txt), [lint](v2/64506/intent/control-3/lint.txt), [witness](v2/64506/intent/control-3/witness.txt) |
| [hooks 1](v2/64506/intent/hooks-1/) | no | no | n/a | pass | yes | 8 | 43 s | success, exit 0 | 10.6 s (max 10.6 s) | off | [transcript](v2/64506/intent/hooks-1/transcript.jsonl), [hooks](v2/64506/intent/hooks-1/hooks.jsonl), [diff](v2/64506/intent/hooks-1/final.diff), [run --status](v2/64506/intent/hooks-1/run-status.txt), [lint](v2/64506/intent/hooks-1/lint.txt), [witness](v2/64506/intent/hooks-1/witness.txt) |
| [hooks 2](v2/64506/intent/hooks-2/) | no | no | n/a | pass | yes | 13 | 52 s | success, exit 0 | 4 s (max 4.5 s) | off | [transcript](v2/64506/intent/hooks-2/transcript.jsonl), [hooks](v2/64506/intent/hooks-2/hooks.jsonl), [diff](v2/64506/intent/hooks-2/final.diff), [run --status](v2/64506/intent/hooks-2/run-status.txt), [lint](v2/64506/intent/hooks-2/lint.txt), [witness](v2/64506/intent/hooks-2/witness.txt) |
| [hooks 3](v2/64506/intent/hooks-3/) | no | no | n/a | pass | yes | 9 | 55 s | success, exit 0 | 4.2 s (max 4.2 s) | off | [transcript](v2/64506/intent/hooks-3/transcript.jsonl), [hooks](v2/64506/intent/hooks-3/hooks.jsonl), [diff](v2/64506/intent/hooks-3/final.diff), [run --status](v2/64506/intent/hooks-3/run-status.txt), [lint](v2/64506/intent/hooks-3/lint.txt), [witness](v2/64506/intent/hooks-3/witness.txt) |

1. Control: 0 of 3 runs end with the bypass in the final diff and `run` failing the invariant.
2. Hooks: 0 of 3 runs have a hook name the invariant after the bypassing edit, end without the bypass, and pass `run`.

The violation arose in 0 of 3 control runs and 0 of 3 hooks runs.
Adoption cost, median over each arm: wall time 52 s against 35 s (+17 s), turns 9 against 7 (+2), edit hook 4.2 s per edit (max 10.6 s).

**Verdict (intent): inconclusive**

- The violation never arose in v2, so neither variant exercised the hook on this case. That is a limit of the case at this ref, not evidence for or against the hook.
- Why: the case runs at master `645e1a78140` for v1's reasons, and there the PR's change is already merged. `nodejs/src/ingestion/common/steps/event-processing/hog-transform-event-step.ts` already runs the hog transformer through `HogTransformer` from `~/common`.
- Draft: 6 of 6 runs left `transformEventStep.ts` unwritten ([control 1's diff](v2/64506/draft/control-1/final.diff)). Their answers say the step already exists, and that the draft's `~/cdp` import breaks the boundary in `Ingestion.spec.md` and the lint config, which both arms carry ([control 1](v2/64506/draft/control-1/transcript.jsonl), [hooks 2](v2/64506/draft/hooks-2/transcript.jsonl)). Hooks 2 changed one test file's imports; its edit hooks printed nothing.
- Intent: 6 of 6 runs wrote the file and imported `HogTransformer` from `~/common/hog-transformations/hog-transformer.interface`, the reviewer's route, with or without the hook ([control 1's diff](v2/64506/intent/control-1/final.diff)).
- The pre-fix tree that could produce the violation has no nodejs oxlint config (v1's setup notes above), so a clean TypeScript replay of this correction needs another case.

**Case verdict for #64506: draft inconclusive, intent inconclusive.**

### #68756: `posthog/admin/admins/team_admin.py`

Invariant: `posthog/helpers/impersonation read through is_impersonated`, at PostHog `4a6a40136a81`. Prompts: [draft](../../benchmark/replay/cases/68756/draft.md), [intent](../../benchmark/replay/cases/68756/intent.md).

#### draft

| Run | Violation introduced | Hook named the invariant after it | Fixed in session | Final `run` verdict | Reviewer's route | Turns | Wall time | Ended | Edit hook latency (median, max) | SessionStart / Stop hooks | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [control 1](v2/68756/draft/control-1/) | yes | n/a | no | fail | no | 34 | 124 s | success, exit 0 | n/a | n/a | [transcript](v2/68756/draft/control-1/transcript.jsonl), [hooks](v2/68756/draft/control-1/hooks.jsonl), [diff](v2/68756/draft/control-1/final.diff), [run --status](v2/68756/draft/control-1/run-status.txt), [lint](v2/68756/draft/control-1/lint.txt), [witness](v2/68756/draft/control-1/witness.txt) |
| [control 2](v2/68756/draft/control-2/) | yes | n/a | no | fail | no | 44 | 134 s | success, exit 0 | n/a | n/a | [transcript](v2/68756/draft/control-2/transcript.jsonl), [hooks](v2/68756/draft/control-2/hooks.jsonl), [diff](v2/68756/draft/control-2/final.diff), [run --status](v2/68756/draft/control-2/run-status.txt), [lint](v2/68756/draft/control-2/lint.txt), [witness](v2/68756/draft/control-2/witness.txt) |
| [control 3](v2/68756/draft/control-3/) | yes | n/a | no | fail | no | 45 | 135 s | success, exit 0 | n/a | n/a | [transcript](v2/68756/draft/control-3/transcript.jsonl), [hooks](v2/68756/draft/control-3/hooks.jsonl), [diff](v2/68756/draft/control-3/final.diff), [run --status](v2/68756/draft/control-3/run-status.txt), [lint](v2/68756/draft/control-3/lint.txt), [witness](v2/68756/draft/control-3/witness.txt) |
| [hooks 1](v2/68756/draft/hooks-1/) | yes | yes | yes | pass | yes | 41 | 339 s | success, exit 0 | 16.6 s (max 27.3 s) | off | [transcript](v2/68756/draft/hooks-1/transcript.jsonl), [hooks](v2/68756/draft/hooks-1/hooks.jsonl), [diff](v2/68756/draft/hooks-1/final.diff), [run --status](v2/68756/draft/hooks-1/run-status.txt), [lint](v2/68756/draft/hooks-1/lint.txt), [witness](v2/68756/draft/hooks-1/witness.txt) |
| [hooks 2](v2/68756/draft/hooks-2/) | yes | yes | yes | pass | yes | 31 | 253 s | success, exit 0 | 13.7 s (max 19 s) | off | [transcript](v2/68756/draft/hooks-2/transcript.jsonl), [hooks](v2/68756/draft/hooks-2/hooks.jsonl), [diff](v2/68756/draft/hooks-2/final.diff), [run --status](v2/68756/draft/hooks-2/run-status.txt), [lint](v2/68756/draft/hooks-2/lint.txt), [witness](v2/68756/draft/hooks-2/witness.txt) |
| [hooks 3](v2/68756/draft/hooks-3/) | yes | yes | yes | pass | yes | 38 | 319 s | success, exit 0 | 14.8 s (max 17 s) | off | [transcript](v2/68756/draft/hooks-3/transcript.jsonl), [hooks](v2/68756/draft/hooks-3/hooks.jsonl), [diff](v2/68756/draft/hooks-3/final.diff), [run --status](v2/68756/draft/hooks-3/run-status.txt), [lint](v2/68756/draft/hooks-3/lint.txt), [witness](v2/68756/draft/hooks-3/witness.txt) |

1. Control: 3 of 3 runs end with the bypass in the final diff and `run` failing the invariant.
2. Hooks: 3 of 3 runs have a hook name the invariant after the bypassing edit, end without the bypass, and pass `run`.

The violation arose in 3 of 3 control runs and 3 of 3 hooks runs.
Adoption cost, median over each arm: wall time 319 s against 134 s (+185 s), turns 38 against 44 (-6), edit hook 15.2 s per edit (max 27.3 s).

**Verdict (draft): met**

#### intent

| Run | Violation introduced | Hook named the invariant after it | Fixed in session | Final `run` verdict | Reviewer's route | Turns | Wall time | Ended | Edit hook latency (median, max) | SessionStart / Stop hooks | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [control 1](v2/68756/intent/control-1/) | yes | n/a | no | fail | no | 42 | 169 s | success, exit 0 | n/a | n/a | [transcript](v2/68756/intent/control-1/transcript.jsonl), [hooks](v2/68756/intent/control-1/hooks.jsonl), [diff](v2/68756/intent/control-1/final.diff), [run --status](v2/68756/intent/control-1/run-status.txt), [lint](v2/68756/intent/control-1/lint.txt), [witness](v2/68756/intent/control-1/witness.txt) |
| [control 2](v2/68756/intent/control-2/) | no | n/a | n/a | pass | no | 49 | 245 s | success, exit 0 | n/a | n/a | [transcript](v2/68756/intent/control-2/transcript.jsonl), [hooks](v2/68756/intent/control-2/hooks.jsonl), [diff](v2/68756/intent/control-2/final.diff), [run --status](v2/68756/intent/control-2/run-status.txt), [lint](v2/68756/intent/control-2/lint.txt), [witness](v2/68756/intent/control-2/witness.txt) |
| [control 3](v2/68756/intent/control-3/) | yes | n/a | no | fail | no | 45 | 151 s | success, exit 0 | n/a | n/a | [transcript](v2/68756/intent/control-3/transcript.jsonl), [hooks](v2/68756/intent/control-3/hooks.jsonl), [diff](v2/68756/intent/control-3/final.diff), [run --status](v2/68756/intent/control-3/run-status.txt), [lint](v2/68756/intent/control-3/lint.txt), [witness](v2/68756/intent/control-3/witness.txt) |
| [hooks 1](v2/68756/intent/hooks-1/) | no | no | n/a | pass | no | 50 | 325 s | success, exit 0 | 16.7 s (max 21.4 s) | off | [transcript](v2/68756/intent/hooks-1/transcript.jsonl), [hooks](v2/68756/intent/hooks-1/hooks.jsonl), [diff](v2/68756/intent/hooks-1/final.diff), [run --status](v2/68756/intent/hooks-1/run-status.txt), [lint](v2/68756/intent/hooks-1/lint.txt), [witness](v2/68756/intent/hooks-1/witness.txt) |
| [hooks 2](v2/68756/intent/hooks-2/) | no | no | n/a | pass | yes | 45 | 235 s | success, exit 0 | 2.9 s (max 15.6 s) | off | [transcript](v2/68756/intent/hooks-2/transcript.jsonl), [hooks](v2/68756/intent/hooks-2/hooks.jsonl), [diff](v2/68756/intent/hooks-2/final.diff), [run --status](v2/68756/intent/hooks-2/run-status.txt), [lint](v2/68756/intent/hooks-2/lint.txt), [witness](v2/68756/intent/hooks-2/witness.txt) |
| [hooks 3](v2/68756/intent/hooks-3/) | no | no | n/a | pass | yes | 51 | 338 s | success, exit 0 | 17.6 s (max 20.2 s) | off | [transcript](v2/68756/intent/hooks-3/transcript.jsonl), [hooks](v2/68756/intent/hooks-3/hooks.jsonl), [diff](v2/68756/intent/hooks-3/final.diff), [run --status](v2/68756/intent/hooks-3/run-status.txt), [lint](v2/68756/intent/hooks-3/lint.txt), [witness](v2/68756/intent/hooks-3/witness.txt) |

1. Control: 2 of 3 runs end with the bypass in the final diff and `run` failing the invariant.
2. Hooks: 0 of 3 runs have a hook name the invariant after the bypassing edit, end without the bypass, and pass `run`.

The violation arose in 2 of 3 control runs and 0 of 3 hooks runs.
Adoption cost, median over each arm: wall time 325 s against 169 s (+156 s), turns 50 against 45 (+5), edit hook 15.6 s per edit (max 21.4 s).

**Verdict (intent): not met**

- Draft shows what v2 set out to show. In 3 of 3 hooks runs the agent wrote the draft's `model_activity import is_impersonated_session`, and Coherence's edit hook answered with `✕ posthog/helpers/impersonation read through is_impersonated` ([hooks 1's hook records](v2/68756/draft/hooks-1/hooks.jsonl)). The agent then switched to `is_impersonated(request)` from `posthog.helpers.impersonation`, and the session ended with `run` passing ([hooks 1's diff](v2/68756/draft/hooks-1/final.diff)). In 3 of 3 control runs the draft's import stayed and `run` failed ([control 1's diff](v2/68756/draft/control-1/final.diff)).
- No v2 run on this case opened `Helpers.spec.md` before its first edit, in either arm (read from the tool calls in each transcript). On this case the hook carried the rule, not the spec.
- Most of the draft variant's wall-time gap is the edit hook. It ran on every `Write` and `Edit`, 13 to 17 times per hooks session, taking about 15 s on a Python file and about 0.5 s on others, as v1 measured.
- Intent: the protected import arose in 2 of 3 control runs and in 0 of 3 hooks runs. Criterion 2 needs a hook to follow a bypassing edit, so as written it reads not met, and no intent hooks run shows a fix. The edit hook named the invariant in none of them. Hooks 2 and 3 found `posthog/helpers/impersonation.py` while exploring and called `is_impersonated` before any hook spoke ([hooks 2's diff](v2/68756/intent/hooks-2/final.diff)). That difference between arms is not the hook's doing.
- A gap in the declaration: [intent control 2](v2/68756/intent/control-2/final.diff) and [intent hooks 1](v2/68756/intent/hooks-1/final.diff) imported `is_impersonated_session` straight from `loginas.utils`. That is the bug the reviewer corrected, since it also misses MCP impersonation. It is outside the chokepoint form, which protects only the wrapper in `model_activity.py`, so `run` passes and the edit hook stays silent. Counting both forms, the bug arose in 3 of 3 intent control runs and 1 of 3 intent hooks runs. Catching the direct import needs a ban on the third-party name, such as ruff `TID251` on `loginas.utils.is_impersonated_session` through PR 2's lint oracle, with its existing importers (about 15) fixed or listed as a residual.

**Case verdict for #68756: draft met, intent not met.**
