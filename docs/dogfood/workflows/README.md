# `products/workflows` dogfood of `define-invariant`

For [#119](https://github.com/Silthus/uml-pr-review/issues/119), part of map [#105](https://github.com/Silthus/uml-pr-review/issues/105). The [`define-invariant`](../../../skills/define-invariant/SKILL.md) skill ran headless on kit worktrees of PostHog master [`645e1a7`](https://github.com/PostHog/posthog/tree/645e1a78140757ea1bb9ddeb0ff9d3915c60b6f6), in two passes:

- **TypeScript:** the workflows runtime, `nodejs/src/cdp/services/hogflows`;
- **Python:** the workflows backend, `products/workflows/backend`.

A scripted engineer answered it. The recorded runs used the final skill; each transcript's first line gives its sha256. An earlier pass on the first version of the skill is kept in [`first-pass/`](first-pass/). The review changed the skill between the two passes; see "The first pass" below.

## What the skill declared

**TypeScript**: 1 invariant and 7 requirements. [`typescript/spec-check.txt`](typescript/spec-check.txt) shows 0 problems and 0 unfilled placeholders.

| Bullet | Form | State and grade | Enforcer | Backing |
|---|---|---|---|---|
| one-duration-grammar | lint totality oracle, `via: lint oxlint:eslint-js/no-restricted-syntax matching "one-duration-grammar"` | **invariant**, verified | a new `src/cdp/**/*.ts` override in `nodejs/.oxlintrc.nodejs.json` ([`typescript/lint-entry.diff`](typescript/lint-entry.diff)); `duration.ts` is the paved path in `excludeFiles` | the harvested rule `one-duration-grammar` |
| seven `*-handler-only-through-executor` bullets: conditional_branch, delay, exit, hog_function, random_cohort_branch, trigger, wait_until_time_window | module chokepoint on `actions/<handler>.ts`, `chokepoint: hogflow-executor.service.ts` | requirement, **`checker-choked`** | PR 1's `coherence/chokepoint` in `nodejs/.oxlintrc.nodejs.json` | the engineer's statement: the executor is the one place a step is dispatched, with its result handling, logging and metrics |

Before declaring, the skill fixed the violations it found in the worktree:

- `actions/hog_function.ts` had its own duration regex; it now calls `durationSeconds`;
- `calculatedScheduledAt` moved out of `actions/delay.ts` into a new `scheduling.ts`, so `delay.ts` has one importer.

It reported 220/220 tests passing across the six affected suites. [`typescript/declaration.patch`](typescript/declaration.patch) is the whole change except the lint entry.

**Python**: 1 invariant and 0 requirements.

| Bullet | Form | State | Enforcer | Listed residual |
|---|---|---|---|---|
| ses-only-through-provider | lint totality oracle, `via: lint ruff:TID251 matching "ses-only-through-provider"` | **invariant**, verified | ruff `TID251` in a new `products/workflows/backend/ruff.toml`; `providers/ses.py` is the paved path | `test/test_ses_provider.py`, `test/test_ses_account_reputation_task.py`, named in `over:` and in `extend-per-file-ignores` |

[`python/declaration.patch`](python/declaration.patch) is the whole change.

- The skill **dropped** a bytecode-compiler ban. `server-compiles-all-bytecode` is about discarding client bytecode, and a ban can't check that.
- It kept `facade-is-the-only-way-in` out, because tach owns it.

## The goals

- **A TypeScript chokepoint graded `checker-choked` by PR 1's rule: held, 7 times.** `run --status` names the enforcer `oxlint (nodejs/.oxlintrc.nodejs.json) rule coherence/chokepoint`. The kit's witness went red, then clean, for all seven ([`typescript/witness.txt`](typescript/witness.txt), about 4.6 s each).
- **A Python invariant that reuses an existing enforcer: held, through ruff.** The bullet reuses PostHog's ruff and adds one `TID251` entry, as the spec's Python section plans. The first pass also tried the other kind of reuse: an existing import-linter contract credited as it stands. The witness showed that credit to be false; see point 2 below.
- **Each conversation ends with `spec --check` showing invariants and a witnessed refutation: held for Python; partly held for TypeScript.**
  - Python: 1 of 1 bullets is an invariant.
  - TypeScript: 1 of 8. The lint oracle is an invariant. The seven chokepoints stay requirements, because Coherence cannot refute a TypeScript module in PostHog (point 1). The skill quoted Coherence's reason to the engineer and asked whether to keep them, as step 6 now says. The engineer kept them, since the lint already enforces them.

## What didn't fit, and why

1. **Coherence cannot refute a TypeScript chokepoint in PostHog.** Its refutation reads "`<file>` exports nothing, so no document can reference it" and comes back `not run`. The language server returns no document symbols at all for PostHog files ([`proof/ts-instrument-probe.txt`](proof/ts-instrument-probe.txt)): an empty list after 33 s cold, and again when warm. PostHog has no `typescript` at its root, so Coherence falls back to its own 5.9.3, while `nodejs/` uses 6.0.3. Two hypotheses remain open: the project load outlasts the request, or the version mismatch. #117 hit the same thing. **For PR 1:** the rung is credited and the lint enforces it, but the bullets can't become invariants in PostHog until the instrument answers.
2. **An import-linter credit can be false** ([`first-pass/python-witness.txt`](first-pass/python-witness.txt)). In the first pass, `graph-validation-has-one-door` graded `checker-choked`: the four `products.*.backend` contracts all name the module, so Coherence credits it. None of those contracts forbids an import from `services/`, so none enforces the rule:
   - the kit's bypass, a bare `import …graph_validation` in the backend folder, left `run` passing, and the witness exited 1;
   - a bypass that called `validate_graph` from `services/` was caught, but by Coherence's own reference check, not by import-linter.

   The skill now witnesses a credited enforcer and says so in `because` when it stays silent. The false credit is worth raising in #112.
3. **Ruff bans need a nested config.** `banned-api` applies everywhere its config does, so a workflows-only ban lives in `products/workflows/backend/ruff.toml`, extending `../../ruff.toml`. Its ignores go in `extend-per-file-ignores`: a plain `per-file-ignores` replaces `products/ruff.toml`'s table, and 1,460 ANN errors appear in tests. I verified both behaviours on ruff 0.15.20. `enforcers.md` says so.
4. **The kit's witness covers only some forms.** `witness.ts` reads `banned-api` from `pyproject.toml` alone, and it builds bypasses for `no-restricted-imports` only. So both lint oracles were witnessed by hand, with the kit's own protocol: stage, `refute`, remove, `run --invariant`. Both went red, then green. The Python residual was also shown to be real: without its two ignore lines, ruff flags exactly those files. This is a gap for #117/#118.
5. **The workflows frontend isn't in this dogfood.** About 25 outside files deep-import it (#109), so no module there has one door. What fits is a scoped ban in the root `.oxlintrc.json`, and the kit wires only the nodejs config.
6. **Coherence's Python chokepoint check is slow cold:** about 196 s, because it starts Pyright on PostHog.

## Side effects of the headless sessions

The skill session has Bash, and in the TypeScript rerun it acted outside its worktree:

- **It filed [PostHog/coherence#16](https://github.com/PostHog/coherence/issues/16)** from Michael's account, about the empty document symbols. The scripted engineer had said "go ahead and file the bug". That approval isn't Michael's, and filing breaks the map's rule against writing to PostHog. The issue is still open. **Michael decides whether it stays.**
- **It saved an auto-memory note** in `~/.claude/projects/-home-coder-posthog/memory/`. I removed the note and its `MEMORY.md` line.
- **It ran `flox activate` in `~/posthog`** to use PostHog's Node for jest and prettier. That wrote flox logs and rewrote `node_modules/.modules.yaml` and `.pnpm-workspace-state-v1.json` there. Those are git-ignored; nothing tracked changed. See [`proof/teardown.txt`](proof/teardown.txt).

`converse.ts` now denies these to the skill session: `gh`, `git push`, `flox`, and edits under `~/.claude`. That guard was added after the recorded runs, and no run has exercised it yet.

## The lint entries for a real PR

- **Python:** the patch as it is.
- **TypeScript:** the patch, plus two edits to PostHog's own `nodejs/.oxlintrc.nodejs.json`, not the kit's rewritten copy:
  - the override in [`typescript/lint-entry.diff`](typescript/lint-entry.diff);
  - PR 1's rule, in the top-level `jsPlugins` and `rules`:

    ```jsonc
    "jsPlugins": [/* existing */, "@posthog/coherence/lint"],
    "rules": { /* existing */, "coherence/chokepoint": ["error", { "root": ".." }] }
    ```

    - Add the same two entries to `nodejs/src/ingestion/pipelines/sessionreplay/ml-mirror-image-scrub-sidecar/.oxlintrc.json`. Without them, Coherence withdraws the credit for every `nodejs/` module.
    - `root` is resolved against the folder the lint runs in, so `".."` fits `cd nodejs && oxlint -c .oxlintrc.nodejs.json`, which is how `nodejs/package.json` runs it.
    - `@posthog/coherence/lint` resolves only once PR 1's package is a dependency of `nodejs/`.

## How it ran

- **Kit:** `bun benchmark/replay/kit/setup.ts /tmp/dogfood-119-{ts,py} --ref master --language typescript|python`, without `--hooks`, because the conversation isn't a replay. The real before-state, captured in those worktrees before the recorded runs, is in [`proof/red-before-the-conversation.txt`](proof/red-before-the-conversation.txt): no spec, and an outside import of a hogflows module passes the lint.
- **Driver:** [`converse.ts`](converse.ts). It alternates two headless Opus sessions:
  - the skill: `claude -p … --model claude-opus-5-5 --plugin-dir skills/define-invariant --permission-mode acceptEdits --output-format stream-json`, resumed with `--resume` for each answer. The transcripts list every tool call under each turn;
  - the engineer: a fresh `claude -p --model claude-opus-5-5 --tools ""` that gets the transcript and the persona in [`engineer.md`](engineer.md), and answers `DONE` once the closing summary asks nothing more.

  The TypeScript pass took 8 turns (3 questions), and the Python pass 8 turns (3 questions).
- **The persona changed between the two passes.** The Python pass ran before the paragraph about the kit's rewritten configs was added. The first TypeScript rerun had accepted a recommendation to restore PostHog's committed oxlint config, which removes the kit's wiring. I stopped it, rebuilt the worktree, and restarted with the paragraph added.
- **PostHog's `SessionStart` hooks never ran.** Both sessions use `--setting-sources local`, which skips the worktree's `.claude/settings.json` and also user settings. On this box, the three hooks would do the following:
  - `setup-cloud.sh` exits unless `CLAUDE_CODE_REMOTE=true`;
  - `setup-code-signing.sh` finds no Secretive socket;
  - `setup-flox.sh` would run `flox activate` in the worktree.

  No `.flox/cache` appeared in the worktrees.
- **Held-out corrections.** The skill reads every corpus row, including the `heldout` split. Those rows are reserved for validating the grader (#100). The skill only reads them as evidence, so it tunes nothing.

## Lint timings

From [`lint-timings.txt`](lint-timings.txt), with the kit's commands:

| | Time |
|---|---|
| oxlint over `nodejs/src/cdp/services/hogflows` | 1.24–1.29 s |
| oxlint over one file | 1.1 s |
| oxlint over `nodejs/src/cdp` | 1.6 s |
| oxlint over all of `nodejs/`, as the lint oracle runs it | 2.3 s |
| ruff, uncached, over `products/workflows/backend` | 0.07–0.08 s |
| ruff over one file | 0.04 s |
| the kit's witness for one TypeScript chokepoint | about 4.6 s |
| Coherence's Python chokepoint check, cold (first pass) | about 196 s |

## "What Michael runs" (#111)

Corrected line:

```sh
# was: claude --plugin-dir ~/dev/uml-pr-review/skills
cd /tmp/try-ts/posthog && claude --plugin-dir ~/dev/uml-pr-review/skills/define-invariant   # then: /define-invariant nodejs/src/ingestion
```

`--plugin-dir` takes a plugin folder. `skills/` holds none, so it loads nothing. `skills/define-invariant` loads as a one-skill plugin, and `/define-invariant` resolves; I checked this from the session's `init` event.

What I ran, and what I didn't:

- **Ran:**
  - `setup.ts … --ref master` (`origin/master` resolves in `~/posthog` too);
  - the plugin load;
  - `/define-invariant <folder>`, headless, on the two workflows folders;
  - `spec --check`;
  - the human oxlint line, on `nodejs/src/cdp/services/hogflows` in the kit worktree. It exits 0 and prints nothing when clean. The kit writes an absolute `root`, so running from the repository root works there.
- **Not run:**
  - `--hooks`;
  - an interactive session with project settings;
  - `nodejs/src/ingestion` as the folder;
  - `bun benchmark/replay/run.ts`, which is #118's and not on `main` yet.

## The first pass

The first pass ran on the first version of the skill. It declared 9 TypeScript chokepoints and 3 Python invariants ([`first-pass/`](first-pass/)). The review found that the skill had accepted the code's shape as backing, among other problems: 8 of the 9 chokepoints rested on "one importer today", confirmed with a "yes". The skill now treats that shape as a lead, and a candidate needs the engineer to state the rule and its reason. The first pass also chose a bytecode ban that missed `compile_hog` and `compile_filters_bytecode`. It is kept for its evidence (points 2 and 3 above), not as the result.

## Files

| File | What |
|---|---|
| `typescript/transcript.md`, `python/transcript.md` | each conversation, with the skill's tool calls folded under each turn |
| `typescript/declaration.patch`, `python/declaration.patch` | specs, lint entries, and fixes, as a patch against `645e1a7`, with the kit's own files excluded |
| `typescript/lint-entry.diff` | the override the skill added to the kit's `nodejs/.oxlintrc.nodejs.json` |
| `*/spec-check.txt`, `*/run-status.txt` | `coherence spec --check` and `run --status` at the end |
| `*/witness.txt` | the enforcers going red, then green |
| `first-pass/` | the first pass's transcripts, patches, checks and witnesses |
| `proof/` | the before-state, the TypeScript instrument probe, the repository gate, the driver's typecheck, and the teardown check on `~/posthog` |
| `converse.ts`, `engineer.md` | the driver and the engineer's persona |
