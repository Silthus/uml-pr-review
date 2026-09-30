# What PostHog already enforces on `products/workflows`

Research for [#109](https://github.com/Silthus/uml-pr-review/issues/109), part of map [#105](https://github.com/Silthus/uml-pr-review/issues/105).
PostHog was read at commit [`645e1a7`](https://github.com/PostHog/posthog/tree/645e1a78140757ea1bb9ddeb0ff9d3915c60b6f6) (2026-09-30). All `products/...`, `nodejs/...` and `tach.toml` paths below are in PostHog. Links are permalinks to that commit.

## Findings first

1. **PostHog's TypeScript is not linted by ESLint flat config at all.** The frontend and `products/**` are linted by **oxlint 1.72** with one config, [`.oxlintrc.json`](https://github.com/PostHog/posthog/blob/645e1a78140757ea1bb9ddeb0ff9d3915c60b6f6/.oxlintrc.json). `nodejs/` has its own oxlint config, [`nodejs/.oxlintrc.nodejs.json`](https://github.com/PostHog/posthog/blob/645e1a78140757ea1bb9ddeb0ff9d3915c60b6f6/nodejs/.oxlintrc.nodejs.json). It also has a 30-line **legacy ESLint 8** [`nodejs/.eslintrc.js`](https://github.com/PostHog/posthog/blob/645e1a78140757ea1bb9ddeb0ff9d3915c60b6f6/nodejs/.eslintrc.js) that only runs `eslint-comments`. No `eslint.config.*` exists anywhere in the repo.
   So "an ESLint plugin in PostHog's flat config" really means **an ESLint-API plugin loaded through oxlint's `jsPlugins`**. PostHog already does this in `nodejs/.oxlintrc.nodejs.json:4-10`. I verified the wiring end to end in a scratch worktree (see [the wiring experiment](#wiring-experiment-verified)).
2. **`tach` is Python-only and owns every Python boundary of workflows.** It owns the module dependencies and the inbound facade interface. `import-linter` owns intra-product layering. Nothing enforces a TypeScript boundary for workflows: there is no product-specific oxlint override, no frontend public surface, and no Node-side rule.
3. **The architecture rules in `products/architecture.md` are all backend rules.** They cover facade, contracts, presentation, routes and isolation. The doc says tach is "for Python import boundary enforcement" (L623), and its folder structure (L213-254) has no `frontend/`.
4. **ReviewHog and stamphog do not gate architecture.** ReviewHog has no architecture perspective. Its validation step drops "pure style / taste … naming". Stamphog lists "could be refactored better" as *not* a showstopper.
5. **Of the 30 harvested workflows rules, 2 are cleanly lintable on the TS side and 3 more partly.** The TS side's biggest lintable gap is not in the harvest: the workflows frontend has **no public surface**. About 25 files outside it deep-import its internals, and it has a two-way dependency with `frontend/src/scenes/hog-functions`.
6. **Speed is a non-issue.** On this box, oxlint on one workflows file takes 0.25 s wall time. With a manifest-reading JS plugin it takes 0.34 s. The whole workflows frontend (329 files) takes 0.40 s, or 0.63 s with the plugin. The full repo takes 2.0 s, or 2.5 s with the plugin.

## Recommendation for the spec ticket

### Where the manifest lives

Put it at **`products/workflows/chokepoints.yaml`**, next to `product.yaml`, `package.json` and `CONTRIBUTING.md`. Put its baseline next to it as **`products/workflows/chokepoints.baseline.json`**.

- **Not inside `product.yaml`.** Stamphog lists `product\.yaml` as a merge-gate input (`.stamphog/policy.yml:118-136`), because it carries ownership. Hogli's product tooling also parses it (`tools/hogli-commands/hogli_commands/product/product_yaml.py`). Mixing architecture into it would couple two unrelated review paths.
- **One manifest per product, including its Node code.** The workflows runtime lives outside the product, in `nodejs/src/cdp/services/hogflows/` (38 files, 11.4k LOC). So the manifest declares components with repo-root globs, the way `docs/harvest/workflows/rules.json` `components[].paths` already does (for example `nodejs/src/cdp/services/hogflows/actions/`).
- **The baseline has to be ours.** oxlint 1.72 has no suppressions or baseline feature: `--help` offers only `-A`, `--max-warnings`, `--deny-warnings` and disable directives. PostHog already uses checked-in ratchet baselines, which fits this: `products/isolation_baseline.txt`, `products/model_crossing_uses_baseline.txt` and `frontend/bin/toolbar-graph-baseline.json`.
- **Caveat, inferred:** `.yaml` and `.json` sit on stamphog's `extensions_only` allow list (`.stamphog/policy.yml:149-169`). A PR that touches only the manifest or baseline is therefore on the auto-approve path. Loosening a manifest would get less scrutiny than `product.yaml` gets. This is a product-shaping point for Michael, not something to change in PostHog.

### How the plugin wires into PostHog's lint config without disturbing it

Append **one override** to each config. Do not edit any existing rule.

```jsonc
// .oxlintrc.json → append to "overrides"
{
    "files": ["products/workflows/**/*.{ts,tsx}"],
    "jsPlugins": ["<plugin specifier>"],
    "rules": { "chokepoints/boundaries": ["error", { "manifest": "products/workflows/chokepoints.yaml" }] }
}
// nodejs/.oxlintrc.nodejs.json → append to "overrides" (paths are relative to nodejs/)
{
    "files": ["src/cdp/services/hogflows/**/*.ts", "src/cdp/services/messaging/**/*.ts"],
    "jsPlugins": ["<plugin specifier>"],
    "rules": { "chokepoints/boundaries": ["error", { "manifest": "../products/workflows/chokepoints.yaml" }] }
}
```

Constraints I verified or read in the source:

- **Use a new rule namespace, never `no-restricted-imports`.** oxlint overrides *replace* a rule's options; they do not merge them. PostHog works around this by copying the global bans into every override: the dayjs and schema bans appear four times in `.oxlintrc.json`, and `nodejs/.oxlintrc.nodejs.json:135` says "Overrides replace rule options, so the global … bans are repeated here". A `chokepoints/*` rule cannot clobber the existing bans.
- **`jsPlugins` is allowed per override.** The oxlint 1.72 schema lists `OxlintOverride` properties `env, excludeFiles, files, globals, jsPlugins, plugins, rules`. The plugin therefore loads only for workflows files. Oxc documents JS plugins as **alpha, not subject to semver**, targeting the ESLint v9 plugin API ([oxc docs](https://oxc.rs/docs/guide/usage/linter/js-plugins.html)). Pin the oxlint version in the prototype.
- **A rule with options must declare `meta.schema`.** Without it, oxlint aborts: `Rule 'chokepoints/boundaries' does not accept options`.
- **A broken plugin fails the whole lint.** A JS plugin setup error exits 1 with no other findings, which I verified. Missing manifests and bad YAML must degrade to a clear single report, not a crash.
- **Severity must be `error`.** CI runs `pnpm exec oxlint --quiet` (`.github/workflows/ci-frontend.yml:489-490`), and `--quiet` hides warnings. That is why today's `import/no-cycle` (`"warn"`, `.oxlintrc.json:182-187`) is invisible in CI. Use `error` plus the baseline, not `warn`.
- **Type-aware rules are out.** oxlint JS plugins cannot use TypeScript type information (oxc docs). `nodejs/.oxlintrc.nodejs.json:15` sets `"typeAware": true`, which needs `oxlint-tsgolint` from `nodejs/node_modules`. The plugin itself must stay syntactic: imports, selectors and literals.
- **Existing feedback points pick the rule up for free:**
  - At commit, lint-staged (`package.json:84-110`) runs `bin/hogli format:js` on `products/**` and `bin/hogli format:nodejs` on `nodejs/**`. These are `oxlint --fix --quiet` with the default configs (`hogli.yaml:840-847`), so an `error` blocks the commit.
  - In CI, `ci-frontend.yml:490` runs the root config and `ci-nodejs.yml:339` runs `pnpm --filter=@posthog/nodejs lint`.
- **No mid-build hook exists.** PostHog's `.claude/settings.json` has only `SessionStart` hooks and no `PostToolUse` lint. For an agent to get feedback "while it builds", the prototype has to add its own hook or skill step that runs oxlint on each edited file, at about 0.3 s per file.
- **Prior art for architecture-by-override:** `.oxlintrc.json:271-335` already keeps the toolbar out of app scenes, and `.oxlintrc.json:336-386` keeps the `posthog_ai` sandbox away from Max logics. Both use per-glob `no-restricted-imports` with an explanatory message. The chokepoint plugin generalises that pattern and moves the declaration next to the product.

For the prototype, PostHog is read-only. Replay in a scratch worktree by appending the override there. An alternative is a wrapper config that uses oxlint's `extends`. `extends` exists in the 1.72 schema, but I did not test it, and override globs resolve relative to the config file, so the wrapper would have to sit at the worktree root.

### What `tach` owns, which the manifest must not duplicate

| Concern | Owner today | Where |
|---|---|---|
| Python dependency edges of `products.workflows` | `tach` | `tach.toml:1096-1112`, with `depends_on` cohorts, ee, posthog, actions, cdp, feature_flags, messaging, notifications, signals, tasks and access_control |
| Inbound Python surface: others may import only `backend.facade.*`, `backend.presentation.views.*` and `backend.routes.*` | `tach` interfaces | `tach.toml:1115-1128`. Workflows is in the canonical block. |
| Who depends on workflows (ee, posthog, warehouse_sources, ai_observability, signals, customer_analytics, canvas) | `tach` | parsed from `tach.toml` |
| Intra-product layering: presentation only to the facade, routes only to presentation, webhook consumers only to the facade, the facade never to DRF | `import-linter` | `pyproject.toml:575` (39 grandfathered `products.workflows` lines under "TODO: workflows presentation wave", L727), `:784`, `:859`, `:877` |
| Isolation status and ratchet | `hogli product:lint` | `products/isolation_baseline.txt:80` lists `workflows`: it is **not isolated**, and there is no `backend:contract-check` script in `products/workflows/package.json` |
| How CI runs it | `hogli lint:tach` makes two passes: dependencies without tests, interfaces with tests | `tools/hogli-commands/hogli_commands/tach_lint.py:21-22`; `.github/workflows/ci-backend.yml:1499-1500` |

So the manifest must not declare **Python module dependencies, Python facade exposures, or Python layering**. At most it may *name* the Python facade as a component, for vocabulary and the remainder perspective, with `owner: tach`.

A gap tach leaves, which belongs to tach and not the manifest: `signals`, `cdp` and `messaging` have **no** `[[interfaces]]` block. The "Facade-only" comment on workflows' `products.signals` dependency (`tach.toml:1106-1108`) is therefore documented, not enforced. The harvested rule `facade-is-the-only-way-in` proposes adding workflows to the canonical interface block. That is already done, so the proposal is stale.

The manifest's territory is what no tool covers today: **TypeScript boundaries and paved paths** in `products/workflows/frontend` and `nodejs/src/cdp/services/{hogflows,messaging}`.

## Evidence

### `tach.toml`

- 96 `[[modules]]` and 43 `[[interfaces]]`. Config: `layers = ["modules"]`, `source_roots = ["."]`, dotted Python paths. It has no language setting.
- tach 0.34.1 (`uv.lock:8292`). Its [configuration](https://docs.gauge.sh/usage/configuration) and [interfaces](https://docs.gauge.sh/usage/interfaces) docs describe only Python.
- The comment above the canonical block (`tach.toml:1115-1118`) tells authors not to widen it, and to add a facade function instead. `.claude/rules/tach-boundaries.md` and `.claude/rules/product-isolation.md` repeat this for agents.

### `products/architecture.md`

- The Python-side rules are enforced, as the doc itself states:
  - "What tach enforces" (L521-525);
  - "What import-linter enforces" (L527-531: "tach handles inter-module … import-linter handles intra-product");
  - `hogli product:lint` (L84, L107, L270);
  - the reverse-accessor baseline (L551).
- The doc names two rules that no tool checks:
  - management commands (L461: "Reviewers must enforce this rule");
  - naming inside `logic/` (L273: "no lint polices the name").
- The doc has no rules about frontend or TypeScript.

### Lint configs and how they run

- **Root `.oxlintrc.json`** (404 lines) sets 9 native plugins (L3). Its `ignorePatterns` include `nodejs` (L14) and `products/**/frontend/generated/**` (L28).
- The **architecture-ish rules** that apply to workflows today are all global:
  - `no-restricted-imports` bans `dayjs`, `~/queries/schema`, `monaco-editor`, `CodeEditorImpl`, the brand hoggies and `storybook/preview-api` (L89-139);
  - `react/forbid-dom-props` and `react/forbid-elements` apply;
  - `import/no-cycle` is set to warn with `maxDepth 10` (L182-187).
- No override targets `products/workflows`. `grep workflows|hogflows|cdp` finds nothing in either oxlint config.
- **`nodejs/.oxlintrc.nodejs.json`** (167 lines):
  - `jsPlugins: ["eslint-plugin-no-only-tests", {name: "eslint-js", specifier: "oxlint-plugin-eslint"}]` (L4-10);
  - `typeAware: true` (L15);
  - `eslint-js/no-restricted-syntax` bans `JSON.parse` (L34-40);
  - an ingestion-only override bans `../` imports (L132-165). Nothing is specific to CDP or hogflows.
- **Scripts.** The root has `lint:js = oxlint --quiet` (`package.json:48`). `nodejs` has `lint = eslint . && oxlint -c .oxlintrc.nodejs.json .` (`nodejs/package.json:26`).
- **Other TS architecture checks that exist, none of them workflows-specific:**
  - `frontend/bin/check-toolbar-graph.mjs`, an esbuild input-graph boundary with a baseline, run at `ci-frontend.yml:614`;
  - `frontend/bin/check-eager-graph.mjs`;
  - `bin/lint-complexity.mjs`, warn-only on the PR diff (`ci-frontend.yml:492-509`).
- **Timing,** measured on this devbox in a scratch worktree with the main clone's `node_modules/.bin/oxlint`, real time, one run each:

| Target | Root config | With the chokepoint override |
|---|---|---|
| `Workflows/workflowLogic.ts` (4,413 LOC) | 0.25 s | 0.34 s (a different single file) |
| `products/workflows/frontend` (329 files) | 0.40 s | 0.63 s |
| Whole repo | 2.0 s | 2.5 s |
| `nodejs/src/cdp/services/hogflows` | not measured (see below) | 0.35 s |

  I could not time the Node config as CI runs it: `typeAware` needs `oxlint-tsgolint` from `nodejs/node_modules`, which a fresh worktree lacks. I turned `typeAware` off in the scratch copy to test the plugin wiring. I did not install anything.

### Wiring experiment (verified)

In a scratch worktree (`/tmp/ph-lint-109`, now removed and pruned), I built a 20-line ESM plugin. It exports `{meta: {name: 'chokepoints'}, rules: {boundaries}}` and reads a JSON manifest whose path comes from the rule options. I appended the two overrides above.

- **Root config:** 32 findings for `scenes/hog-functions` imports in the workflows frontend, and none outside `products/workflows`.
- **Node config:** a demo ban on `luxon` fired across `src/cdp/services/hogflows/**`.
- The shared manifest lived under `products/workflows/` and was reached as `../products/workflows/...` from `nodejs/`.
- Omitting `meta.schema` aborted the run with exit code 1.

### The TypeScript surface of workflows

- **Frontend:** `products/workflows/frontend` has 329 TS/TSX files and 75.8k LOC.
  - `Workflows/` has 226 files and 51.9k LOC. The hog flow editor is `Workflows/hogflows/`, with 138 files and 32.3k LOC.
  - The other directories are `Broadcasts/` (47 files), `generated/` (3 files, 6.8k LOC, lint-ignored), `OptOuts/`, `TemplateLibrary/`, `Channels/` and `Suppression/`.
  - The biggest logics are `workflowLogic.ts` (4,413 LOC), `broadcastWizardLogic.ts` (1,757) and `workflowMetricsSummaryLogic.ts` (1,556).
- **Entry points:** `products/workflows/manifest.tsx` declares:
  - scenes Workflows, Workflow, WorkflowsLibraryTemplate, Broadcasts and Broadcast (L12-45);
  - routes (L47-68) and urls (L69-81).
  - It imports `../../frontend/src/types` (L5).
- **Outbound imports from the frontend:**

  | Target | Imports |
  |---|---|
  | `lib/` | 473 |
  | `scenes/` | 189 |
  | `@posthog/*` | 198 |
  | `~/types` | 95 |
  | Other products | 42 |

  - The other products are messaging (13, all generated API), customer_analytics (10), posthog_ai (8), notifications (6) and persons (5).
  - 24 files import `scenes/hog-functions` (email-templater, logs, invocations, configuration logic).
- **Inbound: no public barrel.** About 25 files outside the product deep-import it:
  - `frontend/src/lib/api.ts` and `types.ts`, which import `hogflows/types` and `steps/types`;
  - `lib/components/TaxonomicFilter`, `ActivityLog`, `CyclotronJob` and `lib/integrations`;
  - `scenes/hog-functions` (`EmailTemplater.tsx`, `emailTemplaterLogic.tsx`, `hogInvocationsLogic.tsx`), which makes it a **cycle** with the outbound edge;
  - `scenes/notebooks`, `cohorts`, `settings` and `onboarding`;
  - `products/persons` (4 files) and `products/conversations` (2 files).
- **Node:** the runtime is under `nodejs/src/cdp/services/hogflows/`, with 22 non-test files and 3.9k LOC:
  - `HogFlowExecutorService`, with its handler registry at `hogflow-executor.service.ts:159-171`;
  - `HogFlowManagerService` and `actions/`.
  - Related code sits in `services/hogflow-schedule/`, `schema/hogflow.ts` (zod `HogFlowSchema`, L304), `consumers/cdp-cyclotron-worker-hogflow.consumer.ts`, `consumers/cdp-hogflow-subscription-matcher.consumer.ts` and `services/messaging/` (5.2k LOC).
- **Other TS in the product:** `products/workflows/mcp/apps/` (8 files, 507 LOC, importing only `@posthog/mcp-ui` and `@posthog/quill`) and `manifest.tsx`.

### ReviewHog, stamphog and agent rules

- **ReviewHog** ships three canonical perspectives as skills: `products/review_hog/skills/review-hog-perspective-{contracts-security,logic-correctness,performance-reliability}`. None is about architecture.
  - Perspectives are `LLMSkill` rows prefixed `review-hog-perspective-` (`backend/reviewer/skill_loader.py:25`), enabled per team and user through `backend/api/perspectives.py`. A custom architecture perspective is therefore possible without code changes; that is where the non-lintable remainder could go.
  - The reviewer prompt says "Map the architecture first" (`backend/reviewer/prompts/issues_review/prompt.jinja:58`), but only as an investigation step.
  - The validation skill drops "Pure style / taste — naming, … import order" (`skills/review-hog-validation-criteria/SKILL.md:57`). Vocabulary rules such as `say-workflow-not-hog-flow` would be dropped as a result.
- **Stamphog**
  - `.stamphog/policy.yml` has deny categories auth, crypto_secrets, migrations, infra_cicd, billing, public_api, deps_toolchain and stamphog_policy. None is about architecture.
  - `.stamphog/review-guidance.md:26-28` lists "Code style, naming, … 'could be refactored better'" under "NOT showstoppers".
- **Agent guidance at documented level only:** `.claude/rules/*.md` are path-scoped (`paths:` frontmatter). `product-isolation.md` and `tach-boundaries.md` cover Python. `generated-api-types.md` and `kea-disposables.md` apply to `products/*/frontend/**`. None is specific to workflows.

### The 30 harvested rules: which are TS-side and lintable

These come from `docs/harvest/workflows/rules.json` in this repo. By "lintable" I mean a syntactic oxlint or ESLint rule over TS files, driven by a manifest.

| Class | Rules | Count |
|---|---|---|
| **Lintable on TS** | `registry-owns-trigger-and-step-types` (#14: ban trigger-type literals in `workflowLogic.ts`, as the harvest itself proposes with `no-restricted-syntax`); `say-workflow-not-hog-flow` (#29, the part about frontend copy: string and JSX text matching "hog flow") | 2 |
| **Partly lintable on TS** | `closed-type-sets-have-one-home` (#3: ban hand-declared action-type sets outside the registry; parity still needs a test); `test-runs-share-production-trigger-predicates` (#17: the `TriggerHandler` must import the consumer's predicate); `one-duration-grammar` (#21: duration parsing only through `duration.ts`) | 3 |
| TS, but owned by the type checker | `configs-are-typed-unions` (#15), `post-run-metrics-carry-the-message-version` (#20) | 2 |
| TS or cross-language, test-shaped | #16 template ids, #18 unroutable steps fail, #24 stored configs readable, #25 editor schema accepts server | 4 |
| TS, review-only | #19 silent degradations emit a counter | 1 |
| Python, or owned by tach and import-linter | #1, 2, 4–13, 22, 23, 26, 27 (tach), 30 (mostly serializer) | 17 |
| Agent-surface text (YAML, skills) | #28 | 1 |

The harvest's rules are mostly backend invariants, because reviewers correct those most. The TS-side chokepoints worth declaring first come from the import graph above, and the harvest does not contain them:

- a public surface for `products/workflows/frontend`, to replace the about 25 deep importers;
- the `scenes/hog-functions` ↔ workflows cycle;
- `hogflows/registry/` as the only place that registers triggers and steps.

## What I verified and what I inferred

**Verified by running or reading on this box:**
- the lint configs, scripts, CI steps, tach and import-linter entries, and the ReviewHog and stamphog text, with the line numbers above;
- the oxlint JS plugin wiring in both configs;
- the need for `meta.schema`;
- that a plugin setup error exits 1;
- all timings.

**Inferred, not tested:**
- that a manifest-only PR would ride stamphog's `extensions_only` fast path;
- that an `extends`-based wrapper config would behave like the in-place override;
- that tach treats modules with no interface as fully open (the docs imply it; I did not run tach).

**Not done:** timing the Node config with `typeAware` on, and running `tach` or `lint-imports`.
