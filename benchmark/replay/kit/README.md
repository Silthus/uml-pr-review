# Dogfood kit

Builds a patched Coherence and a one-language PostHog worktree under `/tmp`, witnesses an invariant's enforcer red then green, and removes it all again. `~/posthog` is only read: the kit adds and removes a `git worktree`, and fetches missing refs into `refs/uml-pr-review/*`, which teardown deletes.

## Commands

```sh
bun benchmark/replay/kit/setup.ts /tmp/replay-64506 --ref <posthog-ref> --language typescript --hooks
export COHERENCE_HOME=/tmp/replay-64506/coherence
bun benchmark/replay/kit/witness.ts /tmp/replay-64506 "nodejs/src/ingestion/ingestion never reaches cdp"
bun benchmark/replay/kit/teardown.ts /tmp/replay-64506
```

- `--ref` is anything `~/posthog` resolves (`master`, a sha). A ref it lacks, such as `pull/64506/head` or a merge-base sha, is fetched over HTTPS from `github.com/PostHog/posthog` into `refs/uml-pr-review/<ref>`.
- `--language python` writes a ruff lint entry and leaves the oxlint config alone.
- Leave out `--hooks` for the control arm.

## What setup writes

`<dir>/coherence` is `PostHog/coherence` at `BASE` with `upstream/coherence/ts-checker-rung` then `upstream/coherence/lint-totality-oracle` applied by `git am`, installed with `bun install --ignore-scripts`.

`<dir>/posthog` is the worktree, with:

- `node_modules` and `nodejs/node_modules` symlinked to `~/posthog`'s;
- `coherence.config.json` for one language, whose `lint` entry is `~/posthog/node_modules/.bin/oxlint -c nodejs/.oxlintrc.nodejs.json --format json nodejs`, or `uvx ruff@<uv.lock pin> check --force-exclude --output-format json`;
- for TypeScript, `nodejs/.oxlintrc.nodejs.json` rewritten as plain JSON: `typeAware` off, `reportUnusedDisableDirectives` dropped, `ignorePatterns` anchored at the repository root, and the `coherence/chokepoint` rule loaded from `<dir>/coherence/src/adapters/lint.ts` with `root` set to the worktree;
- with `--hooks`, the Claude hooks from `hooks install --host claude`, in the worktree's own `.claude/settings.json`.

Declaring the invariant (the spec and the lint config entry that detects it) is the caller's job, in the worktree, before witnessing.

## Witness

`witness.ts <dir> <component>/<invariant>` stages `kitWitnessBypass.ts` or `kit_witness_bypass.py` in the component folder, requires the enforcer to go red, removes the file, requires `run --invariant` to pass, and prints both outputs. It exits 1 unless both hold.

| Bullet | Staged bypass | Red means |
|---|---|---|
| `protects: X in file.py` or a module path | an import of the protected thing | `run` reports the invariant failing |
| `via: lint oxlint:no-restricted-imports matching "<text>"` | `import "<text>";` | `refute` goes red |
| `via: lint ruff:TID251 matching "<text>"` | an import of the banned API in `pyproject.toml` whose path contains `<text>` | `refute` goes red |

## Deviations the real runs forced

- oxlint reads a config's `ignorePatterns` relative to the folder it runs in. Coherence runs the lint from the repository root, so the kit re-anchors them at `nodejs/`, and lints `nodejs` only: over the whole repository, 663 frontend files do not parse under the nodejs config, and the totality oracle reads `not run`.
- With `typeAware` off, disable directives for type-aware rules go unused, and oxlint reports them without a rule id. The lint totality oracle reads such a diagnostic as a file that did not parse, so the kit drops `reportUnusedDisableDirectives`.
- PostHog's ruff config does not select `TID251`. A ruff totality oracle needs `extend-select = ["TID251"]` beside its `banned-api` entry.
- Files under `products/` have their own ruff config, so a root `per-file-ignores` entry does not list them as residual. Fix them before declaring.

## Timings on `~/posthog` master

Setup 6.2 s, witness 7.5 s (TypeScript) and 5.0 s (Python), teardown 1.0 s, one oxlint run over `nodejs/src/ingestion/pipelines` 1.4 s. The logs are in `docs/proof/117-dogfood-kit/`.
