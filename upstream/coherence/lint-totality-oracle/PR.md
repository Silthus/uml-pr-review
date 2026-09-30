# A lint rule as a totality oracle's detector

## Context

Thanks for Coherence, and for writing `docs/retired.md` so clearly. This PR builds on one line in it: a known residual "becomes a totality oracle whose named set excludes a listed residual". It lets that totality oracle's detector be a rule the project's linter already runs.

We labelled 534 architecture corrections that human reviewers made on PostHog PRs (the development split of our corpus). The ones a linter could have caught at write time are almost never a chokepoint over a project thing. They are **scoped bans** ("`nodejs/src/ingestion` must not import `~/cdp`", where `~/cdp` has several legitimate importers elsewhere) and **paved paths over external APIs** (`loginas.utils.is_impersonated_session` → `is_impersonated`, `os.environ` → settings). A chokepoint always covers the whole workspace and never protects a package, so neither fits `protects:`. Both are already data in a lint config: `no-restricted-imports` in oxlint, `TID251` banned-api in ruff.

## The obvious objection: isn't this a lint-sink?

No. A lint-sink counts known findings and fails only when the count grows. It was retired for good reasons, and this PR brings none of it back:

- **No count, no stored list, no ratchet.** Any finding of the named rule is a fail. A new finding and an old one read the same.
- **Total over a named set.** The set is the lint config's own. What the config excludes (its ignore patterns, its per-file ignores) **is** the listed residual, and the bullet's `over:` names the same files. The default is still to fix before declaring.
- **Refuted red, then green**, exactly like a test-backed totality oracle: stage a finding, `refute` must go red, restore, `run` must go green. A rule the config never enables can't pass that.
- **A run that proved nothing never reads like a clean one.** It is `not run`, never a pass, when the tool is not configured, can't start, or writes a report that isn't its format; when the tool says it linted no file of the project; and when a file didn't parse, because a linter checks no rule in a file it can't parse.

Lifecycle, grades, and the state derivation are unchanged.

## What it looks like

```markdown
- ingestion never reaches cdp: Ingestion code depends on CDP only through the interfaces in ~/common.
  over: every non-test import under nodejs/src/ingestion except the listed residual: legacy/replay.ts
  via: lint oxlint:no-restricted-imports matching "~/cdp"
  because: ingestion and CDP deploy apart, and a direct import couples their releases
  kinds: none
```

```json
"lint": {
  "oxlint": { "command": ["pnpm", "exec", "oxlint", "-c", "nodejs/.oxlintrc.nodejs.json", "--format", "json"], "format": "oxlint-json" },
  "ruff": { "command": ["ruff", "check", "--force-exclude", "--output-format", "json"], "format": "ruff-json" }
}
```

`matching` filters on the diagnostic's message, because one rule id carries many patterns. For oxlint that is the message plus its help, since oxlint puts the config's own `message` in `help`.

## What changes

- **Grammar** (`src/spec/grammar.ts`): only the value of `via:` grows, to `lint <tool>:<rule>` or `lint <tool>:<rule> matching "<text>"`. A value that begins with `lint` and doesn't read in that form is a spec problem with its line, never taken as a test title.
- **Config** (`src/enforcement/config.ts`): a `lint` key, one entry per tool: an argv `command` and a `format`, `oxlint-json` or `ruff-json`. A malformed entry, or a tool name a via can't write, throws like a bad `testMatch` does.
- **One module, three callers** (`src/enforcement/lint.ts`): `lintTotalityOracles(root, config, vias, files?)` runs each tool once, however many bullets name it, reads its report in the tool's format, and keeps the findings of each named rule by any id the tool gives it (`eslint(no-restricted-imports)`, `no-restricted-imports`, `eslint/no-restricted-imports`; `TID251`, `banned-api`). `lintTotalityOracle` is the one-via form.
  - `run`: the totality pass runs it over the whole project. A lint via never reaches the batched test invocation or the observation, and its entry records no test mode.
  - `refute`: unchanged. It asks the same pass through `performRun`.
  - `PostToolUse`: each tool runs once, on the written files it lints (oxlint the JavaScript and TypeScript kinds, ruff Python), within 20 s so a slow linter never outlasts the host's 60 s hook timeout and takes the chokepoint re-check down with it. A finding is printed in the hook's existing shape: the invariant, the site with the tool's message, and the two honest options. A clean file, a file in the listed residual, and a file no linter reads say nothing. It appends no run, because the written files are not the set the totality oracle is total over.
- **Docs**: `docs/spec.md` (the form), `docs/enforcement.md` (the config, the verdicts, the listed residual, the edit), and one line in the README's config step.
- **Spec bullets** for the new form, each refuted red then green with a refutation record in `.coherence/runs/lint-totality-oracle-refutations.jsonl`:
  - `src/spec`: a lint via reads in one form
  - `src/enforcement`: a lint rule is a totality oracle's detector; a lint tool not configured never passes; each lint format reads its tool's own report; a lint via never reaches the test runner
  - `src/lifecycle`: lint revelation at the edit

## How it's tested

`src/enforcement/lint.test.ts` runs outside in: `lintTotalityOracle`, `refute`, `performRun`, and `runHook`. The two format readers read output **recorded from real tools**, oxlint 1.72.0 and ruff 0.16.9, in `src/enforcement/lint-recordings/`: a project with a bypass, the same project fixed, one file, a file in the listed residual, a run that linted no file, and a file cut off mid-edit. The fixture writes the same files the recordings came from, and its lint command replays the recording for the paths it's handed, so a scoped check proves the right file was handed over. A test that changes the tree swaps the recording with it. The grammar test sits beside the others in `src/spec/spec.test.ts`.

Outside the suite, the same commit ran end to end against real oxlint and real ruff on a scratch project: both totality oracles refuted red with the break staged, the edit hook printed the invariant and site for each written file and stayed silent on the listed residual and on a clean file, a half-written Python file made the ruff one read `not run`, and the run went green with both refutations witnessed.

The four steps of `npm test` (typecheck, `test:unit`, `lexicon:check`, `spec --check`) are green: 210 invariants, 0 requirements, 0 problems.

## Trade-offs and decisions

- **`lint` at the start of a `via` is now reserved.** A test titled "lint …" becomes a spec problem instead of silently running as a lint detector or as a test. We think a loud problem beats a guess.
- **The command must honour its own exclusions for files it's handed.** oxlint does. ruff does only with `--force-exclude`, so the docs' example carries it. Without it, the edit hook would report a finding in a listed-residual file.
- **ruff doesn't always say it linted nothing.** oxlint reports `number_of_files`, so a whole-project oxlint run over no file is `not run`. ruff reports no count and warns "No Python files found" only sometimes (it stayed silent in a folder holding only a `pyproject.toml`); the warning makes it `not run`, and without it a ruff command aimed at the wrong folder still reads as a pass. The refutation catches that case once: a detector that looks at nothing can't go red.
- **A plain `lint?` field, not a discriminated detector type.** A required `detector` on every totality oracle would touch four unrelated constructors in scaffold, economy, and the Scope reading. The test that a lint via never reaches the test runner fails if one leaks.
- **The matching text can't hold a double quote.** No rule message we've seen needs one.
- **Only two formats.** semgrep and import-linter fit the same seam when someone asks for them.
- **No drift check** between `over:` and the lint exclusion. Review keeps the two lists together.
- **Six lines of trailing whitespace** in the oxlint recordings: `git am` warns about them. They're kept byte for byte as oxlint printed them.
- **The committed refutation run** names the commit it ran at in our clone. After `git am`, that hash is not in your history, as for any record made on a branch.
- **This is independent of the TypeScript `checker-choked` rung PR.** Either can land first, and together they pass the same four steps.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
