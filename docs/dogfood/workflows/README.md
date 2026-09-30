# `products/workflows` dogfood of `define-invariant`

For [#119](https://github.com/Silthus/uml-pr-review/issues/119), part of map [#105](https://github.com/Silthus/uml-pr-review/issues/105). The [`define-invariant`](../../../skills/define-invariant/SKILL.md) skill ran twice, headless, on kit worktrees of PostHog master [`645e1a7`](https://github.com/PostHog/posthog/tree/645e1a78140757ea1bb9ddeb0ff9d3915c60b6f6). A scripted engineer answered it:

- **TypeScript:** the workflows runtime, `nodejs/src/cdp/services/hogflows`;
- **Python:** the workflows backend, `products/workflows/backend`.

## What the skill declared

**TypeScript**: 9 module chokepoints, all graded `checker-choked` by PR 1's `coherence/chokepoint` oxlint rule. None had a violation, so there is no listed residual.

| Invariant | Protects | Chokepoint | Backing |
|---|---|---|---|
| conversion-watcher-through-executor | `conversion-watcher.ts` | `hogflow-executor.service.ts` | correction on [#82953](https://github.com/PostHog/posthog/pull/82953), whose fix created the file |
| six `*-step-through-executor` bullets, one per handler: conditional_branch, hog_function, random_cohort_branch, wait_until_time_window, trigger, exit | `actions/<handler>.ts` | `hogflow-executor.service.ts` | engineer statement: handlers are reached only through the executor's registry |
| quota-check-in-invocation-pipeline | `hogflow-quota-limiting.ts` | `../hog-flow-invocation-pipeline.service.ts` | engineer confirmation of the pipeline's stage order |
| billing-in-function-step | `billing-utils.ts` | `actions/hog_function.ts` | engineer confirmation: bill once per invocation |

The skill dropped `hogflow-variable-usage` (its own comment expects a second caller) and left out `actions/delay.ts`, which has two importers.

**Python**: 3 invariants, 0 requirements, and no listed residual.

| Invariant | Form | Grade | Enforcer |
|---|---|---|---|
| graph-validation-has-one-door | chokepoint: only `presentation/views/hog_flow.py` imports `graph_validation.py` | `checker-choked` | import-linter "presentation must use facade", **reused as it stands** |
| server-compiles-all-bytecode | lint totality oracle, `via: lint ruff:TID251 matching "server-compiles-all-bytecode"` | verified | ruff `TID251`: a new `products/workflows/backend/ruff.toml` bans three bytecode compilers outside the serializer |
| ses-only-through-provider | lint totality oracle, `via: lint ruff:TID251 matching "ses-only-through-provider"` | verified | the same `ruff.toml` bans `boto3` and `botocore` outside `providers/ses.py` |

The skill kept `facade-is-the-only-way-in` out because tach owns it.

## The goals

- **A TypeScript chokepoint graded `checker-choked` by PR 1's rule: held, 9 times.** `run --status` names the enforcer: `oxlint (nodejs/.oxlintrc.nodejs.json) rule coherence/chokepoint`. The kit witnessed each one: oxlint went red on a staged import, then clean once the import was removed ([`typescript/witness.txt`](typescript/witness.txt), 4.6 s each).
- **A Python invariant that reuses an existing enforcer: held, with a caveat.** `graph-validation-has-one-door` is credited through an existing import-linter contract, with no new config. But that contract doesn't stop an import from `services/`; see point 2 below. The two ruff bans reuse an existing linter too, and each adds a `TID251` entry. Their enforcer runs in every ruff lint: at commit, in CI, and in the editor.
- **Each conversation ends with `spec --check` showing invariants and a witnessed refutation: held for Python, but not for TypeScript.** The 9 TypeScript bullets stay **requirements**, with "lacks refutation". The reason is below.

## What didn't fit, and why

1. **Coherence cannot refute a TypeScript chokepoint in PostHog, so the lint witness stands in.** Coherence's automatic refutation asks the language server for the protected module's symbols. In PostHog it gets back an empty list, so it reports "`billing-utils.ts` exports nothing, so no document can reference it", and the refutation reads `not run`. A direct probe of the adapter shows the empty list for `billing-utils.ts` after 33 s cold, and again when warm. The file does export `trackHogFlowBillableInvocation`. #117 hit the same thing for `group-logging.ts`. The fault lies between Coherence's TypeScript instrument and PostHog's two large tsconfig projects. It is not in the spec: `spec --check` reports 0 problems and 0 unfilled placeholders. The skill quoted the check's reason and recorded the lint witness in each `refuted:` line. **For PR 1:** the rung is credited, but the bullets can't become invariants in PostHog until the instrument answers.
2. **The import-linter credit is broader than the rule behind it, and the witness shows the hole.** Coherence credits any module that an import-linter contract names, and the pattern `products.*.backend` names every backend module. So the "presentation must use facade" contract credits `graph_validation.py`, even though that contract only limits what presentation imports. The skill caught this. The bullet's `because` says the contract stops nothing in `services/` or `facade/`, and that the chokepoint does. The witnesses split on the kind of bypass ([`python/witness.txt`](python/witness.txt)):
   - **A bypass that calls `validate_graph` from `services/`:** Coherence's reference check fails the run and names both lines. It went back to passing once the file was removed.
   - **The kit's bypass, a bare `import …graph_validation` in the backend folder with no member use:** `run` still passes with the file staged, so the kit's witness exits 1. The reference check sees no member reference, and the credited import-linter contract doesn't cover that folder.

   So the grade reads `checker-choked`, but the working enforcement is Coherence's own reference check, run by `coherence run` or its edit hook. This is a false-credit risk in Coherence as it ships, and worth raising in #112.
3. **Ruff bans have to be scoped with a nested config.** `banned-api` bans a name everywhere its config applies, so a workflows-only ban needs `products/workflows/backend/ruff.toml` extending `../../ruff.toml`. Its ignores must go in `extend-per-file-ignores`. A plain `per-file-ignores` replaces `products/ruff.toml`'s table: the Python pass hit 1,460 ANN errors in tests before it switched. I verified both behaviours on ruff 0.15.20 and amended [`enforcers.md`](../../../skills/define-invariant/enforcers.md) while the conversations were running. The TypeScript pass never reached it. The Python pass found the gotcha on its own before reading the amendment.
4. **The kit's witness can't read these ruff oracles.** `witness.ts` looks for the banned API in `pyproject.toml` and treats `matching` as the API name. The skill put the ban in a nested `ruff.toml` and matched the invariant's name in the message, which lets one oracle cover three APIs. So I ran the same protocol by hand: stage an import, `refute`, remove it, `run --invariant`. Both went red, then green ([`python/witness.txt`](python/witness.txt)). The kit's chokepoint witness ran unchanged. This is a gap for #117/#118, not a change here.
5. **The workflows frontend isn't in this dogfood.** Its gap is real: about 25 outside files deep-import it (#109). But no module there has one door, so a chokepoint doesn't fit. What fits is a scoped ban, a lint totality oracle in the root `.oxlintrc.json`. The kit wires only the nodejs oxlint config, and the root config would need the plugin and a `lint` entry of its own. That is a separate pass.
6. **Findings the skill reported but did not declare:**
   - `actions/hog_function.ts:46` breaks the harvested `one-duration-grammar` rule with its own `AWAIT_DURATION_REGEX`. That regex is the backtracking form `duration.ts` warns against. An import rule can't express this.
   - The kit's rewritten `.oxlintrc.nodejs.json` has `typeAware` off and absolute `/tmp` paths. The skill told the engineer to ship only the two plugin lines (see the next section).
7. **Coherence's Python chokepoint check is slow cold.** It takes about 196 s, because it starts Pyright on PostHog. The lint oracles take about 0.1 s each inside `run`.

## The lint entries for a real PR

- **Python:** [`python/declaration.patch`](python/declaration.patch) is the whole change: `Backend.spec.md` and the nested `ruff.toml`.
- **TypeScript:** [`typescript/declaration.patch`](typescript/declaration.patch) adds `Hogflows.spec.md`. The enforcer is PR 1's rule in `nodejs/.oxlintrc.nodejs.json`. In the kit, that config is rewritten for `/tmp`; in PostHog it is two additions:

  ```jsonc
  "jsPlugins": [/* existing */, "@posthog/coherence/lint"],
  "rules": { /* existing */, "coherence/chokepoint": ["error", { "root": ".." }] }
  ```

  `root` is relative to the lint's working folder, `nodejs/` in CI.

## How it ran

- **Kit:** `bun benchmark/replay/kit/setup.ts /tmp/dogfood-119-{ts,py} --ref master --language typescript|python`, without `--hooks`, because the conversation isn't a replay.
- **Driver:** [`converse.ts`](converse.ts). It alternates two headless Opus sessions:
  - the skill: `claude -p … --model claude-opus-5-5 --plugin-dir skills/define-invariant --permission-mode acceptEdits --output-format stream-json`, resumed with `--resume <session>` for each engineer answer;
  - the engineer: a fresh `claude -p --model claude-opus-5-5 --tools ""` given the transcript so far and the persona in [`engineer.md`](engineer.md). It answers `DONE` once the skill's closing summary asks nothing more.

  The TypeScript pass took 12 turns (5 questions); the Python pass took 8 (3 questions).
- **PostHog's `SessionStart` hooks never ran.** Both sessions use `--setting-sources local`, which skips the worktree's `.claude/settings.json`. On this box its three hooks would do the following:
  - `setup-cloud.sh` exits unless `CLAUDE_CODE_REMOTE=true`;
  - `setup-code-signing.sh` finds no Secretive socket;
  - `setup-flox.sh` would run `flox activate` and write `.flox/cache` (flox is installed here). No `.flox/cache` appeared.

  The flag also skips user settings, so Michael's own hooks and plugins stayed out of both sessions.
- **Teardown.** The skill session left a warm `coherence serve` behind for the TypeScript worktree, and the kit's teardown doesn't stop it. I stopped it before teardown. For #117/#118: teardown should kill `serve` processes rooted in the folder.

## Lint timings

From [`lint-timings.txt`](lint-timings.txt), with the kit's commands:

| | Time |
|---|---|
| oxlint over `nodejs/src/cdp/services/hogflows` | 1.2 s (3 runs) |
| oxlint over one file | 1.1 s |
| oxlint over all of `nodejs/` | 2.3 s |
| ruff, uncached, over `products/workflows/backend` | 0.07–0.08 s |
| ruff over one file | 0.03 s |
| kit witness, one TypeScript chokepoint | 4.6 s |
| Coherence Python chokepoint check, cold | about 196 s |

## "What Michael runs" (#111): corrected lines

The spec's lines work as written, except these:

```sh
# was: claude --plugin-dir ~/dev/uml-pr-review/skills
cd /tmp/try-ts/posthog && claude --plugin-dir ~/dev/uml-pr-review/skills/define-invariant   # then: /define-invariant nodejs/src/ingestion
```

- `--plugin-dir` takes a plugin folder. `skills/` holds no plugin, so Claude Code loads nothing from it. `skills/define-invariant` loads as a one-skill plugin, and `/define-invariant` resolves. I checked this from the session's `init` event.
- `bun benchmark/replay/run.ts 64506 …` is #118's, and it is not on `main` yet.
- `--ref origin/master` resolves in `~/posthog`.
- The human oxlint line exits 0 and prints nothing when the code is clean.

## Files

| File | What |
|---|---|
| `typescript/transcript.md`, `python/transcript.md` | each conversation, with the commands the skill ran folded under each turn |
| `typescript/declaration.patch`, `python/declaration.patch` | the specs and lint entries, as a patch against `645e1a7` (the kit's own files excluded) |
| `typescript/spec-check.txt`, `python/spec-check.txt` | `coherence spec --check` at the end |
| `typescript/run-status.txt`, `python/run-status.txt` | `coherence run --status` at the end |
| `typescript/witness.txt`, `python/witness.txt` | the enforcers going red, then green |
| `proof/` | red before the conversation, the repository gate, and the teardown check on `~/posthog` |
| `converse.ts`, `engineer.md` | the driver and the engineer's persona |
