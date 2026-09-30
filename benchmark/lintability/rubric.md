# Lintability rubric: could a manifest plus a linter have caught this correction at write time?

You label one architecture correction at a time: a human reviewer's comment on a merged PostHog pull request, the diff of the commit that fixed it, and the `before` commit that the fix was applied to. The question is whether a rule that a team would declare **up front**, in a small per-product manifest compiled into a linter, would have flagged the code **while the author wrote it**, so the reviewer would not have had to.

The taxonomy is ticket #107's (`docs/research/architecture-as-lint.md` on branch `research/architecture-as-lint`). Its kind names are used verbatim.

## Step 1: pick exactly one kind, first match wins

| # | Test on the correction (comment plus fix diff) | Kind |
|---|---|---|
| 1 | The fix removes or reroutes an import, reference, or model FK from area A to area B, and "A must not depend on B" (or a layer order, or "no cycle") passes the gates. | `import-boundary` |
| 2 | The fix stops reaching into B's internals and goes through B's facade, barrel, or public (non-underscore) name. | `public-entry` |
| 3 | A concrete **name** X in the `before` code breaks the rule "X must not appear in G": an import specifier, a function or method called, a property, a JSX element, a decorator, a macro. If the comment or fix names an **existing** replacement Y, choose `paved-path`, otherwise `banned-api`. | `paved-path` / `banned-api` |
| 4 | Same as 3, but X is a **code shape**, not one name, that an esquery selector or a semgrep pattern can match. | `paved-path` |
| 5 | The file moves or is renamed because every file of its kind has a fixed home or name pattern. | `file-placement` |
| 6 | An identifier, file, or tool is renamed because the old term is banned throughout the scope, or a required prefix is missing. | `vocabulary` |
| 7 | The comment points to existing code that already does this, but the new code shares no nameable token with it: the author rewrote the logic by hand. | `reuse-unnamed` |
| 8 | Two or more copies of logic, schema, or a constant within the change should become one. | `duplication` |
| 9 | Behaviour should move to another layer, module, class, or file, and no general import or placement rule forbids where it is now. A narrow slice passes the gates as a file-scoped ban, for example "no ORM queries in `views.py`"; label that `banned-api`. | `logic-placement` |
| 10 | Split something too big or mixed, or merge two things that are one concept. | `decomposition` |
| 11 | A rename for clarity where the old name is not banned elsewhere. | `concept-naming` |
| 12 | Anything else structural: data ownership, schema shape, a mechanism choice with no nameable X, or product direction. | `design-other` |

When a candidate rule fails a guard and no judgment kind fits well, choose the one that describes what the reviewer asked for, and `design-other` when none does.

Use `none` only when the comment is not an architecture correction at all (the corpus classifier was wrong). The six **declarable** kinds are `import-boundary`, `public-entry`, `banned-api`, `paved-path`, `file-placement`, `vocabulary`. The other six are **judgment** kinds and are always `catchable: "no"`.

A declarable kind is only reached when the correction passes the guards below. If a candidate rule fails any guard, fall through the table to the judgment kind the correction really is (usually `reuse-unnamed`, `logic-placement`, `duplication`, or `design-other`), and record the guard that failed.

## Step 2: the four honesty guards

Hindsight is the main risk: any correction can be "caught" by a rule written after the fact for exactly that PR. Evaluate every guard for the best rule you can state, even when the answer ends up `no`.

1. **`general`.** State the rule without mentioning this PR: "in files matching G, X must not appear", "A must not import B", "references to P only inside C", "files of kind K live under D". It holds for the whole scope G, it applies beyond this PR, and a team would plausibly write it in a manifest before the PR existed. Fails: "`objectsEqual` is already imported in this file, use it"; "move these two steps next to the others"; a rule whose scope is one file the PR created; a style nit a team would not declare (for example "prefer dayjs over `Date` here").
   - Existing violations at `before` do **not** fail `general`: adopting any rule comes with a baseline for them. Judge whether a team would write the rule, not whether the code already obeys it.
   - Established conventions pass: design-system elements (`LemonButton` over `<button>`), the product facade, a paved path the codebase already uses in most places, common hygiene and security rules (no script injection, no private imports across modules).
2. **`existed`.** Whatever the rule points to already existed at the `before` commit: the helper Y to reuse, the facade to route through, the module whose boundary is protected, the home directory for the file. **Check it in the code at `before`**, do not assume it. Use only these read-only commands: `cd /home/coder/posthog && git show <before>:<path>`, `git grep -n '<token>' <before> -- '<pathspec>'`, `git ls-tree -r --name-only <before> -- '<dir>'`. Never run any other git command there, never check out, fetch, or write. `n/a` when the rule points to nothing (a plain `banned-api`, an `import-boundary` without a replacement, a `vocabulary` ban). Fails when the replacement was introduced by the same PR or the fix itself. When Y existed but had to be extended to cover this case, `existed` passes and the correction is at most `partial`.
3. **`syntactic`.** A linter decides it from syntax or import resolution alone: an import path, a called name, a property access, a JSX element, a decorator, an AST shape matchable by esquery or semgrep, a file path pattern, an identifier pattern. Fails when deciding needs judgment of meaning, intent, size, cohesion, naming quality, or whether two pieces of logic are "the same".
4. **`firesAndClears`.** The rule flags the `before` state of the commented file and does not flag the state the comment asks for. Judge against the comment's request, not only the located fix commit, which is sometimes the wrong commit. Fails when the rule would not fire on the `before` code or would still fire after a correct fix. Judge at the commented site only: other occurrences in the same file are baseline, not a failure. When the located fix commit does not address the comment, judge against the comment and still check `existed` at `before`.

## Step 3: catchable

- **`yes`**: a declarable kind, and all four guards pass (`existed` may be `n/a`). The rule alone would have told the author what the reviewer told them.
- **`partial`**: a declarable kind, all four guards pass for the part the rule covers, but the correction asks for more than the rule states. Example: a `paved-path` ban on raw `fetch` in logics fires and names `api.*`, but the reviewer also asked to move the call into a loader.
- **`no`**: a judgment kind, or any guard fails. `tool` is `review-only`. For a judgment kind with no candidate rule at all, record `general: "fail"`, `syntactic: "fail"`, `existed: "n/a"`, `firesAndClears: "n/a"`.

When unsure between `yes` and `partial`, choose `partial`. When unsure between `partial` and `no`, choose `no`. The number this produces is quoted as an upper bound for the linter, so err towards review.

## Step 4: tier and tool

Tier, by the taxonomy:

- `lintable-now`: configuration of a rule that ships today (ESLint/oxlint core or published plugin rules such as `no-restricted-imports`, `no-restricted-properties`, `react/forbid-elements`, `import/no-cycle`, eslint-plugin-boundaries; ruff incl. preview rules such as `banned-api` TID251 and `PLC2701`; clippy `disallowed-*`; tach; import-linter).
  oxlint's native `no-restricted-imports` and `no-restricted-properties` count as now; `no-restricted-syntax` does not ship natively in oxlint, so a code-shape rule is custom.
- `lintable-with-a-custom-rule`: deterministic and generatable from a declaration, but needs a manifest-driven ESLint-API rule loaded through oxlint `jsPlugins`, a semgrep rule, a Coherence chokepoint, or a dylint lint.
- `not-lintable`: every `no`.

Tool, choosing the first that can express the rule for the file's language:

- TypeScript or JavaScript: `oxlint` (native rules, or an ESLint-API rule through `jsPlugins`, which covers every custom rule). Use `eslint` only for a rule oxlint cannot run, such as a type-aware rule.
- Python: `tach` (module dependencies and `[[interfaces]]` facades), `import-linter` (layers, forbidden and protected contracts), `ruff` (banned APIs and private-name imports), `semgrep` (code shapes, file-scoped bans, paths, identifier regexes).
- Rust: `clippy`.
- Anything else (YAML workflows, SQL, Dockerfiles, configuration): `semgrep`.
- `coherence`: only when the rule is "every reference to first-party symbol P goes through C" and none of the above expresses it for that language.
- `review-only`: every `no`.

## Step 5: the rule sketch

`ruleSketch` is one line, at most 200 characters, that a team could paste into a manifest, naming scope, the banned thing, and the replacement: `products/workflows/frontend may not import from products/*/backend`, `ban fetch() in frontend/src/**/*Logic.ts; use api.*`, `posthog/api/** may import products.<p>.backend only via products.<p>.backend.facade`. For `no`, sketch the closest rule you tried, so the failed guard is concrete, or `""` for judgment kinds with no candidate rule at all.

`note` is at most 200 characters: what the correction asks for and, for `no`, why the guard failed. Describe code; do not quote the comment.
