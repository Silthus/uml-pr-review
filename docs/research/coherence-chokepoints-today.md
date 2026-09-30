# How Coherence defines and validates chokepoints today

Research for [#106](https://github.com/Silthus/uml-pr-review/issues/106), part of map [#105](https://github.com/Silthus/uml-pr-review/issues/105). Written 2026-09-30.

## Findings first

1. **Coherence is a shipped tool, not only a doctrine.** It is [`PostHog/coherence`](https://github.com/PostHog/coherence), public, published to npm as `@posthog/coherence` (1.1.1 on 2026-09-28). It was rebuilt from zero on the `distill` branch and merged on 2026-09-23. The Slack canvas vocabulary (skeleton, claims, map, doctrine, the inferred → read → unaskable ladder) predates that rebuild. Several of those words are now retired or renamed. Today's words are **spec, invariant, enforcement, chokepoint, totality oracle, refutation, grade, lexicon, journal, and Scope** (the map).
2. **A chokepoint is a symbol-level reference fact, not a layering rule.** An invariant names a *protected thing* (a symbol or a module) and a *chokepoint symbol*. It holds while every resolved reference to the protected thing sits inside the chokepoint. The chokepoint itself may have any number of callers. Coherence checks this through the language server (`typescript-language-server`, `pyright-langserver`), not through import graphs.
3. **The manifest already exists.** A team declares chokepoints in `<Name>.spec.md` files, one per component folder, as `protects:` plus `chokepoint:` lines on an invariant bullet. An agent writes them, guided by `coherence scaffold` and a 36-shape decomposition checklist. A human settles them in review. There is no separate YAML manifest and no questionnaire.
4. **Validation is refutation, not scoring.** No enforcement counts until its firing has been *witnessed*. For chokepoints, the tool stages a synthetic bypass in memory and requires the check to go red. For a TypeScript symbol that is not exported, the compiler's "not exported" diagnostic is itself the refutation. Every run is appended to `.coherence/runs/*.jsonl`, and `spec --check` derives each bullet's state (requirement, invariant, or structural defect) from those runs.
5. **Mid-build feedback already exists.** On every `PostToolUse` file write, a warm language server re-checks the chokepoints the file touches. The hook then prints any bypass to the agent in the same turn. At `SubagentStop`, a remaining structural defect refuses the stop.
6. **The grade ladder names who enforces each rung.** In TypeScript the rungs are `visibility-choked` (the compiler), then `reference-choked` (Coherence's own check). Python has an extra `checker-choked` rung: a checker the project runs, namely Pyright's `reportPrivateUsage` or an **import-linter contract**. The adapter's test fixture is PostHog's own `presentation must use facade` contract. **TypeScript has no checker rung. An ESLint rule is not credited today.**
7. **Coherence explicitly retired "ratchets (lint-sinks, conventions, mass baselines)"** and the gate/ratchet/advisory split. In its place, a known residual becomes a totality oracle whose named set excludes a listed residual. There is a baseline for lexicon findings, but none for undeclared entrances.
8. **Nobody in #project-coherence has discussed ESLint or lint.** A search for "lint" in the channel returns nothing. The stated direction is a **per-repository plugin system with custom claims**, raised again on 2026-09-28 during the revenue-model work.
9. **The PostHog monorepo has not adopted Coherence.** It has no specs, config, or lexicon. It already enforces boundaries with `tach`, import-linter, `hogli product:lint` and oxlint `no-restricted-imports`, each with a residual baseline. **Its frontend lints with oxlint, not ESLint.**

## Doctrine: what a chokepoint is and how it relates to the rest

### The canvas (the "why")

The pinned canvas "What's going on here?" in #project-coherence frames Coherence as "an attractor design kit". A human builds a skeleton that defines what the software *is*, and Coherence emits signals that nudge each agent loop toward it. Its first rule is **route sensitive behavior through chokepoints**: agents attach convention band-aids at call sites, and review turns into whack-a-mole. It also says Coherence should "document and protect" the chokepoint "so a session four months from now doesn't weaken its protections". The other two rules are **maintain a map** (totality: where every place a rule matters is, derived from code rather than hand lists) and **recall decisions**.

### The ladder

The Slack bot's summary of the pre-rebuild README (thread "what is coherence?", in `more.txt`) gives the ladder as *dissolve > declare > infer*: **unaskable** (structure makes the question impossible), **read** (the fact is written down once), and **inferred** (the expensive default). In the current tree the ladder survives only in the reference inventory ([`docs/reference/glossary-inventory.json`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/docs/reference/glossary-inventory.json)). There, the governing model says Coherence "moves facts down the ladder from inferred to read to unaskable, and the enforcement ladder is the same ladder priced". Its live form is the **chokepoint grade** ([`docs/enforcement.md`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/docs/enforcement.md), "The ladder"):

| Language | Rung | Enforcer |
|---|---|---|
| TypeScript | `visibility-choked`: not exported, no bypass | the compiler (unaskable) |
| TypeScript | `reference-choked`: exported, every reference inside the chokepoint | Coherence's check at the edit and in CI |
| Python | `closure-choked`: a function-local inside the chokepoint | the interpreter |
| Python | `checker-choked`: Pyright private-usage as an error, or an import-linter rule naming the module | a checker the project runs |
| Python | `reference-choked` | Coherence's check |
| Python | `convention` | nobody |
| both | `broken`: a bypass exists, or the chokepoint does not resolve | a structural defect |
| both | `not chokeable`: the protected thing is prose, not a symbol | falls back to a totality oracle |

The adapter spec gives the reason: "naming the enforcer on every rung is what lets a human read how much the structure is doing and who would stop a bypass" ([`src/adapters/Adapters.spec.md`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/src/adapters/Adapters.spec.md)).

### Current vocabulary (lexicon)

Coherence's own [`docs/lexicon.json`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/docs/lexicon.json) holds 50 concepts. Each carries rejected names, and the tree's check refuses them. The ones that matter here:

- **invariant**: the abstract behavioral requirement that must survive every implementation.
- **enforcement**: what turns a requirement into an invariant by detection. It takes two forms, a **chokepoint** ("ideal") or a **totality oracle** ("the compromise"). Rejected former names include *boundary claim* and *anchor*.
- **chokepoint**: "the one site through which every reference to a protected thing passes". The lexicon explicitly rejects the idea that the chokepoint itself must have a single caller, and the idea that the chokepoint merely existing is enough.
- **totality oracle**: a test that is total over a named set. A spot check does not count as enforcement.
- **refutation**: "the witnessed firing of an enforcement". It is required: "a requirement does not become an invariant, until its refutation has been witnessed".
- **trust level**, **crossing**, **entrance**: the security markers. An entrance with outside trust and no traced control is flagged.
- **scope** and **structure**: the reading and the "map". A live HTML surface projects the model and diffs a change set. Danilo announced on 2026-09-23 that "the map is derived AND diagnostic".
- **lexicon**: required in every project and injected at session start. It is the glossary thread's thesis: "if you can't define the terms, you haven't defined the system" (Danilo, `key.txt` part-10).

The following are retired ([`docs/retired.md`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/docs/retired.md), owner decisions of 2026-09-17):

- the claim forms `exists`, `imports`, `lives in`, `conforms to` and others ("one grammar: every spec bullet is an invariant with enforcement");
- the *atlas*;
- *doctrine*, as a versioned rulebook;
- the gate/ratchet/advisory command classes;
- **ratchets, including lint-sinks and conventions**.

The retired `imports` claim form carries the reason "references subsume imports". That is the core difference from an import-direction linter.

## How a team declares chokepoints today

- **Format.** A spec is `<Name>.spec.md` in a component folder. It has a title, a one-line intent, `## trust levels` (entry spec only), `## entrances`, and `## invariants`, and the parser refuses any other section ([`docs/spec.md`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/docs/spec.md)). Each bullet is `- <name>: <sentence>`, followed by indented `key: value` lines: `protects:`, `chokepoint:`, `over:`, `via:`, `because:`, `crossing:`, `refuted:`, `kinds:`, and `checklist:`.
- **Location.** Specs sit beside the code, in the repo. Config lives in `coherence.config.json`, and the lexicon in `lexicon.json`. The journal, runs, and work records live in `.coherence/`, and all of it is committed.
- **Who writes them.** An agent does, following the "Full setup" prompt in the [README](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/README.md). That prompt has 7 steps: install, config, hooks, lexicon, specs, enforce, and baseline-record-show. For the "few invariants that matter most (security, tenant isolation, data integrity)", the agent runs `coherence scaffold invariant <folder> "<sentence>" --kinds … --chokepoint --write`. That prints every slot as a placeholder, plus one checklist line per applicable shape from 36 seeded shapes ([`docs/checklist-seed.json`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/docs/checklist-seed.json)). The scaffold's own invariant says why: "the complete shape must be the cheapest thing to produce". Each non-obvious choice is recorded with `coherence decide … --over … --because …`.
- **There is no skill and no questionnaire.** The repository has no skill files. The definition flow is the setup prompt, the scaffold, and the checklist, delivered through hooks. Marce proposed a "coherence-factoring skill" for declarative decomposition on 2026-08-06 (`more.txt` part-32), and Danilo welcomed it. It has not landed.

## How Coherence validates and enforces them

- **The check.** `coherence run` resolves each spec name through the language server, lists every reference, and classifies it as inside, test, or bypass. Import specifiers have fixed rulings. A plain import is inside only in the chokepoint's own module. An `export … from` or wildcard re-export is a bypass everywhere, because it "widens the thing's reach with no call at all" ([`docs/enforcement.md`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/docs/enforcement.md)). A bypass names file, line, and referencing symbol.
- **Refutation.** A chokepoint is refuted automatically: the tool stages a synthetic bypass in an unsaved buffer, and the refutation fires only if every staged site grades as a bypass. Otherwise the check is marked vacuous and the bullet stays a requirement. A totality oracle is refuted by hand with `coherence refute <component>/<name> --broke "…"`. That run must go red, and a later run must go green again.
- **At the edit.** A warm per-project language server listens on a unix socket. On `PostToolUse` it re-checks only the chokepoints the written file may involve. It prints any bypass as `additionalContext`, with two options: route the reference through the chokepoint, or escalate a retirement to a human. At `Stop` the regulation message lists structural defects, and at `SubagentStop` it refuses the stop.
- **In CI.** `spec --check` exits 1 on problems, and `hooks --check` is the CI form of the hook wiring. Coherence's own `npm test` runs the typecheck, the tests, the vocabulary check, and `spec --check`. I ran `node src/cli.ts spec --check` on a clone at `d7fc348`. It reported "10 components, 204 bullets: 204 invariants, 0 requirements … 0 problems", with the latest run on 2026-09-29.
- **Jev narrow checks.** Marce proposed [Jev](https://typesafe.ai/) (Typesafe's decision model: about 100 ms per call, structured confidence) to check that "a test does test the property". Danilo found it "consistently" good for one test against one guarantee, but "a spec is too much for it to accurately reason about". He doubted its leverage because he now has "a more accurate measure of a chokepoint that I can establish entirely through language server output" (`more.txt` part-07, 2026-09-18). **It is not in the shipped tree.** A search for `jev` in the clone finds only review evidence from 2026-09-18.

### Do they measure whether it works?

They do, in three ways, and none of them is a review-correction rate.

- **Refutation, per enforcement.** "Red with the break, green without it." It is recorded in the run store.
- **An adoption A/B harness** ([`bench/adoption/README.md`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/bench/adoption/README.md)). Headless Opus sessions adopt Coherence into throwaway clones, at about $5–10 per arm. The recorded result (journal conjecture `c-9941b95e`, resolved) covers 12 arms and $84.89 in total. Every new-build adoption ended with 0 gaps, against 2–9 gaps in 5 of 6 old-build ones. The caveat is n=3.
- **Case reviews with negative controls** ([`docs/reviews/`](https://github.com/PostHog/coherence/tree/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/docs/reviews)). Two PostHog cases ran on 2026-09-18: Rust capture, and Python API auth. The auth case found that its first detector stayed green with an unconditional early `return None` inserted. The case recorded that as a detector defect and replaced the detector with an executing test.

Anecdotal signals appear in Slack. Richard's adopter feedback (2026-09-25) reports that "refute caught all five staged regressions" and asks for pnpm-safe installs and lexicon baselining. Danilo's revenue-model history review (2026-09-28) finds that "about two thirds of the fixes are vocabulary problems".

## Coherence in PostHog (`~/posthog`)

**The monorepo has no Coherence code, specs, or docs.** This was searched at `645e1a78140`, dated 2026-09-30.

- There are no `*.spec.md` components, no `coherence.config.json`, no `lexicon.json`, and no `.coherence/`.
- `git log --grep=coherence` returns zero commits.
- "attractor", "unaskable" and "narrow check" have zero hits.
- "coherence" appears only for cache consistency.
- "lexicon" and "skeleton" appear only as UI loading states and false positives.
- "jev" means the product-suggestion feature and its decision-model client.

"Choke point" appears in about 45 comments, but only in its plain sense. One is in `products/workflows/backend/models/hog_flow/hog_flow.py:167` ("Enforced at the send choke point").

PostHog enforces boundaries with its own tools, and **all of them are chokepoint enforcers under another name**:

- **`tach.toml`** is a single root file with 43 `[[interfaces]]` blocks for inter-product boundaries. The canonical block exposes only `backend.facade.*`, `backend.presentation.views.*` and `backend.routes.*`.
- **import-linter** has 5 contracts in `pyproject.toml`, for intra-product layering. The key one is "presentation must use facade", which carries an `ignore_imports` list marked "TODO: existing violations". That list is a residual baseline, and it is the same contract Coherence's Python adapter test uses as its fixture.
- **`hogli product:lint --all`** (`tools/hogli-commands/hogli_commands/product/`) checks against the baseline files `products/isolation_baseline.txt` and `products/model_crossing_uses_baseline.txt`.
- **In CI**, `ci-backend.yml` runs `product:lint`, `lint:tach` and `lint-imports`.
- **For agents**, there are the rules `.claude/rules/product-isolation.md` and `.claude/rules/tach-boundaries.md`, and the skills `isolating-product-facade-contracts` and `placing-product-frontend-code`.
- **The frontend has no ESLint.** It uses **oxlint** (`^1.72.0`, `lint:js`). `.oxlintrc.json` loads only built-in plugins, and its `no-restricted-imports` blocks are hand-written boundaries: toolbar may not import `scenes/**` or `products/**`, and there is a "Forbidden by design boundary" rule for the posthog_ai sandbox. Oxlint can load ESLint-compatible rules through `jsPlugins`, which its [docs](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) mark as alpha.
- **`products/workflows`** has `backend/facade/` and `presentation/`. It is still listed in `isolation_baseline.txt` (line 80), so it is not yet isolated, and it declares no architecture of its own.

A background Opus search reported these facts. I spot-checked the import-linter contract, the missing ESLint config, the oxlint plugins list, the baseline files, the CI steps, and the workflows choke-point comment.

## What the Coherence team wants to avoid, and what is planned

- **Conventions at call sites** ("a recipe for insecure projects"), and **hand lists that rot**. The map must be derived from code.
- **Detection that proves nothing.** "A run that proved nothing must never read like a clean one" ([`docs/enforcement.md`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/docs/enforcement.md)). Existence checks and spot checks are rejected as enforcement.
- **Second names for one concept.** The lexicon's rejected-name list exists to stop "a second spelling" from returning.
- **Ratchets and command classes.** "One thing goes red (a structural defect or an unacknowledged retirement) and it belongs to the invariant, not to a class of command; everything else is a reading" ([`docs/retired.md`](https://github.com/PostHog/coherence/blob/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6/docs/retired.md)).
- **Doctrine reprinted into context.** The hook "injects state, not doctrine". The reference's 9.7 KB vocabulary dump at every session start was rejected.
- **Hiding the surface that stayed undeclared.** There is deliberately no adoption baseline for undeclared entrances, because "a day-one baseline would hide exactly the surface that stayed undeclared" (journal decision, 2026-09-28).
- **Planned.**
  - A per-repository **plugin system with custom claims** (Marce on 2026-08-06 and again on 2026-09-28; Danilo: "I'll actually start there").
  - Chokepoint **shadowing** for dbt, which is live in `PostHog/revenue-model`.
  - A **taxonomy** of component roles, each with a protocol of required guarantees (huddle notes of 2026-09-01).
  - Language-server **caller-chain** steering.
  - A "graph that models the time-boundedness of meaning" (2026-09-29, [thread](https://posthog.slack.com/archives/C0BL3E938JE/p1790700344586319?thread_ts=1790608419.210999&cid=C0BL3E938JE)).

  Nothing is planned in a lint direction.

## Who's who

- **Danilo Campos** (`daniloc`) leads Coherence and is its main author (`PostHog/coherence`, and the older `daniloc/coherence`). He is currently proving it on the revenue-recognition model: "if coherence can grow into something that solves this problem, it's a powerful proof point".
- **Marce Coll** works on billing and the revenue model. He wrote the dbt extension and chokepoint shadowing, brought in Jev and theory-first `THEORY.md`, and pushes for the plugin system and a factoring skill.
- **Early adopters**:
  - Richard Solomou gave structured agent feedback on two side projects.
  - jake sciotto replaced per-project `.claude/` guardrails with Coherence specs.
- **Around them**:
  - Rafa arranged the Jev access.
  - Mine Kansu is on the billing side.
  - Charles Cook, Brittany Joiner, and Fernando take part occasionally.
- **What Michael could offer that fits their plan:**
  - **A TypeScript `checker-choked` rung** credited to an ESLint rule, mirroring Python's import-linter and Pyright rung. It is a small, doctrine-native adapter contribution.
  - **A PostHog-monorepo TypeScript testbed** (`products/workflows`). Their PostHog cases so far are Rust capture and Python auth.
  - **An external success metric their A/B lacks**: human architecture corrections per 100 PRs, from the correction corpus in this repo.
  - **A plugin-shaped proof** for the plugin system they want.
  - **The pnpm install path** Richard asked for.

## What this means for a lint-based slice

**Where it fits their doctrine.**

- Chokepoints over conventions, enforced mechanically at write time, is exactly Coherence's first rule.
- An ESLint rule the project already runs is precisely the kind of enforcer the grade ladder is built to credit. Python already has that rung, and it names a PostHog import-linter contract.
- Feedback while the agent builds is their "revelation at the edit".
- A one-conversation definition that becomes a reviewed file matches how specs are written: agent-scaffolded, committed, and changed by PR.

**Where it conflicts.**

1. **A separate manifest is a second declaration.** Coherence already has the manifest: `protects:` plus `chokepoint:` in `<Name>.spec.md`. A parallel YAML file would be the "second spelling" their lexicon exists to prevent.
2. **Import rules are coarser than their chokepoint.** Theirs is symbol-level, resolved through the language server, with rulings on re-exports. `no-restricted-imports` sees module paths only. A lint rule should be framed as an *enforcer of a declared chokepoint* (a rung), not as a new kind of claim.
3. **The unaskable rung sits above lint.** In TypeScript the top rung is "don't export it". Doctrine will ask why a lint rule is needed where the compiler could refuse.
4. **Baselines and ratchets are a retired design.** A lint baseline has to be stated their way: a totality oracle over a named set that excludes a listed residual, and never a quiet ratchet. PostHog's own import-linter `ignore_imports` list with its "TODO: existing violations" is the same idea, already accepted in the monorepo.
5. **Refutation is mandatory.** A lint enforcement counts only after a staged bypass has turned it red.
6. **Mid-build feedback duplicates the `PostToolUse` path** unless lint *is* the enforcer the hook reports. The distinct value of ESLint is that it reaches humans, editors, and CI with no agent hooks at all. That is also the answer to "no new workflow for engineers".
7. **PostHog runs oxlint, not ESLint.** A standalone ESLint setup would add a second linter to the monorepo. The rule should be written to the ESLint rule API and loaded through oxlint's `jsPlugins` (alpha). Whether that works well enough is a spike question.

**What already exists and must be reused, not rebuilt.**

- **The spec grammar** (`protects`, `chokepoint`, `because`, `refuted`) as the declaration format. Our slice should read `<Name>.spec.md`, or emit bullets into it.
- **`coherence scaffold invariant --chokepoint`** and the 36-shape checklist as the definition skill's backbone. The skill can be a thin grilling front end that ends in `scaffold … --write`.
- **The language adapter and warm server** for resolving symbols and references. Do not rebuild reference resolution in ESLint.
- **The run store and `spec --check`** as the verdict. They are the place where a lint rule's grade and refutation should land.
- **The lexicon** for naming. Use their words: invariant, chokepoint, enforcement, and grade. Avoid manifest, claim, rule, and ratchet.
- **PostHog's existing enforcers and baselines**:
  - `tach`;
  - the import-linter facade contract and its `ignore_imports` residual;
  - `hogli product:lint` and its baseline files;
  - `.oxlintrc.json`;
  - the product-isolation rules and skills.

  Coherence already credits import-linter on the Python side.

**Net.** The lint slice fits if it is pitched as **a TypeScript checker rung plus a spec-backed ESLint-API rule**: Coherence declares, the project's linter enforces for everyone, and Coherence grades and refutes it. In PostHog, that linter is oxlint through `jsPlugins`. It does not fit as a standalone manifest-and-linter product next to Coherence. That would be a parallel skeleton, and it would add exactly the overhead Michael wants to avoid.

## Sources

- [PostHog/coherence @ d7fc348](https://github.com/PostHog/coherence/tree/d7fc3482fc10941a8dc30db3588eb0ee605cd0d6): `README.md`, `docs/spec.md`, `docs/enforcement.md`, `docs/lexicon.json`, `docs/retired.md`, `docs/checklist-seed.json`, `src/adapters/Adapters.spec.md`, `src/adapters/typescript.ts` (TypeScript rungs), `src/adapters/python.ts` (Python rungs, import-linter reading), `src/scaffold/Scaffold.spec.md`, `bench/adoption/README.md`, `docs/reviews/2026-09-18-posthog-*.md`, and `.coherence/journal/` (conjecture `c-9941b95e`).
- Slack #project-coherence (read-only): the canvas "What's going on here?", the huddle notes of 2026-09-01, the glossary thread, the Jev threads, the adopter feedback of 2026-09-25, and the revenue-model thread of 2026-09-28/29 ([link](https://posthog.slack.com/archives/C0BL3E938JE/p1790613481637349?thread_ts=1790608419.210999&cid=C0BL3E938JE)). A search for "lint" in the channel returns no results.
- `~/posthog` at `645e1a78140` (2026-09-30): `pyproject.toml` `[tool.importlinter]`, and the sources listed in the PostHog section.
- `PostHog/coherence-lab`, the trials log Danilo mentions, returns 404 to this account. It is not read.

**Verified locally:** the Coherence clone, `spec --check` on it, the contents of the lexicon and retired lists, the TypeScript and Python rungs in the adapter source, and PostHog's import-linter contract. **Inferred:** how the team would receive a lint rung, and whether a TypeScript checker rung would be accepted upstream. Nobody has discussed either.
