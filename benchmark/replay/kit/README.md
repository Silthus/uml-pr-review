# Dogfood kit

Builds a patched Coherence and a one-language PostHog worktree under `/tmp`, witnesses an invariant's enforcer red then green, and removes it all again. `~/posthog` is only read. The kit adds and removes a `git worktree` with PostHog's git hooks turned off, and it fetches missing refs into `refs/uml-pr-review/*`, which teardown deletes.

## Commands

```sh
bun benchmark/replay/kit/setup.ts /tmp/replay-64506 --ref <posthog-ref> --language typescript --hooks
export COHERENCE_HOME=/tmp/replay-64506/coherence
bun benchmark/replay/kit/witness.ts /tmp/replay-64506 "nodejs/src/ingestion/ingestion never reaches cdp"
bun benchmark/replay/kit/teardown.ts /tmp/replay-64506
```

- `--ref` is anything `~/posthog` resolves (`master`, a sha). A ref it lacks, such as `pull/64506/head` or a merge-base sha, is fetched over HTTPS from `github.com/PostHog/posthog` into `refs/uml-pr-review/<ref>`.
- `--language python` writes a ruff lint entry and leaves the oxlint configs alone.
- Leave out `--hooks` for the control arm.
- If setup fails, it tears down what it built: the worktree, the fetched ref, and the folder.

## What setup writes

`<dir>/coherence` is `PostHog/coherence` at `BASE`, with `upstream/coherence/ts-checker-rung` and then `upstream/coherence/lint-totality-oracle` applied by `git am`. It is installed with `bun install --ignore-scripts`.

`<dir>/kit.json` records the PostHog checkout, the language, and any fetched ref.

`<dir>/posthog` is the worktree, with:

- `node_modules` and `nodejs/node_modules` symlinked to `~/posthog`'s;
- `coherence.config.json` for one language. Its `lint` entry is `~/posthog/node_modules/.bin/oxlint -c nodejs/.oxlintrc.nodejs.json --format json nodejs` for TypeScript, or `uvx ruff@<uv.lock pin> check --force-exclude --output-format json` for Python;
- for TypeScript, `nodejs/.oxlintrc.nodejs.json` rewritten as plain JSON:
  - `typeAware` off and `reportUnusedDisableDirectives` dropped;
  - `ignorePatterns` anchored at the repository root;
  - the `coherence/chokepoint` rule loaded from `<dir>/coherence/src/adapters/lint.ts`, with `root` set to the worktree.

  The rule is also added to every nested `.oxlintrc.json` under `nodejs/`. Without it, a nested config shadows the rule and the chokepoint rung is not credited;
- with `--hooks`, the Claude hooks from `hooks install --host claude`, in the worktree's own `.claude/settings.json`.

Declaring the invariant is the caller's job: write the spec and the lint config entry that detects it in the worktree before witnessing.

## Witness

`witness.ts <dir> <component>/<invariant>` stages a bypass in the component folder: `kitWitnessBypass.ts` or `kit_witness_bypass.py`, never overwriting a file already there. It requires the enforcer to go red, removes the file, requires the enforcer to go green, and prints both outputs. It exits 1 unless both hold. The target's name may contain `/`: the kit takes the component folder whose spec declares the rest as a bullet under `## invariants`.

| Bullet | Staged bypass | Red | Green |
|---|---|---|---|
| TypeScript chokepoint (`protects:` a module) | an import of the protected module | oxlint's `coherence/chokepoint` flags the staged file | no `coherence/chokepoint` finding in the component |
| Python chokepoint (`protects: X in file.py`) | `from <module> import X` | `run --invariant` fails | `run --invariant` passes |
| `via: lint oxlint:no-restricted-imports matching "<text>"` | `import "<text>";` | `refute` goes red | `run --invariant` passes |
| `via: lint ruff:TID251 matching "<text>"` | an import of the API in `pyproject.toml`'s `banned-api` that is `<text>`, ends in `.<text>`, or is the only one containing it | `refute` goes red | `run --invariant` passes |

## What the real runs found

- **oxlint's ignore patterns.** oxlint reads a config's `ignorePatterns` relative to the folder it runs in. Coherence runs the lint from the repository root, so the kit re-anchors the patterns at `nodejs/` and lints `nodejs` only. Over the whole repository, 663 frontend files do not parse under the nodejs config, and the totality oracle reads `not run`.
- **Unused disable directives.** With `typeAware` off, disable directives for type-aware rules go unused, and oxlint reports them without a rule id. The lint totality oracle reads such a diagnostic as a file that did not parse, so the kit drops `reportUnusedDisableDirectives`.
- **The nested sidecar config.** `ml-mirror-image-scrub-sidecar/.oxlintrc.json` shadows the rule. Once the kit adds the rule there too, Coherence grades a module chokepoint in `nodejs/` as `checker-choked`.
- **Coherence's own run on a TypeScript module chokepoint.** In PostHog, that run reads `not run`: "`group-logging.ts` exports nothing, so no document can reference it". The linter is the enforcer the witness checks, so the witness doesn't wait on that run.
- **ruff's `TID251`.** PostHog's ruff config does not select `TID251`. A ruff totality oracle needs `extend-select = ["TID251"]` beside its `banned-api` entry.
- **ruff configs under `products/`.** Files under `products/` have their own ruff config, so a root `per-file-ignores` entry doesn't list them as a residual. Fix them before declaring.

## Timings on `~/posthog` master

| | TypeScript | Python |
|---|---|---|
| setup | 7.3 s | 7.1 s |
| witness | 8.8 s for a lint totality oracle, 4.6 s for a chokepoint | 5.5 s |
| teardown | 0.9 s | 1.0 s |

One oxlint run over `nodejs/src/ingestion/pipelines` takes 1.5 s. The logs are in `docs/proof/117-dogfood-kit/`.
