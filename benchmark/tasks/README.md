# Benchmark tasks

Each `<pr>.json` is one task for the architecture benchmark in [#61](https://github.com/Silthus/uml-pr-review/issues/61): one of Michael's PostHog pull requests whose authoring agent session is on this machine. The replay arms start from `baseCommit` and get `taskStatement`. Arm A is the historical pull request.

## Fields

- `baseCommit`: the merge-base with upstream `master` of the first commit the author pushed. `notes` explains when it differs from the parent of the pull request's first surviving commit, which happens when the branch was rebuilt and force-pushed.
- `finalHead`: the pull request head. `diffStat.final` is `merge-base(baseRefOid, finalHead)..finalHead`, which matches the pull request's diff on GitHub.
- `firstPushHead`: the first head pushed to the branch, from the GitHub timeline and the push output in the transcript. `diffStat.firstPush` is `diffStat.firstPush.base..firstPushHead`, the author's own commits on top of the tree they worked on.
- `taskStatement`: Michael's feature-defining messages, verbatim, in order. Messages are joined with a blank line. When only part of a message is kept, each excerpt is an exact substring of the message, and excerpts from one message are joined with a newline. `taskStatementSources` lists the T3 message ids and excerpts, so every statement can be checked against `projection_thread_messages` in `~/.t3/userdata/state.sqlite`. `taskStatementNotes` says what was kept and dropped, and why.
- `attachments`: the images the kept messages reference, under `~/.t3/userdata/attachments`.
- `diffStat.*.modules`: the top three path levels of each changed file.

Every commit named in a manifest resolves in `~/dev/posthog` (`git cat-file -e`).

## Tasks

| PR | Title | Files | Modules | Base | Session | Why |
|---|---|---|---|---|---|---|
| [#103523](https://github.com/PostHog/posthog/pull/103523) | feat(ai): let the agent search and list workflows (merged) | 6 | `ee/hogai/context`, `ee/hogai/tools`, `products/workflows/backend`, `tach.toml` | `29bb275` | T3 "Add workflows quick entry point", claude-fable-5-1 | The AI agent reaches into the workflows product; the first commit bypassed the workflows facade and was fixed in `335c502`. Companion [#103522](https://github.com/PostHog/posthog/pull/103522) answers the same statement. |
| [#103533](https://github.com/PostHog/posthog/pull/103533) | feat(workflows): link the sending allowance card to the tier docs (closed) | 6 | `products/workflows/backend`, `products/workflows/frontend`, `services/mcp/src` | `cea129a` | T3 "Document sending allowance tiers", claude-fable-5-1 | A full-stack slice: backend serializer, generated API types and MCP client, and a popover card in the UI. |
| [#102897](https://github.com/PostHog/posthog/pull/102897) | fix(workflows): let the email preview fill the step panel (closed) | 5 | `frontend/src/lib`, `frontend/src/scenes`, `products/workflows/frontend` | `7b46385` | T3 "Expand Workflow Email Preview", claude-fable-5-1 | A layout fix that spans a shared component, the email templater, and the workflows panel. |

Only three of Michael's PostHog pull requests pass all the criteria (2 to 30 files, at least two modules, a clear feature or fix statement from Michael in a local authoring session). The five newest pull requests in range (#105019, #105958, #106508, #106553, #106561) were authored outside this machine, most likely on the devbox. Their sessions would add the most tasks.

## Rejected candidates

| PR | Files | Reason |
|---|---|---|
| #106759 | 68 | More than 30 files. No local authoring session. |
| #106561 | 25 | No local authoring session; only mentioned in standup and uml-pr-review threads. |
| #106553 | 8 | No local authoring session. |
| #106508 | 22 | No local authoring session. |
| #105958 | 4 | No local authoring session. |
| #105499 | 120 | More than 30 files. No local authoring session. |
| #105019 | 6 | No local authoring session. |
| #104452 | 87 | More than 30 files. |
| #104313 | 4 | Agent skill documents only (`.agents/skills`); no code modules. |
| #104202 | 6 | Authored by a sub-agent of the wayfinder demo thread. Michael's only statement is a one-line answer to the agent's research ("Yes, let's use the project secret API key that exists..."), and the diff is stacked on #104156's revision fixes. |
| #104200 | 2 | One module (`frontend/src/lib`), although the statement is clear. |
| #104165 | 12 | Revival of #81024 by a Codex sub-agent of the PR audit thread. No feature-defining message; the original authoring session is not local. |
| #104164 | 44 | More than 30 files. |
| #104163 | 1 | One file. Revival of #81043. |
| #104162 | 5 | Revival of #87513 by a Codex sub-agent of the PR audit thread; no feature-defining message. One product (`products/desktop`). |
| #104161 | 4 | Revival of #81032; no feature-defining message. |
| #104157 | 41 | More than 30 files. |
| #104156 | 2 | One module (`products/workflows/backend`). An agent-proposed fix from the wayfinder demo thread; no statement from Michael. |
| #103889 | 37 | More than 30 files. |
| #103849 | 16 | Built by a wayfinder ticket worker from an agent-written ticket; no feature-defining message from Michael. |
| #103843 | 20 | Built by a wayfinder ticket worker from an agent-written ticket; no feature-defining message from Michael. |
| #103729 | 6 | Built by a wayfinder ticket worker from an agent-written ticket; no feature-defining message from Michael. |
| #103689 | 44 | More than 30 files. |
| #103540 | 51 | More than 30 files. |
| #103522 | 2 | One module (`frontend/src/scenes`). Kept as the companion of #103523: the same session and statement. |
| #101397 | 4 | No local authoring session; only mentioned in the PR audit threads. |
| #87513 | 4 | No local authoring session. |
| #87510 | 4 | No local authoring session. |
| #81043 | 2 | No local authoring session. |
| #81037 | 5 | No local authoring session. |
| #81032 | 2 | No local authoring session. |
| #81024 | 12 | No local authoring session. |
