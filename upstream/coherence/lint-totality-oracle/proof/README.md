# Proof bundle

Everything ran in a `/tmp` clone of PostHog/coherence at `BASE`, with Node v22.20.0, dependencies from `bunx pnpm@10 install --ignore-scripts` (lockfile not committed), and the Python test venv from `uv` (`pytest==9.1.1` from `requirements-test.txt`, plus `coverage` so no test is skipped). Coherence's `test` script calls `npm run` for each step, so its four steps ran through pnpm instead: `pnpm run typecheck`, `test:unit`, `lexicon:check`, `spec:check`.

## Red, then green

| File | What it shows |
|---|---|
| `red-grammar.txt` | the `via` parser test failing before the grammar knew the lint form |
| `red-lint-adapters.txt` | the format adapter tests failing before `lint.ts` existed |
| `red-refute.txt` | `refute` did not go red: the lint via went to the test runner as a test title |
| `red-hook.txt` | the edit hook said nothing for a written file with a finding |
| `review-fixes-mutations.txt` | the final tests against each review fix removed in turn: each removal fails exactly the test that owns it |
| `green-lint.txt` | `lint.test.ts` and `spec.test.ts` on the final tree: 24 pass, 0 fail, 0 skipped |

The red files were captured when each test was first written. Test titles and fixtures moved during review; the mutation file is the red evidence for the final tests.

## The witnessed refutations

`refutations.txt` stages each of the six breaks named in the bullets' `refuted:` lines, runs `coherence refute`, and restores the code: every detector went red. `run-green.txt` is the run of those six afterwards: 6 pass, refutation witnessed. Both are in the series as `.coherence/runs/lint-totality-oracle-refutations.jsonl`.

## The gate

`gate-final.txt` is the full run of the four steps on the final series: typecheck clean, 369 tests with 369 pass, 0 fail, 0 skipped, 0 rejected names, and `spec --check` with 210 invariants, 0 requirements, 0 problems.

## Real tools

`witness-real-tools.txt` runs the final Coherence against real oxlint 1.72.0 and real ruff 0.16.9 on a scratch project with one lint totality oracle each, and a listed residual excluded by each lint config:

1. `run` on the clean tree: both pass.
2. A bypass staged in each language: both `refute`s go red with the finding's file and line.
3. `PostToolUse` for each written file prints the invariant, the site, and the two honest options; the listed residual file is silent.
4. The code restored: `PostToolUse` on the fixed file is silent.
5. A half-written Python file: the ruff totality oracle reads `not run`, naming the file that did not parse.
6. `run` again: both pass with their refutations witnessed, and `spec --check` shows both as invariants.

## Applying

`apply.txt`: `git am` on `BASE` gives a tree identical to the clone's, and the series applies cleanly on top of PR 1's commit `aa2f8fb`.

`gate-on-pr1.txt` is the same four steps on that stacked tree (PR 1 at `aa2f8fb`, then this series): 372 tests with 372 pass, 0 fail, 0 skipped, 0 rejected names, and 213 invariants, 0 requirements, 0 problems.
