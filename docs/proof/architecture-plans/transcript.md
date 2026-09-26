# PostHog end-to-end proof: architecture plans with a live agent

Spec #23 section 11, ticket #30. The recorded run took place on 2026-09-26 from 14:08 to 14:33 CEST, on `main` at `b00fa27` and against `~/dev/posthog` at `f637db96f1fc853ea6a83694f02b94ab690bdcaf`. The decisive checks were re-run on `main` at `7bb1705` and gave identical output ([Re-check on the merged main](#re-check-on-the-merged-main)).

**Who did what.**

- **The agent** is a real Claude Opus 5.5 session in headless Claude Code, talking to the server only over MCP.
- **The human role** (commenting on a seam, pressing **Lock plan** and **Final check**) was played by the proof agent, itself Claude Opus 5.5. It drove the real explorer with agent-browser against the same server. No person clicked anything. Each action is in [`step4-5-human-actions.txt`](step4-5-human-actions.txt), with the command exactly as run and its output.
- **The edits** in the scratch worktree (the violating import, the fix, and the placeholders) were also made by the proof agent, as the ticket asks.

## Result

| Step (spec §11) | Outcome | Evidence |
|---|---|---|
| 1. Baseline | `status --porcelain` empty, `HEAD` f637db9, 69 worktrees. Published as digests only (the worktree list names unrelated local branches) | [`step1-baseline-before.json`](step1-baseline-before.json) |
| 2. Scratch worktree | `/tmp/posthog-proof`, detached at `HEAD` | [`step2-worktree-add.txt`](step2-worktree-add.txt) |
| 3. Explorer | 16 top-level packages, and `products` expanded (the 12 largest of its 90 children, 86 of kind product; "show all" is broken, #41). `products/error_tracking` connections, light and dark. Cold 6.64 s, warm 1.01 s | `step3-*.png`, [`timings.txt`](timings.txt), [`payload-stats.txt`](payload-stats.txt) |
| 4. Live planning | The agent drafted the plan over MCP while the explorer followed. A comment on a seam reached the agent through `pendingHumanComments`; the agent changed the plan and replied | [`step4-live-planning.webm`](step4-live-planning.webm), `step4-*.png`, [`step4-agent-turn-1.txt`](step4-agent-turn-1.txt), [`step4-agent-turn-2.txt`](step4-agent-turn-2.txt), [`step4-5-human-actions.txt`](step4-5-human-actions.txt) |
| 5. Lock | Locked with the explorer's **Lock plan** button (revision 6, actor human) | `step5-plan-locked.png`, [`step4-5-human-actions.txt`](step4-5-human-actions.txt) |
| 6. Violation | `bypasses-seam` at `products/error_tracking/backend/logic/feature_flags.py:3`, with the fix through `products/feature_flags/backend/facade/api.py` | [`step6-violation.webm`](step6-violation.webm), `step6-*.png`, [`step6-check-plan-violating.txt`](step6-check-plan-violating.txt), [`step6-agent-turn-3.txt`](step6-agent-turn-3.txt) |
| 7. Fix | The fix, applied as worded, gave 0 violations. After the minimal planned edits, `final: true` returned `conforming` | [`step7-fix.webm`](step7-fix.webm), `step7-*.png`, [`step7-intermediate.diff`](step7-intermediate.diff), [`posthog-scratch.diff`](posthog-scratch.diff), `step7-check-plan-*.txt`, `step7-agent-turn-*.txt` |
| 8. Clean-up | Worktree removed and pruned, `<common dir>/uml-pr-review` removed, server stopped. All three baseline commands identical, with the loose-object caveat below | [`step8-cleanup.txt`](step8-cleanup.txt) |

The run exposed five explorer defects, filed as #41, #42, #43, #44, and #48 (see [Defects](#defects)).

## Setup

```sh
git -C ~/dev/posthog worktree add --detach /tmp/posthog-proof HEAD
NODE_ENV=production PORT=4633 bun run src/server.ts
```

The server ran from this repository's worktree on port 4633, not 4477, so that it would not collide with a server the user might have running. The agent reached it through a temporary MCP config, and the user's own Claude config was not touched:

```json
{"mcpServers":{"uml-pr-review":{"type":"http","url":"http://127.0.0.1:4633/mcp"}}}
```

### The agent

[`scripts/proof/run-agent.sh`](../../../scripts/proof/run-agent.sh) runs Claude Code 2.1.282 headless in `/tmp/posthog-proof`:

```sh
env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_MODEL … \
  claude -p [--resume <session>] --model claude-opus-5-5 --setting-sources local \
    --strict-mcp-config --mcp-config /tmp/wf30/mcp.json \
    --allowedTools "mcp__uml-pr-review__*" --output-format stream-json --verbose "<prompt>"
```

- **Model.** The gateway variables are unset and user settings are skipped. Each turn's `[init]` line shows `model claude-opus-5-5` and `mcp servers [uml-pr-review: connected]`. Each `[done]` line shows `modelUsage` with `claude-opus-5-5 (provider firstParty, …)` carrying all but $0.001 of the cost; `claude-haiku-4-5` is Claude Code's own housekeeping model. One session, `dfe35233-8979-4255-ac6f-28c55abc23a7`, ran all five turns, the later ones through `--resume`.
- **Project settings were skipped too** (`--setting-sources local`). PostHog's SessionStart hooks (flox, cloud setup, code signing) therefore did not run in the scratch worktree; the agent needs only MCP. As a side effect, no flox Go cache was downloaded, so the `chmod -R u+w` step had nothing to do.
- **Tools.** Only `mcp__uml-pr-review__*` was pre-approved. The agent also ran 8 read-only shell commands (`ls`, `grep`, `sed -n`: 7 in turn 1 and 1 in turn 2). Claude Code auto-approves read-only commands. Every `[done]` line shows `permission_denials 0`. The agent wrote no files.
- **What the model sees.** Claude Code hands the model each tool's `structuredContent` JSON, not the text block; that is the reason #36 added the `next` field. The turn files therefore show JSON results. The MCP **text** rendering of `check_plan` quoted below comes from [`scripts/proof/mcp-text.ts`](../../../scripts/proof/mcp-text.ts), which issued the identical call again right after the agent's call, on the same snapshot tree (the snapshot hashes match). These re-renders appear in the explorer's activity feed as `uml-pr-review-proof@1.0.0`.

Helpers in `scripts/proof/`:

- `run-agent.sh` runs the agent.
- `render-transcript.ts` renders a stream-json log. Results are cut at 700 characters, except `check_plan` and `get_plan`, which are shown verbatim.
- `shot.sh` takes the explorer screenshots with agent-browser at 1440×900.
- `mcp-text.ts` prints a tool's MCP text.
- `payload-stats.ts` counts modules in a saved payload.
- `baseline.ts` records and compares the three baseline commands as digests.
- `claude-register.sh` proves the README's registration command in a throwaway `HOME`.

| Turn | Prompt | Time | Claude turns | Session cost (cumulative) |
|---|---|---|---|---|
| 1 | "Plan, don't implement yet, how to show feature flag usage on error tracking issues. Use the uml-pr-review tools to explore and draft the architecture plan." | 14:17:09 to 14:19:04 (114 s) | 22 | $0.82 |
| 2 | "The human commented; read the plan and respond." | 14:20:06 to 14:20:35 (28 s) | 6 | $1.04 |
| 3 | "The human locked the plan, and implementation has started: products/error_tracking/backend/logic/feature_flags.py now exists in the working tree. Check the working tree against the plan with check_plan and tell me exactly what it found. Quote the check_plan text verbatim. Do not change any files." | 14:22:14 to 14:22:46 (31 s) | 2 | $1.21 |
| 4 | "The bypasses-seam fix has been applied as the finding worded it: feature_flags/backend/facade/api.py now offers get_flag_summaries_by_key and FlagSummary, and logic/feature_flags.py imports them from there. Run check_plan again and report the verdict and counts, quoting the first lines of the check_plan text. Do not change any files." | 14:25:08 to 14:25:21 (12 s) | 2 | $1.35 |
| 5 | "The remaining planned edits are in the working tree now (minimal placeholder versions of each planned change). Run check_plan with final: true and report the verdict and counts, quoting the first two lines of the check_plan result. Do not change any files." | 14:27:36 to 14:27:46 (9 s) | 2 | $1.42 |

## Step 1: baseline

`git -C ~/dev/posthog status --porcelain`, `rev-parse HEAD`, and `worktree list` were saved at 14:08. The repository is public, and the worktree list names unrelated local branches and paths, so only their digests are published ([`step1-baseline-before.json`](step1-baseline-before.json)): status 0 lines, `HEAD` 1 line (`f637db96f1fc853ea6a83694f02b94ab690bdcaf`), and worktree list 69 lines. [`scripts/proof/baseline.ts`](../../../scripts/proof/baseline.ts) computes the same digests by running the commands, and it exits non-zero when any differs.

## Step 2: scratch worktree

[`step2-worktree-add.txt`](step2-worktree-add.txt).

## Step 3: the explorer on PostHog

| | Light | Dark |
|---|---|---|
| Overview: 16 top-level packages, backbone edges | `step3-overview-light.png` | `step3-overview-dark.png` |
| `products` expanded: the 12 largest of its 90 children plus "+78 more" | `step3-products-expanded-light.png` | `step3-products-expanded-dark.png` |
| `products/error_tracking` connection lens: dependents on the left (blue), dependencies on the right (green) | `step3-error-tracking-connections-light.png` | `step3-error-tracking-connections-dark.png` |

`products` holds 90 child modules: 86 of kind `product`, 2 `package`, and 2 `directory` ([`payload-stats.txt`](payload-stats.txt)). No screenshot shows all 86 products at once, because the explorer's "+78 more · show all" cell does nothing when clicked ([`defect-show-all.txt`](defect-show-all.txt), #41).

Index times (`GET /api/architecture?path=/tmp/posthog-proof`, gzip, 2.5 MB; [`timings.txt`](timings.txt)):

- **Cold**: 6.64 s. The index cache had been moved aside and the server process was fresh: 39,028 blobs parsed, 0 cache hits, 41,535 files, 174,312 imports.
- **Warm cache, fresh process**: 1.01 s.
- **Same process**: 37 to 44 ms.
- **`POST /api/plans/:id/check` with `final: true`** on the finished worktree: 0.34 to 0.36 s (spec target: under 3 s).

## Step 4: live planning, recorded

Recording: [`step4-live-planning.webm`](step4-live-planning.webm) (6.1 MB, 4 min 38 s, 12 fps). The explorer was opened with no plan and "Follow agent" on. The recording covers turn 1, the comment, turn 2, and the lock.

**Turn 1** ([`step4-agent-turn-1.txt`](step4-agent-turn-1.txt)). The agent explored with `search_modules` ×2, `describe_module` ×3, `get_architecture_overview`, and `get_dependency_evidence` ×3, plus the read-only shell reads. It noted that "The Releases tab is a close template" and called `create_plan`. Its first `edit_plan` batch was rejected atomically:

```
Operation 15 (upsert_seam): A seam connects two separate modules; `products/error_tracking/frontend` contains `products/error_tracking/frontend/components/IssueFeatureFlags`.
Nothing was applied. Fix these problems and send the whole batch again with expectedRevision 1.
```

It resent the batch without that seam (revision 2). It then opened a question of its own on its seam as comment `c1` (revision 3): read flags from the `$feature/<key>` event properties, or join `flag_evaluations`. Screenshot: `step4-plan-drafted.png`. The draft routed flag enrichment from the query runner, `products/error_tracking/backend/hogql_queries -> products/feature_flags/backend/facade` via `facade/api.py` (symbols `get_flag_summaries_by_key`, `FlagSummary`).

**The comment.** In the explorer, the seam was selected in the plan panel (`step4-seam-selected.png`), the comment filled into its box (`step4-human-comment-typed.png`), and **Add comment** clicked (`step4-human-comment-posted.png`). The store recorded revision 4 as actor human with the explorer's note "Comment from the explorer":

> Keep the query runner free of other products. Put the flag enrichment in backend/logic, where issue business logic lives, and route logic -> feature_flags facade instead. Agree on event properties for v1.

Turn 1 had already ended, so the agent picked up the comment on its next plan tool call.

**Turn 2** ([`step4-agent-turn-2.txt`](step4-agent-turn-2.txt), `get_plan` result verbatim). The prompt was only "The human commented; read the plan and respond." The agent called `get_plan`, and the result carried the comment and the next step:

```
"pendingHumanComments":[{"id":"c2","target":{"kind":"seam","from":"products/error_tracking/backend/hogql_queries","to":"products/feature_flags/backend/facade"},"author":"human","body":"Keep the query runner free of other products. …","at":"2026-09-26T12:19:50.151Z","revision":4}]
"next":"First answer 1 human comment: resolve each with edit_plan resolve_comment and a reply, after changing the plan if the comment asks for it. The human changed the plan since your last edit; …"
```

It checked `backend/logic` with `describe_module` and `get_dependency_evidence`, then sent one `edit_plan` (revision 5). That batch:

- dropped the runner's seam;
- added `products/error_tracking/backend/logic -> products/feature_flags/backend/facade` via `facade/api.py`;
- added `hogql_queries -> logic` via `logic/feature_flags.py`;
- resolved both comments.

Its reply to the comment, verbatim from [`plan-final.json`](plan-final.json):

> Done. Enrichment now lives in backend/logic/feature_flags.py (resolve_issue_flags returns error-tracking-owned IssueFlagInfo), and logic→feature_flags facade is the only cross-product edge. The runner calls logic for enrichment, because core dispatch sends the query response through the runner. So hogql_queries now depends on logic (a new edge; it doesn't today) but imports no other product. Event properties stay the v1 source.

Follow agent moved the canvas to the new seam (`step4-agent-replied.png`). The explorer cannot show the reply, because it sits on the seam the plan just dropped (#43).

The plan as locked (revision 6) has 10 modules and 8 seams, in the spec's expected shape. It modifies `products/error_tracking/backend/facade` and `products/error_tracking/frontend`, and it adds seam `products/error_tracking/backend/logic -> products/feature_flags/backend/facade` through `products/feature_flags/backend/facade/api.py`. It also covers the schema, the query registration, the new `IssueFeatureFlags` component, and the Flags tab:

```
modify frontend/src/lib · frontend/src/queries/schema · posthog/hogql_queries · products/error_tracking/backend/facade
       products/error_tracking/backend/hogql_queries · products/error_tracking/backend/logic · products/error_tracking/frontend
       products/error_tracking/frontend/components/IssueFilterPreview · products/feature_flags/backend/facade
create products/error_tracking/frontend/components/IssueFeatureFlags
keep   posthog/hogql_queries -> products/error_tracking/backend/facade          via facade/queries.py
keep   products/error_tracking/backend/hogql_queries -> posthog/hogql            via query.py, parser.py, ast.py
add    products/error_tracking/backend/hogql_queries -> …/backend/logic          via logic/feature_flags.py (resolve_issue_flags, IssueFlagInfo)
add    products/error_tracking/backend/logic -> products/feature_flags/backend/facade  via facade/api.py (get_flag_summaries_by_key, FlagSummary)
add    IssueFeatureFlags -> frontend/src/queries/schema, -> frontend/src/scenes, -> IssueFilterPreview; IssueFilterPreview -> IssueFeatureFlags
```

## Step 5: lock

The **Lock plan** button in the explorer's plan panel was clicked (`agent-browser find role button click --name "Lock plan"`, 14:21 CEST; [`step4-5-human-actions.txt`](step4-5-human-actions.txt)). The panel then shows **Locked** and an **Unlock** button, and the activity feed shows "human locked the plan (revision 6)" (`step5-plan-locked.png`). The store recorded revision 6 at 12:21:21.867Z as actor human, kind lock, with no note.

A REST lock looks the same in the store. What rules out anything else: an MCP `set_plan_lock` is stored as actor agent with the quoted request as its note (#36), and no other REST client called the lock route during the run. In the recording, the click falls between frames and the panel jumps straight to Locked, so the action log is the evidence. The next plan tool result (turn 3) reported `"planStatus":"locked"` and `humanChanges: [{"number":6,"actor":"human","kind":"lock"}]`.

## Step 6: violation, recorded

Recording: [`step6-violation.webm`](step6-violation.webm) (2.0 MB).

`products/error_tracking/backend/logic/feature_flags.py` was created in the scratch worktree with the tempting shortcut straight to the model. Line 3 is a real top-level import:

```python
from dataclasses import dataclass

from products.feature_flags.backend.models import FeatureFlag


@dataclass(frozen=True)
class IssueFlagInfo:
    ...


def resolve_issue_flags(team_id: int, keys: list[str]) -> dict[str, IssueFlagInfo]:
    flags = FeatureFlag.objects.filter(team_id=team_id, key__in=keys)
    ...
```

The agent called `check_plan` in turn 3 and received the JSON result, which is verbatim in [`step6-agent-turn-3.txt`](step6-agent-turn-3.txt). Below is the MCP text rendering of the same call, re-issued with `mcp-text.ts` on the same snapshot `22cf8ed`. This is not the agent's own text. Only the first finding is shown here; all 16 are in [`step6-check-plan-violating.txt`](step6-check-plan-violating.txt).

```
Plan feature-flag-usage-on-error-tracking-iss-7c5c revision 6 (locked), progress check of /private/tmp/posthog-proof at snapshot 22cf8ed against base f637db9: violating.
1 violation, 15 pending, 0 warnings.

violation bypasses-seam products/error_tracking/backend/logic/feature_flags.py:3
  products/error_tracking/backend/logic/feature_flags.py:3 imports `products/feature_flags/backend/models/__init__.py` from `products/feature_flags/backend/models` directly, but the plan routes `products/error_tracking/backend/logic` to `products/feature_flags` through `products/feature_flags/backend/facade`.
  Fix: Import it through `products/feature_flags/backend/facade/api.py` (symbols get_flag_summaries_by_key, FlagSummary) instead. If that interface does not offer it yet, add it there first.
pending missing-module frontend/src/lib/KeaDevTools.tsx:1
…
```

The agent's summary quoted the same message and fix from the JSON. It added that `facade/api.py` does not offer `get_flag_summaries_by_key` yet, so that has to be added first.

Screenshots:

- `step6-violating-seam.png`: the seam `logic -> feature_flags/backend/facade` drawn in red, with its label "✗ add seam via api.py". The facade node shows "pending", the logic node "✓ conforming", and the plan panel chip "✗ violating · progress".
- `step6-violating-seam-finding.png`: the seam inspector with **Check ✗ violating** and the finding card. The card's long code spans run past the panel edge (#44).
- `step6-findings-list.png`: the plan's findings list, with the violation first.

The module `products/error_tracking/backend/logic` stays `conforming`, because the spec charges an import finding to its matched or nearest seam, not to the module.

## Step 7: fix, recorded

Recording: [`step7-fix.webm`](step7-fix.webm) (4.5 MB).

**The fix, applied exactly as worded.** The finding says two things, and each was done:

- "If that interface does not offer it yet, add it there first": `products/feature_flags/backend/facade/api.py` gained `FlagSummary` and `get_flag_summaries_by_key`, built on the `FeatureFlag` import it already had.
- "Import it through `products/feature_flags/backend/facade/api.py` (symbols get_flag_summaries_by_key, FlagSummary) instead": line 3 became `from products.feature_flags.backend.facade.api import FlagSummary, get_flag_summaries_by_key`.

`logic/feature_flags.py` changed beyond line 3, because the model it had queried was no longer imported. `resolve_issue_flags` now builds its result from `get_flag_summaries_by_key`, through a new helper `issue_flag_info`. The complete state that this check saw is [`step7-intermediate.diff`](step7-intermediate.diff): the facade addition, plus the violating-to-fixed diff of the logic file. It reproduces snapshot `5990cb0` exactly (see the re-check below).

The agent's next `check_plan` (turn 4, [`step7-agent-turn-4.txt`](step7-agent-turn-4.txt)) returned, as rendered by `mcp-text.ts` ([`step7-check-plan-after-fix.txt`](step7-check-plan-after-fix.txt)):

```
Plan feature-flag-usage-on-error-tracking-iss-7c5c revision 6 (locked), progress check of /private/tmp/posthog-proof at snapshot 5990cb0 against base f637db9: pending.
0 violations, 13 pending, 0 warnings.
```

The seam went from violating with 0 imports to conforming with 1 import (`step7-after-fix.png`, and the seam status in the turn-4 JSON).

**The minimal planned edits.** To reach `final: true`, the smallest edit the plan asks for was made in each remaining module. Several of them are **placeholders, not a working feature**:

- a feature flag constant;
- the schema types (`posthog/schema.py` was not regenerated);
- a registration branch in `get_query_runner`;
- a runner class that only calls `resolve_issue_flags`, with no ClickHouse query;
- the facade export;
- the frontend query builder;
- an `IssueFeatureFlagsPreview` that renders a list from props;
- a Flags tab that renders it with an empty list.

Nothing was type-checked, linted, or tested in PostHog. What these edits make real is the import structure the check verifies: every planned seam has a matching import through its interface files and symbols. The full final diff is [`posthog-scratch.diff`](posthog-scratch.diff).

The agent's final check (turn 5, [`step7-agent-turn-5.txt`](step7-agent-turn-5.txt)) returned the JSON verdict `conforming`, with all 10 modules and all 8 seams `conforming` and `"counts":{"violations":0,"pending":0,"warnings":0}`. Its MCP text as rendered by `mcp-text.ts` ([`step7-check-plan-final.txt`](step7-check-plan-final.txt)):

```
Plan feature-flag-usage-on-error-tracking-iss-7c5c revision 6 (locked), final check of /private/tmp/posthog-proof at snapshot cd88265 against base f637db9: conforming.
0 violations, 0 pending, 0 warnings.

The human changed the plan since your last edit:
Revision 6: locked.
Explorer: http://127.0.0.1:4633/?path=%2Fprivate%2Ftmp%2Fposthog-proof&plan=feature-flag-usage-on-error-tracking-iss-7c5c
Next: The human changed the plan since your last edit; build on their changes, not over them. The implementation conforms to the plan.
```

The agent said it itself: "This only confirms the dependency structure. Since these are placeholder versions of each change, it says nothing about whether the feature works."

**Final check** in the explorer then ran the same check over REST (`step7-final-conforming-light.png`, `step7-final-conforming-dark.png`). The plan panel chip reads "✓ conforming · final", every planned module's node on the canvas carries a ✓ conforming chip (context nodes carry none), and the visible part of the modules list is conforming. The seams list is below the fold; its statuses are in the turn-5 JSON.

## Step 8: clean-up and baseline

[`step8-cleanup.txt`](step8-cleanup.txt) lists every command and its output:

- server killed;
- worktree removed and pruned;
- `<common dir>/uml-pr-review` removed (plans, conformance results, index cache);
- `bun scripts/proof/baseline.ts` against the step-1 digests, which exits 0 with status, `HEAD`, and worktree list identical.

The plan file was copied to [`plan-file-on-disk.json`](plan-file-on-disk.json) before the directory was removed. The index cache that had been moved aside for the cold measurement was deleted too. Nothing was committed or pushed in PostHog.

**Caveat: loose objects.** Every check wrote the working tree's snapshot as loose tree and blob objects into PostHog's object store, for example trees `22cf8ed`, `5990cb0`, and `cd88265`. Nothing references them, so `git gc` prunes them once they are older than `gc.pruneExpire` (two weeks by default). The three baseline commands cannot see them.

## Re-check on the merged main

While the proof ran, #45 changed how conformance detects added imports: it now also counts names newly imported over an existing file pair. After rebasing onto `7bb1705`, the proof agent rebuilt the scratch worktree twice and restored the locked plan file each time. The first re-check covered the violating and final states. The second covered all three:

- the violating file alone;
- the intermediate fix ([`step7-intermediate.diff`](step7-intermediate.diff));
- the final diff ([`posthog-scratch.diff`](posthog-scratch.diff)).

Each state was checked with `mcp-text.ts`. The second re-check's outputs are committed as `recheck-7bb1705-*.txt`. They carry the same snapshot trees (`22cf8ed`, `5990cb0`, `cd88265`) and are byte-identical to the recorded `step6-`/`step7-check-plan-*.txt`, with the same SHA-256. The clean-up in [`step8-cleanup.txt`](step8-cleanup.txt) is the one after the last re-check.

Before merge, #47 landed on `main` (`b0008ee`). It changes only the explorer: live-state reconciliation, and an "Outdated check" chip for results that no longer match the open plan. The server, MCP, and conformance code the re-check ran is unchanged. The screenshots and recordings show the explorer as of `b00fa27`. None of the filed defects is addressed by #47. The gate in [`gate.txt`](gate.txt) ran on the final tree on top of `b0008ee`.

## README check

- [`readme-check.txt`](readme-check.txt): a fresh clone, `bun install`, `bun run start`, `/` and `/pulls` answering 200, and a headless Claude session calling `get_architecture_overview` on it.
- [`readme-claude-register.txt`](readme-claude-register.txt): the README's exact `claude mcp add --scope user …` command in a throwaway `HOME`. `claude mcp list` then shows `uml-pr-review … ✔ Connected`.
- [`readme-codex-exec.txt`](readme-codex-exec.txt): `codex exec -m gpt-6-astra` (codex-cli 0.157.0), with the README's two settings passed as `-c` overrides, so `~/.codex/config.toml` stayed untouched. It called `get_architecture_overview` and reported `scripts` and `src`. The `rmcp … AuthRequired … cloudflare` line in that log comes from another MCP server in the user's Codex config.
- [`readme-codex-exec-without-approval-setting.txt`](readme-codex-exec-without-approval-setting.txt): the same call succeeds without `default_tools_approval_mode` on this machine. Its Codex config has `approval_policy = "never"` and `sandbox_mode = "danger-full-access"`, so the README now says the setting prevents prompts, not that calls fail without it.
- [`readme-host-guard.txt`](readme-host-guard.txt): a foreign `Host` gets 403 on `/api/plans` and `/mcp`, and 200 on the static `/` and `/pulls`. The README says so.

## Defects

The scenario ran without a defect in the server, the MCP tools, the conformance engine, or the plan store. It exposed five defects in the explorer (#37). They are filed under map #15 and not fixed here: none is a one-line change, and `src/` is outside this ticket's write scope.

- #41: "+N more · show all" does nothing in the map, so `products` cannot show all 86 products.
- #42: plan focus is unreadable on this real 10-module plan. It draws 17 packages and 52 dependencies at the automatic fit, with labels well below 11 px (estimated from the screenshots).
- #43: a comment on a seam that the plan later drops, and the agent's reply to it, can no longer be seen in the explorer.
- #44: the plan picker says "No plan" for a plan adopted from a live event, and finding cards overflow the inspector.
- #48: the seam inspector runs interface file paths together ("urls.tsfrontend/src/scenes/teamLogic.tsx").

Two things were observed and kept as the spec defines them, not filed:

- `missing-module` anchors a modified module at its first production file, line 1. That can be an unrelated file, such as `frontend/src/lib/KeaDevTools.tsx:1`; the agent pointed this out itself. The message names the planned change, so the fix stays actionable.
- A violating import marks its seam violating, and the module keeps `conforming`.
