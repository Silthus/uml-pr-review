# Benchmark tasks

Each `<pr>.json` is one task for the architecture benchmark in [#61](https://github.com/Silthus/uml-pr-review/issues/61): one of Michael's PostHog pull requests whose authoring agent session is on this machine. The replay arms start from `baseCommit` and get `taskStatement`. Arm A is the historical pull request; its diff is defined under Fields.

A task qualifies when its pull request changes 2 to 30 files, touches at least two modules, and has a local authoring session with a clear statement of what to build.

A task comes from one of two sources, named in `session.source`:

- A **T3 thread** where Michael asked the agent for the change. The statement is his messages.
- A **wayfinder ticket** (`"wayfinder-ticket"`) that a worker resolved on map [Silthus/posthog#68](https://github.com/Silthus/posthog/issues/68). The statement is what the worker received: the ticket body plus the requirement-carrying parts of the conductor's dispatch prompt. Whether a human or an agent wrote it does not matter for a replay; it is the input the original agent got.

## Fields

- `baseCommit`: where a replay starts. It is the parent of the pull request's first own commit, when the PR's commits still sit on it (the T3 tasks). When the branch was rebased after the author ran (the wayfinder tasks), that parent postdates the task, so `baseCommit` is the commit the worker branched from, read from the worktree reflog. `notes` gives the history, including where the session started when that differs.
- `baseCheck`: the result of `git diff --stat <baseCommit> <finalHead>` against the PR's `changedFiles`. When they differ, `explanation` says why (master merged in, or a rebase), and wayfinder tasks also record `prFirstOwnCommitParent`.
- **Arm A's diff** is `diffStat.final.base..finalHead`, or `sessionAnswerDiff` when present. Never diff `baseCommit..finalHead` for a task whose `baseCheck.matches` is false: it pulls in upstream changes.
- `finalHead`: the pull request head. `diffStat.final` is `merge-base(baseRefOid, finalHead)..finalHead`, which matches the pull request's diff on GitHub.
- `firstPushHead`: the first head pushed to the branch, from the push output in the transcript, the worktree reflog and the GitHub timeline. `diffStat.firstPush` is `diffStat.firstPush.base..firstPushHead`, the author's own commits on top of the tree they worked on.
- `taskStatement`: verbatim input, in order.
  - T3 tasks: Michael's feature-defining messages, joined with a blank line. When only part of a message is kept, each excerpt is an exact substring of the message, and excerpts from one message are joined with a newline. `taskStatementSources` lists the T3 message ids and excerpts, so every statement can be checked against `projection_thread_messages` in `~/.t3/userdata/state.sqlite`.
  - Wayfinder tasks: the whole ticket body as it stood at dispatch, then the kept excerpts of the dispatch prompt, each joined with a blank line. `taskStatementSources` names the ticket and the worker transcript. `dispatchPrompt` holds the whole dispatch prompt verbatim.
  - `taskStatementNotes` says what was kept and dropped, and why.
- `attachments`: the images the kept messages reference, under `~/.t3/userdata/attachments`. `imageTokens` maps each `t3-context://v1/image/...` token in the statement to its file, so a runner can substitute the image.
- `sessionAnswerDiff`: present when the pull request holds more or less than the statement asked for (split across PRs, restacked, or grown by later sessions). It is a single-base view of the original agent's answer; score Arm A against it.
- Optional fields: `taskContext` (facts a replay needs that are not in the statement, such as a docs URL in another repository), `companionPrs`, `landedAs` (the same change merged under another PR), and `otherCommits`.
- `diffStat.*.modules`: a file's module is its first three path segments. A file with three or fewer segments counts as its directory (`posthog/scopes.py` is `posthog`, `products/workflows/CONTRIBUTING.md` is `products/workflows`), and a root file counts as its own name (`tach.toml`). Renames count both paths.

## Replay safety

Statements are verbatim, so they still carry the original ship instructions: ticket bodies say to push a branch and open a draft PR on `PostHog/posthog`, and some T3 messages ask for screenshots or PRs. The runner must tell the arms not to commit or open a PR, and must block `git push` and `gh` writes to real remotes.

Every commit named in a manifest resolves in `~/dev/posthog` (`git cat-file -e`).

## Tasks

| PR | Title | Files | Modules | Base | Source | Why |
|---|---|---|---|---|---|---|
| [#103523](https://github.com/PostHog/posthog/pull/103523) | feat(ai): let the agent search and list workflows (merged) | 6 | `ee/hogai/context`, `ee/hogai/tools`, `products/workflows/backend`, `tach.toml` | `cea129a` | T3 "Add workflows quick entry point", claude-fable-5-1 | The AI agent reaches into the workflows product; the first commit bypassed the workflows facade and was fixed in `335c502`. Caveat: the statement asks for a home-screen button and prompts; extending the agent was the agent's proposal, which Michael approved. Score Arm A against `sessionAnswerDiff`, which also holds the button (companion [#103522](https://github.com/PostHog/posthog/pull/103522)). |
| [#103533](https://github.com/PostHog/posthog/pull/103533) | feat(workflows): link the sending allowance card to the tier docs (closed) | 6 | `products/workflows/backend`, `products/workflows/frontend`, `services/mcp/src` | `cea129a` | T3 "Document sending allowance tiers", claude-fable-5-1 | A full-stack slice: backend serializer, generated API types and MCP client, and a popover card in the UI. |
| [#102897](https://github.com/PostHog/posthog/pull/102897) | fix(workflows): let the email preview fill the step panel (closed) | 5 | `frontend/src/lib`, `frontend/src/scenes`, `products/workflows/frontend` | `3b30c93` | T3 "Expand Workflow Email Preview", claude-fable-5-1 | A layout fix that spans a shared component, the email templater, and the workflows panel. Score against `sessionAnswerDiff` (`08049e6`, 6 files); the PR's last commit removed a story after a CI follow-up. |
| [#103849](https://github.com/PostHog/posthog/pull/103849) | feat(workflows): give a workflow a key and filter the list on it (open) | 16 | `products/workflows/backend`, `products/workflows/frontend`, `services/mcp/src`, `services/mcp/tests` | `c8357af` | Wayfinder ticket [#91](https://github.com/Silthus/posthog/issues/91), worker `wf68-91-implement`, claude-opus-5 | A backend change that flows into generated frontend and MCP clients, with validation placed per the feature flag precedent. Score against `sessionAnswerDiff` (the worker's first push, 11 files); conductor review fixes and later review rounds grew the PR. |
| [#103729](https://github.com/PostHog/posthog/pull/103729) | chore(error-tracking): share the git link composer across the frontend (merged) | 6 | `frontend/src/lib`, `products/error_tracking/frontend` | `c8357af` | Wayfinder ticket [#89](https://github.com/Silthus/posthog/issues/89), worker `wf68-89-implement`, claude-opus-5 | A pure move out of a product into shared code, with every importer updated and no re-export shim. |
| [#103843](https://github.com/PostHog/posthog/pull/103843) | feat(workflows): add the @posthog/workflows package and its SDK (closed) | 20 | `frontend`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `products/workflows/packages` | `c8357af` | Wayfinder ticket [#92](https://github.com/Silthus/posthog/issues/92), worker `wf68-92-implement`, claude-opus-5 | A new package inside a product, placed per `products/architecture.md` and emitting what the existing serializer accepts. Score against `sessionAnswerDiff` (the worker's own commit `1d9a8a9`, 18 files); conductor review fixes and later sessions grew the PR. |
| [#104202](https://github.com/PostHog/posthog/pull/104202) | feat(workflows): accept the project secret api key on the workflows endpoint (open) | 6 | `frontend/src/lib`, `posthog`, `products/workflows`, `products/workflows/backend` | `17a2758` | Wayfinder ticket [#106](https://github.com/Silthus/posthog/issues/106), worker `wf68-106-implement`, claude-fable-5-1 | The workflows viewset adopts the core project-secret-key auth, throttle and scope allowlist. Score against `sessionAnswerDiff` (5 files); the final PR was restacked on #104156's commits. |

The newest pull requests were authored outside this machine, most likely on the devbox. Three of them would qualify with their sessions: #106561, #106553 and #106508 each touch three or more modules.

## Rejected candidates

| PR | Files | Reason |
|---|---|---|
| #106759 | 68 | More than 30 files. No local authoring session. |
| #106561 | 25 | No local authoring session; only mentioned in standup and uml-pr-review threads. Would qualify otherwise (14 modules). |
| #106553 | 8 | No local authoring session. Would qualify otherwise (4 modules). |
| #106508 | 22 | No local authoring session. Would qualify otherwise (3 modules). |
| #105958 | 4 | One module (`products/workflows/backend`). No local authoring session. |
| #105499 | 120 | More than 30 files. No local authoring session. |
| #105019 | 6 | One module (`frontend/src/layout`). No local authoring session. |
| #104452 | 87 | More than 30 files. |
| #104313 | 4 | Markdown only: an agent skill in two folders under `.agents/skills`. The statement is clear, but there is no code, so none of the architecture scores (imports, cycles, facades) can apply. |
| #104200 | 2 | One module (`frontend/src/lib`), although the statement is clear. |
| #104165 | 12 | Revival of #81024 by a Codex sub-agent of the PR audit thread. That agent's input was an existing diff to rebase and fix, so a replay would measure porting, not design; the original authoring session is not local. |
| #104164 | 44 | More than 30 files. |
| #104163 | 1 | One file. Revival of #81043. |
| #104162 | 5 | Revival of #87513 by a Codex sub-agent of the PR audit thread; its input was an existing diff, and the original authoring session is not local. |
| #104161 | 4 | Revival of #81032 by a Codex sub-agent of the PR audit thread; its input was an existing diff, and the original authoring session is not local. |
| #104157 | 41 | More than 30 files. |
| #104156 | 2 | One module (`products/workflows/backend`). |
| #103889 | 37 | More than 30 files. |
| #103689 | 44 | More than 30 files. |
| #103540 | 51 | More than 30 files. |
| #103522 | 2 | One module (`frontend/src/scenes`). Kept as the companion of #103523: the same session and statement. |
| #101397 | 4 | One module (`products/desktop/packages`). No local authoring session; only mentioned in the PR audit threads. |
| #87513 | 4 | One module (`products/desktop/packages`). No local authoring session. |
| #87510 | 4 | One module (`products/desktop/packages`). No local authoring session. |
| #81043 | 2 | No local authoring session. |
| #81037 | 5 | One module (`frontend/src/lib`). No local authoring session. |
| #81032 | 2 | No local authoring session. |
| #81024 | 12 | No local authoring session. |
