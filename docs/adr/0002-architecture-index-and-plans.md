# Architecture is modules plus imports, read from Git trees; plans live in the Git common dir

We decided in issues #15 to #19 (2026-09-26) how the tool models a whole repository and how an agent's architecture plan is stored and checked. The architecture index is a module tree derived from folders plus import dependencies, built from Git tree objects. Architecture plans are JSON documents in `$(git rev-parse --git-common-dir)/uml-pr-review/`, owned by one local server that also serves MCP and the explorer. Conformance compares a locked plan with the change from the plan's base commit to a snapshot of the working tree, at module level, using imports only.

## Decisions

- **Modules come from folders, not from configuration.** Source-bearing folders become modules: a transparent `src`, compressed single-child chains, one primary kind each (product, package, layer, and so on) with generic product detection. On PostHog this yields exactly its 86 products and agrees with its own `tach.toml` on 508 of 512 module pairs, with no configuration.
- **Dependencies are resolved imports, lifted to modules.** There is no whole-repository call graph. Calls stay a pull request review concern.
- **Everything is read from Git objects.** An index is keyed by tree SHA. The working tree becomes a tree through a snapshot: copy the real index to a temporary `GIT_INDEX_FILE`, `git add -A`, `git write-tree`. It is always seeded from a copy, because an empty temporary index loses tracked-but-ignored files.
- **The cache holds raw import references per blob,** keyed by blob SHA and extractor version, in `bun:sqlite`. Resolution is not cached, because it depends on the whole file set, tsconfigs, and manifests, and takes about 300 ms.
- **Plans live in the Git common dir.** Every worktree of a clone sees the same plans, and the working tree stays clean.
- **A plan is current state plus an append-only revision log.** Edits are atomic batches against an expected revision. The human owns the lock: a locked plan's modules and seams are immutable, and comments still flow both ways.
- **Conformance is module-level and every finding is actionable.** Each finding names a file and line and the change that would conform. During implementation, work the plan still expects is pending; at the end it is missing.
- **One process.** The Bun server serves MCP over Streamable HTTP at `/mcp`, the REST API, and Server-Sent Events from one in-memory event bus. The MCP tool list is fixed; state changes reach the agent in tool results.

## Considered options

- A whole-repository call graph. Rejected: too slow and too imprecise at PostHog's size, and module structure is what a plan talks about.
- Modules from manifests only (packages). Rejected: PostHog's products are not packages, and one Django app holds dozens of meaningful modules.
- Declared module configuration such as `tach.toml`. Rejected as a requirement: most repositories have none, and the folder rule already matches PostHog's.
- Plans in the working tree or in a per-user directory. Rejected: the first dirties the tree and forks plans per branch; the second loses the link to the clone and its worktrees.
- Checking plans against commits only. Rejected: the agent needs feedback before it commits.

## Consequences

- Cross-language interactions that imports cannot see (HTTP calls, Celery tasks, Temporal workflows) are invisible to the index and to conformance.
- Snapshots write loose objects into the clone's object store. `git gc` removes them.
- Import-only extraction means a change that calls into another module through an untyped runtime lookup is not a finding.
