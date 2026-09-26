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

## Coherence loop

The Coherence loop moves a product scope toward a coherent architecture, one small verified pull request at a time. A deterministic **Coherence Index** scores the scope, a **ranking** picks the module where incoherence hurts most, and a headless Claude session applies the next recipe step (facade, characterisation tests, ratchet rule, or internal cleanup) in a scratch worktree, verifies it, and writes the pull request. Decisions only a human can make, such as what a facade may export, go to an inbox of GitHub issues instead of into code.

Every command below runs from the root of this repository and was run as written; the `--draft` and `inbox.ts resolve` commands ran against a fake `gh` and a fake `git push`, because they write to GitHub on your behalf. The outputs are in [`docs/proof/coherence-loop/readme-check.txt`](docs/proof/coherence-loop/readme-check.txt), and a full real iteration is in [`docs/proof/coherence-loop/`](docs/proof/coherence-loop/transcript.md).

### 1. Prerequisites

The following prerequisites are required:

- **Bun**, with this repository's dependencies installed. Without them the index cannot load its tree-sitter grammars.
- **`jq`**, to read the runner's JSON files in steps 6 and 7. `open` in step 3 is macOS; open the file in any browser elsewhere.
- **`gh`**, signed in. The loop reads PostHog's open pull requests, the inbox lives in `Silthus/uml-pr-review`, and `--draft` opens the pull request with it.
- **`uv`/`uvx`**, on your `PATH` or from PostHog's flox environment (`~/dev/posthog/.flox/run/*/bin/uvx`). The index runs pinned `lizard` and `ruff` through it.
- **A PostHog clone** at `~/dev/posthog`, with `upstream` pointing to `PostHog/posthog` and `origin` to your fork. The loop changes code only in scratch worktrees, but it does write to the clone: `--fetch` moves `upstream/master`, and every iteration adds a worktree and a `coherence/*` branch. The session agent has write access to the clone. Frontend tests borrow its `frontend/node_modules`; Python tests use a workspace venv built with `uv sync --frozen` when the lockfile differs from your clone's; when pytest cannot even start (an environment problem, not a test failure), verify reports the tests as `not run` with the reason ([#85](https://github.com/Silthus/uml-pr-review/issues/85)). Today PostHog's `pytest-split` fork blocks `uv sync`, so expect Python tests to show `not run`.
- **Claude Code**, signed in, with access to `claude-opus-5-5`. The session drops any gateway variables and loads no MCP servers.
- **The PostHog MCP**, to refresh the CI signals report (DevEx project 347861): in Claude Code, ask it to follow [`coherence/signals/export-ci.md`](coherence/signals/export-ci.md) for `products/workflows`. Without it, the committed report in `coherence/signals/reports/` serves.
- ⚠️ **Still missing: access to PostHog production (US project 2).** The MCP answers 404, so error tracking, APM, logs, and usage signals are unavailable. Until then, the ranking runs on git history, complexity, review findings, open pull requests, and CI.

```sh
bun install
gh auth status
git -C ~/dev/posthog remote -v
```

### 2. Score a product

```sh
bun coherence/index.ts --repo ~/dev/posthog --scope products/workflows --commit upstream/master
```

It prints the composite and the four dimensions (architecture, complexity, smells, tests), each 0 to 100, plus the enforcement ladder, which is reported but not scored. The same commit always gives the same number. Add `--json` for every measure and the files that drive it.

### 3. Backfill the history and read the report

```sh
bun coherence/backfill.ts --repo ~/dev/posthog --scopes products/workflows,products/surveys,products/error_tracking --ref upstream/master
bun coherence/report/build.ts --repo ~/dev/posthog --modules products/workflows --github PostHog/posthog
open docs/coherence/index-report.html
```

The backfill scores one commit per week over 26 weeks, plus Wednesday→Thursday pairs for the noise band, and caches every point in `coherence/data/`. From scratch it takes about 6 minutes; a refresh reuses the cache and takes seconds. The report build takes about a minute for a new head commit, and seconds after that.

How to read the report:

- **Is the index trustworthy?** A change counts only when it is bigger than the product's weekday band (the p90 of one day of ordinary commits). Workflows moves ±0.6 in a normal day; surveys ±3.9.
- **Composite, week by week** and **Each dimension** chart workflows next to surveys and error_tracking, the products the loop does not touch, so a trend that only workflows shows stands out.
- **Biggest movers** name the commits behind each large week, with links to their pull requests.
- **The module table** lists workflows modules worst first. That is where the loop will look.

### 4. Rank targets

```sh
bun coherence/targets.ts --repo ~/dev/posthog --scope products/workflows --commit upstream/master --posthog-signals coherence/signals/reports/workflows-ci-2026-09-26.json
```

Each module scores pressure × pain × safety, with the evidence behind each factor, and gets its next recipe step and verification class: **mechanical** (moves, tests, baselines), **behaviour-adjacent** (internals change behind pinned tests), or **boundary** (what other modules may depend on). Boundary steps always become inbox questions, up to `--max-questions` per run; the rest wait for the next run. Modules whose files are all busy in active PostHog pull requests are skipped.

### 5. Run one iteration (dry run)

```sh
bun coherence/loop/session.ts --repo ~/dev/posthog --scope products/workflows --fetch
```

It launches a headless Claude Opus 5.5 session with the `coherence-loop` skill. `--fetch` updates `upstream/master` first. Without `--draft`, every push from the session is blocked. It takes about 5 minutes and $0.60 to $1.30. When it ends, it prints the transcript path and the agent's summary.

`--fetch` fetches over HTTPS with your `gh` credentials, so it works headless even when your SSH agent needs an approval ([#86](https://github.com/Silthus/uml-pr-review/issues/86)).

Where the output lands:

- `coherence/runs/<date>/workflows.sense.json`: the ranking and inbox state the run started from.
- `coherence/runs/<date>/<slug>/`: one directory per iteration, with `iteration.json` (runner state), `summary.md` (the agent's words), and `pr.md` (the pull request body).
- `coherence/runs/ledger.jsonl`: one line per proposal or question. A proposal keeps its module out of later runs only while it is pending: a dry run while its branch exists in your clone, and a draft pull request while it is open (`gh pr view`, read-only). Deleting a dry run's branch gives the module back. A merged pull request gives the module back once the sensed base contains the merge; the ranking then picks the module's next recipe step from that base.
- `$TMPDIR/coherence-workflows-<slug>`: the scratch worktree, on branch `coherence/workflows/<slug>` in your PostHog clone.
- `$TMPDIR/coherence-session-<ms>.jsonl`: the transcript.
- New `coherence:question` issues in this repository, when the agent hits a boundary decision.

### 6. Review the dry run

```sh
iteration=$(dirname "$(ls -t coherence/runs/*/*/iteration.json | head -1)")
cat $iteration/pr.md
git -C "$(jq -r .workspace.path $iteration/iteration.json)" show --stat
```

`$iteration` is the newest iteration on this machine; if the run ended on a question, it has no workspace and `git -C` fails. `pr.md` states the target and why it ranks, the step and verification class, the index before and after for the touched module, the lint and test results, and which busy files stayed untouched. Tests that could not run locally are declared as "not run", with the reason. To change the wording, edit `$iteration/summary.md` and render it again:

```sh
bun coherence/loop/propose.ts --iteration $iteration --summary $iteration/summary.md
```

A dry run keeps its module out of later runs while its branch exists. If you will not promote it, drop it, and the next run may pick the module again:

```sh
git -C ~/dev/posthog worktree remove --force "$(jq -r .workspace.path $iteration/iteration.json)"
git -C ~/dev/posthog branch -D "$(jq -r .workspace.branch $iteration/iteration.json)"
```

### 7. Open your first draft pull request

When the dry run looks right, promote the same iteration:

```sh
bun coherence/loop/propose.ts --iteration $iteration --summary $iteration/summary.md --draft
```

What it does:

1. It refuses unless the last verification passed and the branch has not moved since.
2. It pushes the workspace's `HEAD` to `origin` (your fork, `Silthus/posthog`) as `coherence/workflows/<slug>`, over SSH.
3. It runs `gh pr create --draft --repo PostHog/posthog --base master --head Silthus:coherence/workflows/<slug>`, with the commit subject as the title and `pr.md` as the body.
4. It prints the `pullRequest` URL and stores it in `iteration.json`.

Before: check that `origin` is your fork (`git -C ~/dev/posthog remote -v`), that `gh auth status` is green, and that `pr.md` says what you want reviewers to read. After:

```sh
jq .proposal $iteration/iteration.json
gh pr list --repo PostHog/posthog --author @me --draft
```

Its ledger line now holds the pull request URL, so the module stays out of later runs until the pull request closes or merges. Keep the scratch worktree until the pull request merges or you drop it; review fixes go there. Then remove the worktree and the branch from your clone:

```sh
git -C ~/dev/posthog worktree remove --force "$(jq -r .workspace.path $iteration/iteration.json)"
git -C ~/dev/posthog branch -D "$(jq -r .workspace.branch $iteration/iteration.json)"
```

### 8. Answer inbox questions

```sh
bun coherence/inbox.ts list
```

Answer on GitHub: comment with the option letter and any detail, then close the issue. Close it as "not planned", or close it without an answer, to skip the target. From the shell, `bun coherence/inbox.ts resolve <number> --answer "<option and detail>"` does the same, and `bun coherence/inbox.ts resolve <number> --skip` skips. Only answers from the repository's owner, members, or collaborators count. The next run reads them: an answered target gets acted on with your answer in its `pr.md`, and a skipped one is never proposed again.

Two questions were open when this section was written (September 2026):

- **[#82](https://github.com/Silthus/uml-pr-review/issues/82): a facade for `backend/api`.** Four imports from outside the product bypass the existing facade, and three of them are Django viewsets, a webhook view, and `HogFlowSerializer`. It asks whether those callers should go through `backend/facade/`, which decides whether the workflows facade may export DRF viewsets and serializers. The options are to re-export all four and re-route the callers, to route only the plain-function caller and move URL registration and the management command into the product, or to skip. An answer lets the loop act on, or drop, the top-ranked workflows module.
- **[#83](https://github.com/Silthus/uml-pr-review/issues/83): a facade for `backend/services`.** Callers in `posthog/` and in `customer_analytics` import service functions and types directly, including the account-audience provider contract that `customer_analytics` implements. It asks whether the workflows facade should export them, which decides whether that registration hook becomes part of the public workflows boundary or stays a direct import; `customer_analytics` is another team's code. The options are to re-export everything, with the provider contract in `facade/contracts.py`, and re-route every caller; to re-route only the `posthog/` callers for now; or to skip. An answer lets the loop act on, or drop, the second-ranked module.

### 9. Tune it

- **`--budget <n>`** (on `session.ts`, default 1): pull requests to propose per run. Each iteration costs about 5 minutes.
- **`--active-days <n>`** (on `session.ts`, `sense.ts`, and `targets.ts`, default 14): a file counts as busy when a PostHog pull request updated within this many days touches it. Fewer days frees more modules; bots bump `updatedAt`, so 14 days still keeps about 2,000 pull requests active. Preview its effect with the ranking:

  ```sh
  bun coherence/targets.ts --repo ~/dev/posthog --scope products/workflows --commit upstream/master --posthog-signals coherence/signals/reports/workflows-ci-2026-09-26.json --active-days 3 | head -20
  ```

- **`--max-questions <n>`** (on `session.ts` and `sense.ts`, default 2): inbox questions per run.
- **`--runs <dir>`** (on `session.ts` and `sense.ts`, default `coherence/runs`): where the sense file, the iterations, and the ledger go. A fresh directory starts with an empty ledger.
- **Recipe steps:** there is no switch to turn a step off. The order is fixed in `coherence/signals/recipe.ts`: facade, then characterisation tests, then a ratchet rule, then internal cleanup. Boundary steps always wait for an inbox answer, and "skip" on a question takes one target out of the loop.

### 10. Next steps

These are named, not built:

- **Stamphog auto-approval for mechanical pull requests.** PostHog's merge gate is configured per repository in `.stamphog/policy.yml`. A rule there could approve loop pull requests whose verification class is mechanical (tests, moves, baselines) and whose checks pass, while behaviour-adjacent and boundary ones keep human review.
- **Self-driving scheduling.** A daily scheduled run of `session.ts` with a small budget, once the loop is tuned and draft mode has earned trust, instead of a person starting each run.

## Vocabulary

See `CONTEXT.md`. Decisions: `docs/adr/`.
