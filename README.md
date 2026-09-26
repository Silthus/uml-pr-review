# uml-pr-review

Draws a codebase's architecture for the people and agents changing it:

- **Architecture plans.** An agent explores a whole repository's modules over MCP and drafts an architecture plan for a change. You watch and steer it live in the explorer, lock it, and check the implementation against it.
- **Pull request review.** It draws the architecture a pull request touches: the touched files and symbols, together with their callers and callees, as one self-contained HTML artifact.

## Companion app

```sh
bun install
bun run start
```

One process on http://127.0.0.1:4477 serves:

- `/`: the **explorer**. Pick a local clone (paste a path or use **Choose folder…** on macOS) to see its modules, their dependencies, and any architecture plans.
- `/pulls`: the **pull request review**. Pick a clone, then one of its open pull requests, and read the diagram. The explorer's **Pull requests** link opens it for the same clone, and its **Architecture** link leads back.
- `/mcp`: the MCP server for agents (see below).

The server reads everything straight from Git objects in your clone and never checks out a worktree, so repositories the size of PostHog work. The first review of a pull request fetches its head and base commits over HTTPS with your `gh` credentials into private `refs/uml-pr-review/*` refs. Your branches and working tree stay untouched.

Requirements: [Bun](https://bun.sh) and Git. The pull request review also needs the [GitHub CLI](https://cli.github.com), signed in (`gh auth status`). Set `PORT` to use a port other than 4477.

## Architecture plans with an agent

Start the server (`bun run start`) and register it with your agent once.

**Claude Code:**

```sh
claude mcp add --scope user --transport http uml-pr-review http://127.0.0.1:4477/mcp
```

`--scope user` makes the tools available in every project, which is what you want because the agent passes the repository as `worktree`. Without `--scope`, Claude Code uses local scope and registers the server only for the directory you run the command in.

**Codex**, in `~/.codex/config.toml`:

```toml
[mcp_servers.uml-pr-review]
url = "http://127.0.0.1:4477/mcp"
default_tools_approval_mode = "approve"
```

`default_tools_approval_mode = "approve"` lets Codex call the tools without asking. Keep it for `codex exec`, which cannot ask; whether Codex would ask otherwise depends on your approval policy and sandbox settings.

Neither client needs authentication. The server binds to `127.0.0.1` only, and `/mcp`, `/api/*`, and `/review/*` answer 403 to a foreign `Host` or `Origin` header. The pages at `/` and `/pulls` are static bundles and are not guarded; everything they load comes through the guarded routes.

**Agent skill.** `skills/planning-architecture/SKILL.md` teaches an agent the whole loop: map the ground, draft modules and seams through interfaces, review with you, build against the locked plan, and prove conformance. Link it where your agent loads skills:

```sh
ln -s "$PWD/skills/planning-architecture" ~/.claude/skills/planning-architecture   # Claude Code
ln -s "$PWD/skills/planning-architecture" ~/.codex/skills/planning-architecture    # Codex
```

Then ask the agent to plan before it builds, for example: "Plan, don't implement yet, how to show feature flag usage on error tracking issues. Use the uml-pr-review tools to explore and draft the architecture plan." Every tool takes `worktree`, the absolute path the agent works in. The nine tools:

- `get_architecture_overview`: the module tree a few levels deep, with kinds, file counts, and the heaviest dependencies.
- `describe_module`: one module's children, what it depends on, and what depends on it, counted in imports.
- `get_dependency_evidence`: the exact imports from one module to another, as `file:line`, target, and imported names.
- `search_modules`: finds modules by words in their paths or their files' paths.
- `create_plan`: starts an architecture plan based on the current `HEAD`.
- `get_plan`: a plan with its modules, seams, comments, lock status, the human comments not answered yet, and the human's edits since the agent's last change.
- `edit_plan`: applies an atomic batch of edits (modules, seams, summary, base commit, comments, replies) against the revision the agent last saw.
- `set_plan_lock`: locks or unlocks a plan, only on the human's word, which it quotes.
- `check_plan`: checks the working tree, including uncommitted and untracked files, against a plan. Each finding names `file:line` and the change that would conform. Pass `final: true` when done.

**In the explorer** (http://127.0.0.1:4477/?path=<your clone>), the plan appears as the agent writes it. The activity feed lists every tool call, and **Follow agent** moves the canvas to what the agent is looking at. Comment on the plan, a module, or a seam; the agent sees your comments in its next plan tool result and answers them in the plan. You can edit modules and seams by hand. **Lock plan** freezes the modules and seams for implementation. **Check** and **Final check** run the conformance check and mark every module and seam conforming, pending, or violating, with the findings listed.

A full run on PostHog, with recordings, screenshots, and the verbatim tool output, is in [`docs/proof/architecture-plans/transcript.md`](docs/proof/architecture-plans/transcript.md).

**Where things live.** Everything goes in the clone's Git common dir, so every worktree of a clone sees the same plans and your working tree stays clean:

- `$(git rev-parse --git-common-dir)/uml-pr-review/plans/<id>.json`: plans, with their revision history.
- `…/plans/<id>.conformance.json`: the latest check of each plan.
- `…/uml-pr-review/index-cache.sqlite` (with its `-wal` and `-shm` files): the import cache, keyed by blob. The first index of a PostHog-sized repository takes about 7 s; with the cache it takes about 1 s.

To remove all of it, stop the server, then delete `$(git rev-parse --git-common-dir)/uml-pr-review`. Checks snapshot the working tree through a temporary Git index and write its trees and blobs as loose objects into the clone's object store. Nothing references them, so `git gc` removes them once they are older than `gc.pruneExpire` (two weeks by default).

**Known limits:**

- Dependencies are imports only. HTTP calls, Celery tasks, and Temporal workflows are invisible to the index and the check.
- Languages: Python, TypeScript, and JavaScript. Other source folders show up as modules without dependencies.
- A check refuses when `HEAD` does not descend from the plan's base commit. While the plan is a draft, you can move its base.
- One server process is assumed. It serializes plan writes and holds the live event stream in memory, and it serves only `127.0.0.1`.

## CLI

Run it inside a clone:

```sh
bun run cli <pr-url | pr-number> [--out file.html] [--open] [--json]
```

`--json` prints the Graph instead of writing the artifact. The last stdout line is the artifact path.

## How the pull request review analyzes

- Languages: Python, TypeScript, and JavaScript, parsed with tree-sitter.
- Touched: a symbol whose line range overlaps an added line or a deletion in the diff.
- Callees: calls inside touched symbols, resolved through same-file definitions, `self`/`this`, and imports.
- Callers: one `git grep` over the head commit for touched names, then the same resolution in the files it finds. Names that appear in more than 120 files are skipped and listed as warnings.
- Packages: the nearest folder with a `package.json`, `pyproject.toml`, `setup.py`, `Cargo.toml`, or `go.mod`.

Resolution is name-based. Calls through untyped receivers, inherited methods, and re-exporting barrels are missed.

## Vocabulary

See `CONTEXT.md`. Decisions: `docs/adr/`.
