# Upstream PR 2: a lint rule as a totality oracle's detector

A `git format-patch` series for [PostHog/coherence](https://github.com/PostHog/coherence), prepared for [#116](https://github.com/Silthus/uml-pr-review/issues/116) under the [#111 spec](https://github.com/Silthus/uml-pr-review/issues/111#issuecomment-5909390457), section "PR 2". Nothing is pushed or opened upstream.

| File | What |
|---|---|
| `BASE` | the Coherence commit the series applies to |
| `0001-…patch` | the grammar: `via: lint <tool>:<rule>[ matching "<text>"]` |
| `0002-…patch` | the `lint` config, `lintTotalityOracles`, the run, refute, and the edit hook |
| `0003-…patch` | the refutation record that witnesses the six new bullets red, then green |
| `PR.md` | the drafted PR body |
| `proof/` | the commands and their output ([proof/README.md](proof/README.md)) |

## Open the PR

```sh
git -C ~/dev/coherence checkout -b lint-totality-oracle "$(cat BASE)"
git -C ~/dev/coherence am ~/dev/uml-pr-review/upstream/coherence/lint-totality-oracle/*.patch
```

`git am` warns about trailing whitespace in six lines. They are in the oxlint recordings, which are kept byte for byte as oxlint 1.72.0 printed them.

## With PR 1

The series applies cleanly on `BASE` alone, and on top of PR 1 (the TypeScript `checker-choked` rung, #115) as it stood at its commit `aa2f8fb`: no hunk conflicts, so the kit can apply PR 1 then PR 2. The two share only `docs/enforcement.md`, where their hunks are apart. Each adds its own `lint.ts`: PR 1 in `src/adapters/` (the `coherence/chokepoint` rule), PR 2 in `src/enforcement/` (the totality oracle's detector). `proof/apply.txt` has the check, and `proof/README.md` the gate on the stacked tree.

## Deviations from the spec

- The module's functions are `lintTotalityOracles` (every lint via, each tool run once) and `lintTotalityOracle` (one via), not `lintOracle`. Coherence's own lexicon check rejects the bare word "oracle" as an identifier token (it was the reference implementation's name for the totality oracle), and its `test` script fails on it.
- The ruff command in the config example carries `--force-exclude`. Without it, ruff lints a file it is handed even when its config excludes it, so the edit hook would report a finding in a listed-residual file.
- The edit hook hands each tool only the written files it lints and gives the linters 20 s, inside the installed hook's 60 s timeout.

## For the kit

- oxlint 1.72.0's `no-restricted-imports` pattern `~/cdp/*` does not match `~/cdp/hog-transformations/hog-transformer.service`. `["~/cdp", "~/cdp/**"]` does.
- oxlint puts a restriction's own `message` in the diagnostic's `help`; `matching` reads both.
