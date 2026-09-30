# How agents consume lint feedback mid-build, and what an MCP adds over a file

Ticket: [#108](https://github.com/Silthus/uml-pr-review/issues/108), part of map [#105](https://github.com/Silthus/uml-pr-review/issues/105).
Researched 2026-09-30 with Claude Code 2.1.285, `claude-opus-5-5`, ESLint 9, and PostHog `master` as checked out at `~/posthog`.

## Findings

1. **A `PostToolUse` hook on `Edit|Write` that lints the edited file works, and the agent fixes the violation in the same session.** Verified on this box with headless `claude -p --model claude-opus-5-5`. The model got the lint message, rewrote the import to the facade, re-linted clean, and told the user why it departed from the code it was given. That took 4 turns and about 11 s end to end. Without the hook, the violation shipped.
2. **Three output channels reach the model; one does not.**
   - Exit 2 with the message on stderr reaches it.
   - JSON `{"decision":"block","reason":…}` on stdout reaches it.
   - JSON `hookSpecificOutput.additionalContext` reaches it.
   - Exit 1 (or any code other than 0 and 2) with stdout does **not** reach it. The violation stayed.
3. **Latency is small.** Full ESLint with the `typescript-eslint` parser on one file took 0.50–0.87 s per hook run, cold, with no daemon. PostHog's oxlint takes about 0.2 s per file with the real 404-line `.oxlintrc.json`.
4. **PostHog lints TypeScript with oxlint, not ESLint.** The frontend and `products/` have no ESLint config. `lint-staged` runs `hogli format:js`, which is `oxlint --fix` plus `oxfmt`, on staged files. CI runs `pnpm exec oxlint --quiet`. oxlint loads ESLint-compatible JS plugins through `jsPlugins`, and PostHog already uses that in `nodejs/.oxlintrc.nodejs.json`. So "an ESLint plugin" should mean an ESLint-API plugin that is loaded through oxlint `jsPlugins` in PostHog.
5. **PostHog's `AGENTS.md` bans `PostToolUse` hooks in the repo.** It says Claude Code hooks "are reserved for environment bootstrapping (`SessionStart` only)", because the others "add latency and are fragile". Pre-commit warns on any change under `.claude/hooks/`. A mid-build hook therefore cannot land in PostHog's shared `.claude/settings.json` without changing that policy. It has to be opt-in per engineer, through a user-scope plugin. That is a decision for Michael.
6. **An MCP adds nothing to the write-time loop.** The manifest, the lint rule, the hook, and the skill are all files. They get discovered, reviewed, and versioned with the code they govern. The PostHog MCP genuinely adds value in one place: reading past review corrections through `review-hog-reviews-*`, `pull-requests`, and `pr-lifecycle` while the definition skill writes the manifest. Telemetry does not need an MCP either. The hook can post an event itself.
7. **Recommendation for the first slice: no MCP.** Ship the manifest in the repo, a lint rule loaded by the repo's own linter, and one Claude Code plugin that bundles the `PostToolUse` hook and the definition skill. Keep the PostHog MCP as an optional input to the definition skill in a later slice.

## The experiment

The minimal files are committed next to this doc, under [`agent-lint-feedback/`](agent-lint-feedback/).

| File | Purpose |
| --- | --- |
| [`eslint.config.mjs`](agent-lint-feedback/eslint.config.mjs) | A `no-restricted-imports` pattern on `**/billing/internal/**`, with a message that names the facade. |
| [`src/`](agent-lint-feedback/src/) | A billing internal module, a billing facade, and a workflows type. |
| [`.claude/settings.json`](agent-lint-feedback/.claude/settings.json) | The project hook. |
| [`.claude/hooks/lint-edited-file.sh`](agent-lint-feedback/.claude/hooks/lint-edited-file.sh) | The hook script. `LINT_HOOK_MODE` selects the output channel, and every run's latency goes to `latency.log`. |
| [`run-experiment.sh`](agent-lint-feedback/run-experiment.sh) | Copies the project to `/tmp/lint-hook-exp/<mode>`, runs `bun install`, runs headless Claude, and prints the result. |
| [`show-feedback.sh`](agent-lint-feedback/show-feedback.sh) | Summarises a stream-json transcript. |
| [`evidence/`](agent-lint-feedback/evidence/) | Trimmed transcripts and the hook attachments from the session logs. |

### The hook that worked

`.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/lint-edited-file.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

The core of the script, in the recommended exit-2 channel:

```bash
file_path=$(jq -r '.tool_input.file_path // empty')
case "$file_path" in *.ts | *.tsx | *.js | *.mjs) ;; *) exit 0 ;; esac
cd "$CLAUDE_PROJECT_DIR"
lint_output=$(./node_modules/.bin/eslint --no-warn-ignored --format stylish "$file_path" 2>&1) && exit 0
echo "ESLint found violations in $file_path. Fix them before continuing:
$lint_output" >&2
exit 2
```

The runs below used the matcher `Edit|Write|MultiEdit`. `MultiEdit` is not in the current docs or in this Claude Code build's tool list, so the committed matcher is `Edit|Write`. The rerun of `exit2` used that committed matcher and behaved the same.

### The task

```
claude -p "<task>" --model claude-opus-5-5 --permission-mode acceptEdits \
  --setting-sources project --output-format stream-json --verbose --include-hook-events
```

The task tells the agent to create `src/products/workflows/cost.ts` with given content. That content imports `calculatePrice` from `../billing/internal/pricing`.

Dictating the code was necessary. In a first, open-ended attempt ("price the run with `calculatePrice` from `…/internal/pricing.ts`"), the agent ran `cat eslint.config.mjs` before it wrote anything. It then imported from the facade on its own, so the hook had nothing to catch. That is a real effect: with a small, readable config and an instructive message, Opus complies up front. PostHog's config is 404 lines, and the agent will not read it for every edit, so the hook is the dependable path.

### Results

| Mode | Hook output | How the session log records it | Model saw it | Violation fixed | Hook runs (ms) | Session |
| --- | --- | --- | --- | --- | --- | --- |
| `none` (no hook) | none | none | no | **no** | none | 5.3 s, 2 turns |
| `exit2` | stderr, exit 2 | `hook_blocking_error` | yes | **yes** | 520, 501 | 11.6 s, 4 turns |
| `block` | stdout `{"decision":"block","reason":…}`, exit 0 | `hook_blocking_error` | yes | **yes** | 736, 511 | 11.4 s, 4 turns |
| `context` | stdout `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":…}}`, exit 0 | `hook_success` + `hook_additional_context` | yes | **yes** | 743, 514 | 11.4 s, 4 turns |
| `stdout` | stdout, exit 1 | `hook_non_blocking_error` | **no** | **no** | 737 | 6.2 s, 2 turns |
| `exit2` rerun, `Edit\|Write` | stderr, exit 2 | `hook_blocking_error`, also emitted as stream-json `hook_response` | yes | **yes** | 527, 508 | 10.6 s, 4 turns |

**How the evidence was read.** The session JSONL under `~/.claude/projects/<cwd>/` stores what the harness injected, as `attachment` records. Those records are in [`evidence/hook-attachments.jsonl`](agent-lint-feedback/evidence/hook-attachments.jsonl). Plain stream-json does **not** show hook output. It only shows the model's reaction, for example "The lint hook rejected the billing-internal import." Hook output appears in stream-json only with `--include-hook-events`, as `system` records with subtype `hook_started` and `hook_response`. A replay harness should pass that flag; see [`evidence/stream-exit2.jsonl`](agent-lint-feedback/evidence/stream-exit2.jsonl).

**The model's behaviour after feedback.** In all three working modes the agent did the same four things:

- read the facade;
- changed only the import, with `Edit`;
- got a clean second hook run;
- ended with a sentence telling the user that it deviated from the dictated code, and why.

The lint message beat an explicit user instruction. That is the behaviour we want for architecture rules. It also means the rule message has to be right, because the agent trusts it over the user.

**Which channel to use.** Exit 2 with stderr is the simplest. It is plain text, needs no `jq` or JSON on the way out, and Codex supports the same contract. `additionalContext` is semantically cleaner, since it is context rather than an error, and it is capped at 10,000 characters; above that, the model gets a file path and a 2,000-character preview. Pick exit 2 for the first slice.

## Semantics from the docs

Every item below is from the [hooks reference](https://code.claude.com/docs/en/hooks). The experiment above confirmed the channel behaviour directly.

**Exit codes**
- Exit 0: stderr "goes to the debug log only, never the transcript, and Claude never sees it."
- Exit 2 on `PostToolUse`: the event table says "Shows stderr to Claude; the tool already ran". The edit is not undone; the agent is expected to fix it.
- Any other code is a non-blocking error. The model does not see it; the experiment confirmed this.
- When stdout is valid JSON, the JSON alone decides the outcome and the exit code is ignored.

**JSON fields**
- `decision: "block"` "adds the `reason` next to the tool result."
- `hookSpecificOutput.additionalContext` is added "alongside the tool result" as a system reminder. It needs `hookEventName`. At the top level it is silently ignored ([hooks guide](https://code.claude.com/docs/en/hooks-guide)).
- `systemMessage` is shown to the user, not to the model.
- `continue: false` stops Claude entirely.

**Matcher and execution**
- `Edit|Write` matches those tool names exactly.
- The `if` field can narrow further, for example `"Edit(*.ts)"`.
- `PostToolUse` does not fire when a `Bash` command rewrites a file. The docs point to `FileChanged` for that case.
- The default command timeout is 600 s.
- All matching hooks run in parallel.
- `async: true` hooks cannot block. Their context arrives on the next turn, and in `-p` mode they are killed at teardown. Do not use async for this.

**Where hooks are installed**
- User, project, local, or managed `settings.json`.
- A plugin's `hooks/hooks.json`, with `${CLAUDE_PLUGIN_ROOT}` for script paths ([plugins reference](https://code.claude.com/docs/en/plugins-reference)).
- Skill frontmatter, where a hook lasts for the rest of the session after the skill is invoked.

**Trust**
- In an interactive session, all hooks are held back until the user accepts the workspace trust dialog.
- `-p` and SDK sessions treat the folder as trusted, so committed project hooks run without a prompt. The runs here, in never-trusted `/tmp` folders, confirm it.
- Managed `allowManagedHooksOnly` blocks every hook except those of force-enabled managed plugins.

### Codex and Cursor

- **Codex CLI** has hooks, enabled by default ([hooks](https://learn.chatgpt.com/docs/hooks)).
  - Config lives in `~/.codex/hooks.json`, `<repo>/.codex/hooks.json`, `config.toml` `[hooks]`, or a plugin's `hooks/hooks.json`.
  - `PostToolUse` matches `apply_patch` through `apply_patch`, `Edit`, or `Write`.
  - It supports exit 2 with stderr, `decision: "block"` (which replaces the tool result with the feedback), and `additionalContext`.
  - Non-managed hooks must be reviewed and trusted by hash before they run.
  - So the same script, pointed at `.codex/hooks.json`, should work. This was not run here.
- **Cursor** ([hooks](https://cursor.com/docs/agent/hooks)):
  - `postToolUse` with matcher `Write` can return `additional_context`, which is injected after the tool result.
  - `afterFileEdit` has no documented output back to the agent.
  - Its exit 2 blocks, "for compatibility" with Claude Code.
  - Cursor's agent also reads linter errors through a built-in `read_lints` tool. That tool is documented only in a [blog post](https://cursor.com/blog/codex-model-harness), not on a docs page.
  - None of this was run here.

## Editor and LSP

- **IDE diagnostics tool.** With the VS Code extension, Claude Code gets `mcp__ide__getDiagnostics`, which reads the Problems panel ([VS Code](https://code.claude.com/docs/en/vs-code)).
  - It is pull-only. The model has to decide to call it. The JetBrains docs say Claude Code "doesn't request diagnostics from the plugin on its own after edits" ([JetBrains](https://code.claude.com/docs/en/jetbrains)).
  - It needs a running IDE with the extension connected.
  - A headless `claude -p`, or a worktree agent with no IDE attached, has no such tool. That is inferred: the docs are silent, and the tool depends on the IDE's lock file.
  - Unreliable for agents.
- **LSP plugins push diagnostics.** A Claude Code plugin can declare an LSP server with `diagnostics: true`. "Each time Claude edits or writes a file the server handles, Claude gets the errors and warnings the server reports" ([code intelligence](https://code.claude.com/docs/en/plugins/code-intelligence)).
  - An ESLint or oxlint language server (PostHog's oxlint 1.72 has `oxlint --lsp`) would give the same push loop as the hook, with no shell script.
  - It was not tested here, and it is not started in cloud sessions.
  - PostHog's shared settings explicitly disable `typescript-lsp@claude-plugins-official`. That is a signal that LSP startup cost matters there.
  - It is a reasonable later alternative to the hook, not the first slice.

## Pre-commit and CI in PostHog

These were read in place at `~/posthog`, which was not modified.

- **Scripts.** `package.json` has `"lint:js": "oxlint --quiet"` and `"prepare": "husky install"`. The only ESLint configs are `nodejs/.eslintrc.js` and two vendored GitHub Actions.
- **Pre-commit.** `.husky/pre-commit` runs a few warn-only scripts, then `pnpm lint-staged`.
  - The `lint-staged` glob `{playwright,frontend,products,common,ee,services,docs}/**/*.{js,jsx,mjs,mts,ts,tsx}` runs `bin/hogli format:js`.
  - `hogli.yaml` defines that as `pnpm oxlint --fix --fix-suggestions --quiet … "$@" && pnpm exec oxfmt …`.
  - A new `no-restricted-imports`-style rule in `.oxlintrc.json` therefore fails the commit for staged files.
- **CI.** `.github/workflows/ci-frontend.yml` has a step "Lint with Oxlint" that runs `pnpm exec oxlint --quiet`.
- **Existing boundary rules.** `.oxlintrc.json` already uses `no-restricted-imports` with instructive messages, for example the toolbar's ban on `scenes/**`. That is the same shape the manifest rules would take.
- **Would a new rule reach agents?** Yes, but late.
  - At commit, the agent sees the lint-staged failure as `git commit` Bash output. Agents usually commit once, at the end of the build, after all the code is shaped around the violation.
  - In CI, the failure arrives minutes to tens of minutes after the push, and only if someone feeds it back.
  - Both are after-the-fact, compared with the sub-second in-session loop above.
- **Existing agent channels in PostHog.**
  - `.claude/rules/*.md` are path-scoped rule files, for example `product-isolation.md` scoped to `products/*/backend/**`.
  - `.agents/skills/` has 109 skills.
  - The `AGENTS.md` "Agent automation" order is: linters first, then lint-staged, then skills, then `AGENTS.md` text.
  - A manifest-driven lint rule fits that order. A `PostToolUse` hook is the one piece that conflicts with it.

## The MCP question

| Concern | Manifest file + skill + hook | MCP server (e.g. the PostHog MCP) |
| --- | --- | --- |
| Discovery | Automatic. The linter, the hook, and the skill are in the repo or the plugin, and the agent never has to ask. | The model has to choose to call a tool. Pull-based, like `getDiagnostics`. |
| Enforcement while building | The hook pushes violations after every edit. | None on its own. An MCP cannot observe edits. It would still need a hook, or an `mcp_tool` hook type that calls it. |
| Review of policy changes | Free. The manifest is a file, so changes are PRs with CODEOWNERS. | Lost, unless the server reads the file from the repo anyway. |
| Cross-repo or org policy | Per repo. PostHog is one monorepo, so this is enough. | Real value for many repos. Not our case. |
| Telemetry on violations and corrections | The hook can `curl` a PostHog capture event per violation and per clean re-lint. No MCP needed. | Possible, but it is the wrong direction: MCP is for the model reading or acting, not for the harness reporting. |
| Grounding the manifest in history | The skill can read `docs/corrections/corpus.jsonl` from this repo. | **Real value.** The PostHog MCP exposes `review-hog-reviews-list/get`, `pull-requests`, and `pr-lifecycle`, so the definition skill could pull a product's past review corrections live. |
| Install friction | Enable one plugin, once. | An MCP install plus OAuth per engineer. In interactive sessions, project `.mcp.json` servers wait for per-user approval. Plugins can bundle MCP servers, which start with no extra prompt ([MCP](https://code.claude.com/docs/en/mcp)). |

**Recommendation: MCP out of the first slice.** It adds nothing to the write-time loop and costs an auth step. Revisit it for the definition skill once the loop works. By then it would be an optional data source that the skill uses when the PostHog MCP is already connected, which it is for many PostHog engineers. It would not be a dependency.

## The minimal install

The engineer does one thing: **enable one Claude Code plugin at user scope**, for example `/plugin install coherence@<marketplace>`. The plugin bundles two things:

- `hooks/hooks.json`, with the `PostToolUse` `Edit|Write` hook above. Its script runs the repo's own linter, `oxlint` in PostHog, on the edited file only, and exits 2 with the violations.
- the definition skill.

The manifest and the lint rule land in PostHog through normal PRs. From then on, every agent session in that checkout gets violations within about a second of the edit, and lint-staged and CI remain the backstop for agents without the plugin.

The hook should be a no-op outside a repo that has a manifest. It should lint only the changed file, and it should stay silent on success, so that the latency and fragility objections in PostHog's `AGENTS.md` do not apply.

Whether PostHog would rather accept the hook in its shared `.claude/settings.json` through `enabledPlugins`, which is an allowed shared key, is a product question for Michael.

## What was verified and what was inferred

**Verified on this box:**
- the hook channels and their model visibility;
- same-session fixing;
- hook latency;
- that project hooks run under `-p` in an untrusted folder;
- PostHog's lint scripts, lint-staged, husky, CI step, oxlint timing, `jsPlugins` use, and `AGENTS.md` policy.

**From the docs only:**
- the Codex and Cursor behaviour;
- the IDE diagnostics and LSP behaviour;
- MCP approval rules.

**Inferred:**
- that `getDiagnostics` is unavailable headless;
- that a user-scope plugin hook behaves identically to the project hook tested here. It is the same hook engine, but that was not run.

**One run per mode.** Model behaviour can vary between runs, but all four runs that had a working channel behaved identically.
