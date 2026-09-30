# TypeScript checker-choked rung: the linter refuses the bypass

## What this changes

A TypeScript module is visible to every file, so the compiler never refuses an import of it. A chokepoint over a module can only stand at `reference-choked` today: Coherence's own check is the enforcer, at the edit and in CI.

The project's linter can refuse the import. This PR adds that as a rung, the TypeScript mirror of Python's import-linter credit.

- **`@posthog/coherence/lint`**: an ESLint v9 API plugin named `coherence`, with one rule, `coherence/chokepoint`. oxlint loads it through `jsPlugins`:

  ```jsonc
  {
    "jsPlugins": ["@posthog/coherence/lint"],
    "rules": { "coherence/chokepoint": ["error", { "root": "." }] }
  }
  ```

- **`checker-choked` on `TYPESCRIPT_LADDER`**, between `visibility-choked` and `reference-choked`, returned through the existing `Visibility.rung` seam:

  ```ts
  { grade: "checker-choked", enforcer: "a linter the project runs", fact: "the project's oxlint configuration runs coherence/chokepoint at error, which fails the lint on any import of the protected module outside the chokepoint" }
  ```

## The rule reads the spec

There is no second declaration. The rule reads every `*.spec.md` under `root`, outside the config's `ignore`, through Coherence's own spec parser. `root` is relative to the folder the lint runs in, and defaults to that folder. The adapter reads the specs the same way, through the same module (`src/adapters/lint-guards.ts`).

- **Which bullets.** It acts on a chokepoint bullet whose `protects:` is a module path and whose `chokepoint:` is a module path or `Name in file.ts`. A bare symbol needs the language server, so it stays with Coherence's check.
- **What it reports.** It follows the check's import rulings (d-7abd1ba8):
  - an `import`, `import x = require()`, `typeof import()` or `import()` of the protected module from any file except the chokepoint's module is a bypass (`bypass`);
  - an `export … from` or `export *` of it is a re-export wherever it stands, the chokepoint's module included (`reExport`).

  A file in a test folder, or named `.test` or `.spec` (as `isTestPath` defines it with the config's test folders), is exempt.
- **Resolution.** A specifier resolves relative to the file, or through `compilerOptions.paths` in the nearest `tsconfig.json` above the file, within the root (patterns with at most one `*`). A monorepo maps one alias differently per package: in PostHog, `~/*` is `frontend/src/*` at the top and `src/*` in `nodejs/`. `.ts`, `.js`, and extensionless specifiers all resolve. The rule never uses type information.
- **Nothing is dropped in silence.** Three things are reported as `unreadableSpec` at line 1 of every linted file under the component, and never thrown:
  - a spec it cannot parse;
  - a module-form bullet whose protected module or chokepoint it cannot resolve;
  - a root with no readable `coherence.config.json`.

  A JS plugin that throws fails the whole lint. A rule run from a package folder with the wrong `root` says so; before this, it would have passed every bypass.

The messages:

```text
bypass          {{protected}} is protected by the invariant "{{invariant}}" in {{spec}}: reach it through {{chokepoint}}. Because: {{because}}
reExport        Re-exporting {{protected}} widens its reach past {{chokepoint}} (invariant "{{invariant}}" in {{spec}}). Remove the re-export.
unreadableSpec  Coherence could not read {{spec}}: {{reason}}
```

## When the rung is earned

`TypeScriptAdapter.visibility(definition, chokepoint)` returns `checker-choked` when all of these hold:

- **the rule enforces this bullet.** The rule's own reader guards this protected module with this chokepoint's module. A bare-symbol chokepoint, or a `Name in file.ts` the reader resolves to another file, earns nothing.
- **a config loads the rule.** An `.oxlintrc.json` or `.oxlintrc.*.json` under the root loads the plugin in `jsPlugins`, by its package specifier or by a path to the module.
- **the rule is an error at the top level.** That config sets `coherence/chokepoint` to error (`"error"`, `"deny"` or `2`) in its **top-level** `rules`. An override doesn't count.
- **the rule's `root` reaches the project root.** The `root` resolves from the config's folder to the project root. The config's folder is taken as the folder the lint runs in, as it is for `cd nodejs && oxlint -c .oxlintrc.nodejs.json`.
- **the config covers the module.** The config's folder holds the protected module.
- **nothing shadows it.** No nested `.oxlintrc.json` below that folder leaves the rule out. oxlint picks those up for their own subtree.

An override and a nested config each lint part of the workspace, and a chokepoint covers all of it. The enforcer names the config: `oxlint (<config>) rule coherence/chokepoint`. In every other case the adapter grades exactly as it did before.

## Refutation

The automatic refutation is unchanged: Coherence stages the sites and the check classifies them, as it does for Python's `checker-choked`. The tests witness the linter's own refusal. They run real oxlint (1.86.0, pinned as a devDependency) with the plugin on a fixture:

- red on each import form and each re-export form, including one through a nested tsconfig's alias and one inside the chokepoint's own module;
- green once they are removed;
- a helper in a test folder that imports the protected module stays green.

## Invariants

`src/adapters/Adapters.spec.md` gains three bullets, and one changes. Every break below was staged, `refute` saw the bullet's test go red, the code was restored, and a `run` witnessed it green (records in `.coherence/runs/5f0e2a41-….jsonl`):

| Bullet | Breaks staged, each red |
|---|---|
| TypeScript checker rung verified | an override counted as top-level rules; any `root` option credited; credit without the rule's guard; a nested `.oxlintrc.json` ignored |
| the lint rule follows the import rulings | aliases read from the root tsconfig only; an import-equals `require` passed over; the configured test folders not read |
| the lint rule never drops a bullet in silence | an unresolvable bullet dropped; a root without `coherence.config.json` read as empty; a spec with problems read as clean |
| ladder is adapter-defined (widened) | the checker rung dropped from the TypeScript ladder |

`docs/enforcement.md` gains a section, "TypeScript's linter rung".

## Evidence

- **Fresh clone.** On a fresh clone at `d7fc348`, `git am` applies the series. The install comes from `package-lock.json`. The whole `test` script is green:
  - typecheck;
  - `test:unit`: 366 tests, 366 passing, 0 skipped (363 before this PR);
  - `lexicon:check`;
  - `spec:check`: 10 components, 207 bullets, all 207 invariants, 0 requirements.
- **The built package in PostHog's shape.** It loads as `@posthog/coherence/lint` under oxlint 1.86.0 and under 1.72.0, the version PostHog runs. The fixture has a root `coherence.config.json`, and `nodejs/` has its own tsconfig mapping `~/*`. Lint runs as `cd nodejs && oxlint -c .oxlintrc.nodejs.json .` with `"root": ".."`. An import through `~/` goes red, and removing it goes green. Without `root`, every file is told the root holds no `coherence.config.json`.

## Limits

- **The corpus finds no chokepoint for this rung yet.** We labelled the architecture corrections human reviewers made on six months of PostHog PRs. Of those, 8 TypeScript corrections were catchable at write time, and none of the 8 is a chokepoint over a module. They are scoped bans ("ingestion must not import `~/cdp`") or paved paths over external APIs (`<button>` → `LemonButton`). The value of this PR is reach, not coverage. A chokepoint someone declares is refused by the linter, which reaches every human, every editor with the oxc extension, and CI, with no hooks installed.
- **Module-form bullets only.** The rule and the rung ignore bare symbols.
- **oxlint JSON configs only, and only their top-level `rules`.** ESLint flat configs are JavaScript and aren't read. The adapter doesn't follow `extends` and doesn't read `ignorePatterns`. It assumes oxlint runs from the config's folder. When oxlint runs from anywhere else with the wrong `root`, the rule says so in the lint, but the grade can't see it.
- **The tsconfig's own `paths` only.** The nearest `tsconfig.json`'s own `paths` are read; `extends` is not followed.
- **New specs need a restart in an editor.** The rule re-reads the specs when one it knows, or `coherence.config.json`, changes on disk. oxlint's CLI starts fresh on every run, but an editor's language server doesn't see a new spec file until it restarts.
- **oxlint's JS plugins are alpha** and are not covered by semver. The pinned devDependency is what the tests prove.
- **The `package-lock.json` entries for oxlint** were written from the registry's metadata, without npm. The review compared all 20 against the registry. pnpm reads them and installs from them (`pnpm import`, then a frozen install). `npm ci` was not run against them, and a maintainer's `npm install` may reorder them.
- **No version bump.** Whether this releases, and as which version, is yours to call.
