# Architecture as lint: what a linter can and can't express

Ticket [#107](https://github.com/Silthus/uml-pr-review/issues/107), part of map [#105](https://github.com/Silthus/uml-pr-review/issues/105). Sources were read on 2026-09-30, and versions were checked against the npm, PyPI, and crates.io registries that day. PostHog was read in place at `~/posthog` and was not modified.

## Findings

1. **Import-shaped rules are solved.** Every surveyed tool can express dependency direction, layers, and cycles. Most can also express entry points. The same three rules also cover "for X use Y" when X is a name, because each takes a per-entry message:
   - ESLint/oxlint `no-restricted-imports` and `no-restricted-properties`;
   - ruff `banned-api`;
   - clippy `disallowed_*`.
2. **The configuration is data, so one manifest can compile to it.** The data-shaped targets are:
   - ESLint/oxlint rule options, eslint-plugin-boundaries, Nx, dependency-cruiser, and Sheriff (unless `depRules` uses functions);
   - `tach.toml`, import-linter, ruff, semgrep YAML, `clippy.toml`, and `deny.toml`.

   ArchUnit, ArchUnitTS, betterer, and pylint checkers are code, so they are poor compile targets.
3. **For PostHog's TypeScript, the target is oxlint, not ESLint.** `frontend/` and `products/**` run oxlint 1.72 only, and `nodejs/` adds a legacy ESLint 8 config (#109). oxlint 1.86 loads ESLint-v9-API rules through `jsPlugins`, which is **alpha**. These rules run in the oxlint language server. eslint-plugin-boundaries runs under oxlint unmodified.
4. **Baselines exist, but they are uneven.**
   - **Count per file and rule:** ESLint bulk suppressions (v9.24.0+) and oxlint suppressions (v1.64.0+, CLI only, format may still change).
   - **Set of violations:** dependency-cruiser `--baseline`, import-linter `ignore_imports` with unmatched-ignore errors, ArchUnit `FreezingArchRule`, and semgrep `--baseline-commit`.
   - **Warnings or opt-outs only:** tach, through `deprecated`, `unchecked`, and `tach-ignore`.
5. **What no linter expresses** is the bulk of the corpus: hand-written reimplementations of an existing helper, duplication within a change, "this logic belongs in the service", split or merge, and good concept names. **"Reuse the existing helper" becomes lintable only when the helper wraps a nameable raw API.** In that case the correction is a `paved-path` rule: ban X, name Y in the message.
6. **Coherence chokepoints (#106) are the first-party version of `paved-path` and `public-entry`.** A chokepoint holds while "every reference to protected symbol P sits inside chokepoint C". They cannot protect third-party APIs. The import and API bans above cover those, for example PostHog's `dayjs` → `lib/dayjs`.
7. **A 56-row pilot of the taxonomy** on development corrections, quote-only and hand-labelled, put about 14% (population-weighted) in a declarable kind. See [Pilot](#pilot-of-the-decision-test). This number tests the rubric. It is not the coverage figure.

## Comparison table

Legend for rule kinds: **D** dependency direction, **L** layer, **E** public API or entry point, **B** banned API, **XY** "for X use Y" (per-rule message naming the replacement), **P** file placement, **N** naming, **C** cycles. "Edit-time" means the tool reports inside an editor or LSP.

| Tool (version) | Declaration | Kinds | Edit-time | Baseline | Compile target from a manifest |
|---|---|---|---|---|---|
| ESLint core `no-restricted-imports`, `-properties`, `-syntax` (eslint 10.11.0) | flat-config objects: `paths`/`patterns` (`group`, `regex`, `importNames`, `allowTypeImports`, `message`); `object`/`property` + `message`; esquery `selector` + `message` | B, XY; D, L, E by path patterns scoped with `files` | yes | bulk suppressions (below) | yes, plain data |
| oxlint (1.86.0) | `.oxlintrc.json` or `oxlint.config.ts`. Native `no-restricted-imports` and `no-restricted-properties` with the full ESLint option set, plus `import/no-cycle`. No native `no-restricted-syntax`; it arrives via the `oxlint-plugin-eslint` JS plugin | B, XY, D, L, E, C | yes (`--lsp`, VS Code). JS plugins run in the LSP. Suppressions don't yet ([#21199](https://github.com/oxc-project/oxc/issues/21199)) | `oxlint-suppressions.json` (v1.64.0+) | yes, JSON |
| eslint-plugin-boundaries (7.2.0) | settings `boundaries/elements` and `boundaries/files`, plus rule `boundaries/dependencies` with `policies[] {from, allow/disallow: {to}}` and a Handlebars `message`. v7 folded `element-types`, `entry-point`, `external`, and `no-private` into `dependencies` | D, L, E, B, XY; partial P (`no-unknown-files`); no C, no N | yes. Runs unmodified under oxlint `jsPlugins` ([PR #470](https://github.com/javierbrea/eslint-plugin-boundaries/pull/470)) | none of its own; uses ESLint/oxlint suppressions | yes |
| dependency-cruiser (18.4.0) | `.dependency-cruiser.js`: `forbidden`, `allowed`, and `required` rules with `from`/`to` `path`/`pathNot`, `circular`, `orphan`, `reachable`, `dependencyTypes` | D, L, E, B, C, orphans; XY only as a `comment` printed by the `err-long` reporter | no, CLI/CI only | `--baseline` (18.3+, `shrink-only` mode is a true ratchet), `--ignore-known` | yes |
| Nx `@nx/enforce-module-boundaries` (23.2.1) | ESLint rule options `depConstraints` (`sourceTag`, `onlyDependOnLibsWithTags`, `notDependOnLibsWithTags`, `bannedExternalImports`), plus tags in `project.json` | D, L, B (external), C (project level); fixed messages, so no XY | yes | ESLint suppressions | yes, but assumes an Nx workspace |
| Sheriff (`@softarc/*` 0.20.0) | `sheriff.config.ts`: `modules` (path → tags), `depRules` (tag → tags, or a function), `enableBarrelLess`, `entryPoints`. ESLint rules `dependency-rule`, `encapsulation`, `deep-import` | D, L, E; no B, XY, N | yes, via ESLint | none | mostly (not function rules) |
| ArchUnitTS (`archunit` 2.5.4) | fluent TS in Jest/Vitest: `projectFiles().inFolder(..).shouldNot().dependOnFiles()`, `haveNoCycles()`, `haveName()`, LCOM metrics, PlantUML adherence | D, L, C, N, metrics | no, test runner | none (no freeze equivalent) | no, code |
| ArchUnit Java (1.5.1) | fluent Java tests: `layeredArchitecture()`, `slices().beFreeOfCycles()`, PlantUML, `.because()` | D, L, E, B, XY, P, N, C | no, tests | `FreezingArchRule`, which shrinks automatically when violations are fixed | no, code |
| tach (0.35.1, now `tach-org/tach`) | `tach.toml`: `[[modules]]` `depends_on`/`cannot_depend_on`/`layer`/`utility`; `[[interfaces]] expose`; `layers`; `forbid_circular_dependencies`; `exact` | D, L, E, C; no message field | yes, `tach server` LSP (on open or save) | none that fails: `deprecated` deps warn, `unchecked`, `# tach-ignore`, `tach sync --add` | yes, TOML. Python only |
| import-linter (2.15) | `[tool.importlinter]` contracts: `forbidden`, `layers` (`containers`, `exhaustive`, `a \| b` siblings), `independence`, `protected` (2.5+), `acyclic_siblings` (2.6+) | D, L, partial E, B (modules), C, XY via `broken_contract_guidance` (2.14+) | no, CLI | `ignore_imports` with `*`/`**` plus `unmatched_ignore_imports_alerting = error`, which gives a ratchet | yes (built-in contract types) |
| ruff (0.16.9) `flake8-tidy-imports` | `banned-api` (TID251) `{"mod.name" = {msg}}`, `banned-module-level-imports` (TID253); `PLC2701` import-private-name (preview) | B, XY, E (private names) | yes, `ruff server` | `--add-noqa` comments only. No plugins ([FAQ](https://docs.astral.sh/ruff/faq/)) | yes, but repo-wide lists (scope by nested `ruff.toml`) |
| semgrep (1.178.0) | rule YAML: `pattern(s)`, `pattern-not-inside`, `metavariable-regex`, `message`, `fix`, `paths` | B, XY (shapes, not just names), P, N (regex) | yes, `semgrep lsp` | `--baseline-commit` | yes, YAML |
| clippy `disallowed-*` (Rust 1.98.1) | `clippy.toml`: `disallowed-methods`/`-types`/`-macros`/`-fields` as `{path, reason, replacement}`; `disallowed-names` | B, XY, N (exact names) | yes, when rust-analyzer `check.command = "clippy"` | `#[allow]` only | yes, TOML. No module-boundary tool worth adopting (`cargo-pup` needs nightly) |
| betterer (5.4.0 stable; `latest` is 6.0.0-alpha.1 from 2024) | `.betterer.ts` wrapping ESLint rules, with `.betterer.results` | whatever ESLint rules it wraps | no | it is a ratchet | no, code. Probably unmaintained, and superseded by native suppressions |

### Baselines, checked against current docs

- **ESLint bulk suppressions.** Introduced in **v9.24.0** (2025-04-04) ([docs](https://eslint.org/docs/latest/use/suppressions), [CHANGELOG](https://github.com/eslint/eslint/blob/main/CHANGELOG.md)). Current is 10.11.0.
  - **File and flags.** `eslint-suppressions.json` holds a count per file per rule, for rules set to `"error"` only. The flags are `--suppress-all`, `--suppress-rule`, `--prune-suppressions`, `--suppressions-location`, and `--pass-on-unpruned-suppressions` (v9.28.0).
  - **When the count drops,** the run exits non-zero until you prune.
  - **When the count rises,** every violation of that rule in that file is reported, not only the new one. The check is `violationsCount <= suppressionsCount` in [`suppressions-service.js`](https://github.com/eslint/eslint/blob/main/lib/services/suppressions-service.js).
  - **Node API.** It *applies* suppressions (`applySuppressions`, `suppressionsLocation`) since v10.1.0. Creating and pruning them is CLI only.
  - **Editor.** vscode-eslint supports suppressions through `eslint.bulkSuppression.*`.
  - PostHog's `nodejs/` pins ESLint 8.57, so it has none of this.
- **oxlint suppressions.** Merged in **v1.64.0** ([PR #19328](https://github.com/oxc-project/oxc/pull/19328)). They use `oxlint-suppressions.json` with the same count semantics, `--suppress-all`, and `--prune-suppressions`.
  - Still open: `--suppress-rule` ([#20990](https://github.com/oxc-project/oxc/issues/20990)), `--pass-on-unpruned-suppressions` ([#20991](https://github.com/oxc-project/oxc/issues/20991)), and LSP support ([#21199](https://github.com/oxc-project/oxc/issues/21199)).
  - The CLI docs page does not list the flags yet, and a maintainer says the format may change.
- **oxlint JS plugins.**
  - **Status and history.** The `jsPlugins` field was a technical preview on 2025-10-09 ([blog](https://oxc.rs/blog/2025-10-09-oxlint-js-plugins.html)). It became **alpha** on 2026-03-11 ([blog](https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha)), and is still alpha in the [docs](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) at 1.86.0. It is not covered by semver.
  - **Supported.** The ESLint v9+ rule API: selectors, scope analysis, code-path analysis, and fixes. The docs say "most existing ESLint plugins should work out of the box with Oxlint."
  - **Not supported.** Type-aware rules and custom parsers.
  - **Editor.** Runs in the language server.
  - **In PostHog.** `nodejs/.oxlintrc.nodejs.json` already loads one (#109). The root `.oxlintrc.json` has none today.

### What PostHog already declares

These are already compiled rules. The manifest should adopt them, not duplicate them.

- **tach.** `tach.toml` has 96 modules in one layer and 43 `[[interfaces]]`, mostly `expose = ["backend\\.facade.*"]`: products are reachable only through their facade. It sets no `forbid_circular_dependencies`, `exact`, or `deprecated`.
- **import-linter.** `pyproject.toml` defines five `forbidden` contracts inside products, for example "presentation must use the facade" and "facade must not import DRF". About 229 `ignore_imports` lines serve as the baseline, many marked "TODO: existing violations".
- **ruff.** `TID253` `banned-module-level-imports` for three heavy SDKs. **No `banned-api`.**
- **oxlint `no-restricted-imports`.** These are paved paths with messages:
  - `dayjs` → `lib/dayjs`;
  - `monaco-editor` → the lazy `lib/monaco/CodeEditor` facade;
  - SVG hoggies → PNG exports.

  `react/forbid-elements` adds `Spin` → `Spinner`, `a` → `Link`, `ReactMarkdown` → `LemonMarkdown`, `MonacoEditor` → `CodeEditor`, and `Space` → utility classes. It also sets `import/no-cycle` at `maxDepth` 10.
- **semgrep.** About 115 rules under `.semgrep/rules/`. The devex set encodes paved paths, for example "GitHub API calls go through egress", and uses a `# nosemgrep: <id> -- <reason>` suppression convention.
- **clippy.** `rust/cohort-stream-processor/clippy.toml` has 24 `disallowed-methods` whose `reason` points to `StoreHandle`, and the workspace denies `disallowed_methods`.
- **Frontend ratchet.** `frontend/src/lib/api-ratchet-baseline.txt` is a ratchet for the hand-written API client. It is the lintable form of the reviewer's "new endpoints should use the generated client".

## Rule-kind taxonomy for labelling corrections

This is the rubric for the corpus-coverage ticket. It sorts one correction into exactly one kind.
- Six kinds are **declarable**: a manifest could state them up front, and a linter checks them.
- Six are **judgment** kinds: they stay in review.

### Tiers

- **lintable-now**: the rule is configuration of a rule that ships today. That means an ESLint/oxlint core or published-plugin rule, ruff (preview rules included), clippy `disallowed-*`, tach, import-linter, or `import/no-cycle`. No new rule code is needed.
- **lintable-with-a-custom-rule**: the check is deterministic and can be generated from a declaration, but no shipped rule does it. It needs:
  - a manifest-driven ESLint-API rule loaded through oxlint `jsPlugins`;
  - or a semgrep rule, or a Coherence chokepoint;
  - or, for Rust, a dylint lint.
- **not-lintable**: whether the code is wrong depends on intent, meaning, or a judgment of size or cohesion.

### Two gates before any declarable kind

A correction only counts as declarable when it passes both gates. If it fails either gate, it goes to a judgment kind.

1. **Generality.** State the rule without mentioning this PR, as "in files matching G, X must not appear", "A must not import B", or "references to P only inside C". It must hold for the whole scope, and a team would plausibly write it in a manifest before the PR existed. Two counter-examples that fail: "`objectsEqual` is already imported in this file, use it" and "move these two steps next to the others".
2. **Fire and clear.** The rule flags the `before` state of the commented file and does not flag the `fix` state, judged against what the comment asks for.

### Decision order

Apply these tests in order. The first match wins.

| # | Test on one correction (quote plus fix diff) | Kind |
|---|---|---|
| 1 | The fix removes or reroutes an import, reference, or model FK from area A to area B, and "A must not depend on B" (or a layer order, or "no cycle") passes both gates. | `import-boundary` |
| 2 | The fix stops reaching into B's internals and goes through B's facade, barrel, or public (non-underscore) name. | `public-entry` |
| 3 | A concrete **name** X in the `before` code breaks the rule "X must not appear in G": an import specifier, a function or method called, a property, a JSX element, a decorator, or a macro. If the comment or fix names an **existing** replacement Y, choose `paved-path`. Otherwise choose `banned-api`. | `paved-path` / `banned-api` |
| 4 | Same as 3, but X is a **code shape**, not one name. Examples: `document.createElement('script')`, or `request.GET.get` → `int()` → 400. The shape can be written as an esquery selector or a semgrep pattern. | `paved-path` (custom-rule tier) |
| 5 | The file moves or is renamed because every file of its kind has a fixed home or name pattern. | `file-placement` |
| 6 | An identifier, file, or tool is renamed because the old term is banned throughout the scope, or a required prefix is missing. | `vocabulary` |
| 7 | The comment points to existing code that already does this, but the new code shares no nameable token with it: the author rewrote the logic by hand. | `reuse-unnamed` |
| 8 | Two or more copies of logic, schema, or a constant within the change should become one. | `duplication` |
| 9 | Behaviour should move to another layer, module, class, or file, and no general import or placement rule forbids where it is now. | `logic-placement` |
| 10 | Split something too big or mixed, or merge two things that are one concept. | `decomposition` |
| 11 | A rename for clarity where the old name is not banned elsewhere. | `concept-naming` |
| 12 | Anything else structural: data ownership, schema shape, a mechanism choice with no nameable X, or product direction. | `design-other` |

### The kinds

| Kind | Definition | Tier | Tools that express it | Corpus sub-types it draws from |
|---|---|---|---|---|
| `import-boundary` | A may not depend on B. Covers allowed-dependency lists, layer order, external-package bans for an area, and no cycles. | **now** for imports. **custom** for non-import coupling, such as a Django FK or reverse relation into another product. | tach `depends_on`/`cannot_depend_on`/`layers`/`forbid_circular_dependencies`; import-linter `forbidden`/`layers`/`independence`/`acyclic_siblings`; `no-restricted-imports` `patterns` scoped by `files`/`overrides`; boundaries `dependencies`; Nx `depConstraints`/`bannedExternalImports`; dependency-cruiser; `import/no-cycle`; cargo-deny (crate level) | dependency, some layer |
| `public-entry` | Outside B, use only B's declared entry point or public names. | **now** for imports. **custom** for attribute access to internals, such as `schema.sync_type_config`. | tach `[[interfaces]] expose`; import-linter `protected`; boundaries `dependencies` with internal path; Sheriff `encapsulation`/`deep-import`; `no-restricted-imports` negated patterns; ruff `PLC2701` (preview); Coherence chokepoint (first-party symbols) | facade-boundary |
| `banned-api` | X must not be used in G, and no replacement is named. | **now** when X is a name | `no-restricted-imports`/`-properties`/`-globals`, `react/forbid-elements`; ruff `banned-api` (TID251), TID253; clippy `disallowed-*`; cargo-deny `[bans]`; semgrep | other, dependency |
| `paved-path` | "For X use Y": a `banned-api` whose message names the **existing** replacement Y. This is the lintable form of "reuse the existing helper", and applies when Y wraps a raw X that can be named. | **now** when X is a name, since every rule above takes `message`/`msg`/`reason` (clippy also `replacement`). **custom** when X is a code shape: `no-restricted-syntax` via `oxlint-plugin-eslint`, semgrep, or a JS-plugin rule. For a first-party X, a Coherence chokepoint also expresses it; Coherence cannot protect third-party X such as `dayjs`. | as listed | reuse, other |
| `file-placement` | Files of kind K live under D and match pattern P. | **custom** (partly **now** with boundaries `no-unknown-files`) | boundaries elements; Sheriff tags; semgrep `paths`; manifest-driven rule | some layer, some naming |
| `vocabulary` | Term T is banned in identifiers, file names, or tool names in G, or a required prefix is missing. | **now** only for exact identifiers (`id-denylist`, clippy `disallowed-names`). **custom** for substrings, prefixes, file names, or YAML tool names. | `id-denylist`, `id-match`; semgrep `metavariable-regex`; manifest-driven rule | naming |
| `reuse-unnamed` | The author rewrote existing logic by hand, with no shared token to ban. | **not-lintable** | clone detection can suggest candidates only | reuse |
| `duplication` | Copies within the change. | **not-lintable** | clone detectors (jscpd, pylint `duplicate-code`) are noisy thresholds, not declared rules | duplication |
| `logic-placement` | This behaviour belongs elsewhere. | **not-lintable**. A narrow slice passes both gates as a file-scoped `banned-api`, such as "no ORM queries in `views.py`"; label that as `banned-api`. | none | layer |
| `decomposition` | Split or merge. | **not-lintable** | `max-lines`, `complexity`, ruff `C901`/`PLR0915` are size proxies and don't state the fix | split-merge |
| `concept-naming` | Choose a better name. | **not-lintable** | none | naming |
| `design-other` | Data ownership, schema shape, or mechanism choice. | **not-lintable** | none | other |

### When "reuse the existing helper" becomes lintable

A reuse correction is `paved-path` only when the helper Y **wraps something nameable**, and that something is the thing the author used instead. Examples:
- raw `dayjs` → `lib/dayjs`, and `MonacoEditor` → `CodeEditor`, which PostHog already bans;
- hand-written `ApiRequest` helpers → the generated client, which PostHog ratchets with a baseline file;
- `navigator.clipboard.writeText` → `copyToClipboard`;
- a GitHub HTTP call → the egress wrapper, which PostHog's semgrep already covers.

Rule of thumb: if you can ban the token the author typed without banning legitimate code, the correction is lintable. If the author re-derived Y's logic from scratch (for example, "this reimplements `fullName` from `lib/utils`"), there is no token to ban, so the correction is `reuse-unnamed`.

Adopting a new paved path needs a baseline: ESLint or oxlint suppressions, or import-linter `ignore_imports`.

## Pilot of the decision test

The sample is 7 development corrections per sub-type (56 of the 534), drawn by ranking on `sha256("107:" + id)`. I labelled them from the quote and path only, without reading the diffs, so this is a check that the rubric can be applied, not a measurement.

| Sub-type (dev, isolable) | Sample: declarable (tier) | Examples |
|---|---|---|
| dependency (9) | 5 of 7: 4 now, 1 custom | "no domain reason for `feature_flags` to depend on `tasks`" (tach); "hog-charts shouldn't know anything about chart.js" (`no-restricted-imports`); `related_name='+'` on a cross-product FK (custom) |
| facade-boundary (10) | 3 of 7, now | three "private functions imported across modules" (ruff `PLC2701`) |
| naming (45) | 4 of 7, custom | "get rid of these Max names", `slack-app-*` and `logs-*` tool prefixes, folder name = pipeline name |
| other (71) | 2 of 7, now | "install via npm instead of loading external JS" twice (`no-restricted-syntax` on script injection) |
| reuse (140) | 1 of 7, now | "new endpoints should use the generated client" |
| layer (98), duplication (115), split-merge (46) | 0 of 21 | all judgment kinds |

Weighting each sub-type by its development count gives about **77 of 534, about 14%, declarable**. Most of them come from naming, other, and reuse, because those sub-types are large. Treat this as a prior for the coverage ticket, not a result. Four biases apply:
- the sample is small;
- the labels come from quotes only;
- there is a single labeller;
- the generality gate was applied generously for naming.

## Sources

- **ESLint:** [suppressions](https://eslint.org/docs/latest/use/suppressions), [`no-restricted-imports`](https://github.com/eslint/eslint/blob/main/docs/src/rules/no-restricted-imports.md), [`no-restricted-syntax`](https://github.com/eslint/eslint/blob/main/docs/src/rules/no-restricted-syntax.md), [`no-restricted-properties`](https://github.com/eslint/eslint/blob/main/docs/src/rules/no-restricted-properties.md), [CHANGELOG](https://github.com/eslint/eslint/blob/main/CHANGELOG.md), [vscode-eslint README](https://github.com/microsoft/vscode-eslint/blob/main/README.md).
- **oxlint:** [JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html), [alpha post](https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha), [rule sources](https://github.com/oxc-project/oxc/tree/main/crates/oxc_linter/src/rules/eslint), [suppressions PR](https://github.com/oxc-project/oxc/pull/19328).
- **eslint-plugin-boundaries:** [rules](https://www.jsboundaries.dev/docs/rules/), [policies](https://www.jsboundaries.dev/docs/policies/).
- **dependency-cruiser:** [rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md), [CLI](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md).
- **Nx:** [enforce-module-boundaries source](https://github.com/nrwl/nx/blob/master/packages/eslint-plugin/src/rules/enforce-module-boundaries.ts).
- **Sheriff:** [dependency rules](https://github.com/softarc-consulting/sheriff/blob/main/docs/docs/dependency-rules.md).
- **ArchUnit:** [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS), [ArchUnit user guide](https://www.archunit.org/userguide/html/000_Index.html).
- **betterer:** [docs](https://phenomnomnominal.github.io/betterer/docs/introduction/index).
- **tach:** [configuration](https://docs.gauge.sh/usage/configuration), [interfaces](https://docs.gauge.sh/usage/interfaces), [deprecate](https://docs.gauge.sh/usage/deprecate), [repo](https://github.com/tach-org/tach).
- **import-linter:** [contract types](https://github.com/seddonym/import-linter/tree/master/docs/contract_types), [release notes](https://github.com/seddonym/import-linter/blob/master/docs/release_notes.md).
- **ruff:** [linter](https://docs.astral.sh/ruff/linter/), [FAQ](https://docs.astral.sh/ruff/faq/), [`PLC2701`](https://docs.astral.sh/ruff/rules/import-private-name/).
- **semgrep:** [rule syntax](https://docs.semgrep.dev/writing-rules/rule-syntax), [CLI](https://docs.semgrep.dev/cli-reference).
- **Rust:** [clippy configuration](https://doc.rust-lang.org/clippy/lint_configuration.html), [rust-analyzer configuration](https://rust-analyzer.github.io/book/configuration.html), [cargo-deny bans](https://embarkstudios.github.io/cargo-deny/checks/bans/cfg.html).
- **Related tickets:** #106 (Coherence chokepoints), #108 (mid-build lint feedback), #109 (PostHog enforcement inventory).
