You are reviewing the architecture of independent implementations of the same task in the PostHog monorepo. Each implementation is a diff against the repository as it was before the change. You do not know who or what wrote them; judge only the diffs. Everything you need is in this prompt: do not run commands or read files.

## Task

Part of #68. Specified by #79 ([spec](https://github.com/Silthus/posthog/issues/79#issuecomment-5760343402)), locked by #69 and #74.

## What to build

The package a customer installs, and the typed authoring surface inside it. `@posthog/workflows` lives at `products/workflows/packages/workflows/`, is `"private": true`, declares the bin name `posthog-workflows`, builds with `tsc`, copies quill's four-condition `exports` map and `files: ["dist"]`, and gets an explicit `pnpm-workspace.yaml` entry because the `products/*` glob matches one level only. There is no publish workflow at v1.

The authoring shape is one declarative record. A step is a value with no id and no position, so a step placed two times makes two nodes. A sub-path is a non-empty tuple, so an empty branch is a compile error. An action id is the slug of a required step name, unique inside the workflow, with an optional `id` override for a rename, and emit refuses two steps whose slugs collide. The v1 surface is the actions `trigger`, `delay`, `function`, `conditional_branch` and `exit`, the triggers `event` and `schedule`, a loose `.function({ template_id, inputs })` escape hatch, and a typed `.email()` with inline content that refuses `template_uuid`. `secret('ENV_NAME')` sits on the step value. The file carries `status`, default `draft`, and the variables with their default values, in the shape the existing serializer accepts: a list of `{key, type, default}` with unique keys, 5120 bytes in total. Every error carries `status`, `message`, `why` and `fix`. This ticket emits and validates a workflow definition; it ships no CLI.

Lift the type rules, the error contract and the emit shape from `prototype/workflows-composable-steps` by reading them. The branch is throwaway and is not merged.

## Write scope

- `products/workflows/packages/workflows/**`, except `src/cli/**`, which the CLI ticket owns
- `pnpm-workspace.yaml`

## Proof gate

- [ ] The definition round trip is identical
- [ ] A slug collision is refused with the four fields
- [ ] An empty sub-path is a compile error, pinned by a type test
- [ ] A duration literal refuses a value that is not a duration, from inside a `const`
- [ ] Variables over the size cap, and duplicate variable keys, are refused
- [ ] `pnpm --filter=@posthog/workflows build` and the package tests run green
- [ ] One emitted workflow definition is in the PR body

## Blocked by

Nothing. Starts immediately.

## Stack base and ship target

- Branch cut from `upstream/master`. This ticket touches none of the files the read-only branch touches.
- A PR against upstream `PostHog/posthog`, opened with `--head Silthus:<branch>`. Nothing merges into the fork's `master`.
- Stacking rules from the repo `CLAUDE.md`: use `gh stack`, keep the stack shallow, merge the base before you extend it. Never run `gh stack merge`. Never force-push a branch that is in the merge queue, and that includes restacking a stack whose base is queued.
- Invoke `/writing-tests`, `/writing-user-facing-copy` for every printed string, `/writing-code-comments`, `/reviewing-with-coderabbit` and `/writing-pr-descriptions`.


Prior art to read, not merge: `origin/prototype/workflows-composable-steps` (`products/workflows/prototypes/workflows-composable-steps/`, shape B declarative record with `steps: path(...)`), `origin/prototype/workflows-cli-generator` (loader and emit), `origin/prototype/workflows-as-code` (type-level rules, error contract `status`/`message`/`why`/`fix`, change-detection projection), `origin/research/workflows-package-shape` (`products/workflows/docs/research/workflows-package-shape.md`). Lift rules by reading them; build fresh.

## Scope
Exactly the ticket's write scope: `products/workflows/packages/workflows/**` except `src/cli/**` (that is #93), plus the `pnpm-workspace.yaml` entry. Locked facts: package name `@posthog/workflows`, `"private": true`, bin name `posthog-workflows` declared but the CLI entry itself is #93's (leave a stub only if the package does not build without it, and say so), build with `tsc`, four-condition `exports` map and `files: ["dist"]` copied from quill, no publish workflow, versioning deferred. SDK: shape B declarative record, `key` required on the workflow options, per-step required `name` with slug-derived action ids and optional `id` override, colliding slugs refused with the four error fields, `secret('ENV_NAME')` on the step value, `status` in source defaulting to `draft`, the v1 surface from #69 (prototype actions, event and schedule triggers, loose `.function()` escape hatch, typed email inline), emit to the workflow definition JSON that the real `HogFlowSerializer` accepts (read `products/workflows/backend/api/hog_flow.py` and the graph schema; do not fork the schema). Every error carries `status`, `message`, `why`, `fix`. Minimal: no feature the spec does not name, no abstraction for one caller. Michael's rule: minimal changes, no overengineering, YAGNI.

- No user-facing UI, so no screenshot; the package README counts as user-facing copy (`/writing-user-facing-copy`), keep it short, no real identity values in examples (locked on #72: the CLI refuses the placeholder).

## PostHog's architecture rules (products/architecture.md at the base commit)

# Modular Architecture & Isolated Testing

## Purpose

This document defines the future architectural direction for our Django monolith, focusing on:

- Establishing a clear, Django-friendly **folder structure** for product boundaries
- Using **frozen dataclasses** as the stable interface between products
- Introducing **facades** as the only public interface for products
- Enforcing **isolation** between products to avoid accidental cross-product coupling
- Enabling **selective testing** via Turbo (task caching) and tach (import boundary enforcement)

This is a forward-looking design document, not a migration guide.

### Terminology

Different tools use different names for the same concept:

- **Product** — a self-contained feature area under `products/<name>/`. This is the unit of isolation, ownership, and selective testing.
- **Django app** — the backend implementation of a product (`products/<name>/backend/`). Registered in `INSTALLED_APPS` via `AppConfig`.
- **Turbo package** — the build/test unit defined by `package.json`. One product = one Turbo package.
- **tach module** — the import boundary node in `tach.toml`. Maps 1:1 to a product (core code like `posthog` and `ee` are also tach modules).

This document uses **"product"** when talking about boundaries and architecture, and **"Django app"** only for Django-specific mechanics (models, migrations, `apps.py`).

# 1. Why Modularization?

As the codebase grows, running all tests for every change becomes expensive, and startup time of the dev server grows. Our goal:

- **Reduce CI time** via selective testing
- **Make product boundaries explicit**
- **Prevent accidental cross-product imports**
- **Preserve developer velocity as the system grows**

Turbo provides task-level caching so that:

- Only tests affected by a change run
- Contract files (frozen dataclasses, enums) determine whether downstream products need retesting

tach enforces Python import boundaries, ensuring dependencies are explicitly declared in `tach.toml`.

To benefit from selective testing, we must introduce architectural boundaries inside the Django monolith.

# 2. Turbo + tach (Initial Scope: Single Product)

We will begin by wiring up **one product** to:

- Validate the folder structure
- Test contract-based selective testing with Turbo
- Verify import boundary enforcement with tach
- Build the foundation for incremental test selection

Focus:

- One product = one Turbo package with `backend:test`; isolated products also declare `backend:contract-check`
- Non-isolated products must **not** declare `backend:contract-check` — `turbo-discover` uses this key to identify isolated products, and its presence causes selective testing to skip the full Django test suite
- Facade (`facade/api.py`) will define the **public interface**
- Internal files will be private implementation details
- Presentation layer (DRF) sits above the facade, outside the contract surface — but a product is only soundly skippable once that presentation is thin and reaches internals exclusively through the facade (see [What makes the skip sound](#what-makes-the-skip-sound)); an unsealed presentation that still holds business logic is not

Eventually this grows into:

- A dependency graph across products via contract inputs
- True selective test execution

But this document is about foundational structure, not full rollout.

### What makes the skip sound

Skipping the full suite for an isolated product is a claim that _a change inside the product can only break the product's own tests._
tach proves the import half of that claim — no external code reaches past `facade.*` / `presentation.views.*`.
It cannot prove the other half.
A product's HTTP API is exercised **in-process** by tests (the Django test client dispatches into the view stack in the same process, not over a real socket), and cross-cutting tests — permissions, schema, activity-log, "every viewset does X" — reach a product's endpoints by URL.
That couples them to the product's live behavior with **zero imports**, so it is invisible to tach, to `lint-imports`, and to any import-graph audit.
"No importers" is necessary, not sufficient.

Because this channel can't be enumerated, it is closed by construction rather than inspection:

1. Keep the presentation layer thin and reaching internals only through the facade, so every observable behavior lives either in the facade (tested in-product, inside the boundary) or in the serializer shape (the OpenAPI schema, whose changes already force the full suite).
2. Keep behavior tests in-product.
3. Keep the model surface — `backend/models/` (or `backend/models.py`) and `backend/migrations/` — in the `backend:contract-check` inputs.
   A model is reachable with no import: `apps.get_model("label", "Class")`, migrations, admin, fixtures.
   tach cannot see that, so a model or migration change always re-runs the full suite.
   `hogli product:lint` blocks a narrowing that leaves the surface out.

A product whose views still hold business logic is not soundly skippable even if nothing imports it.
This is also why "no in-process callers, so we don't need a facade" is the wrong test: a product whose only consumers are over HTTP (node services, the generated TS/MCP types) is _not_ facade-optional — there the facade's whole job is sealing its own presentation.
The genuine exception is a product with essentially no Django-side logic (a thin shim over an external service): it has nothing to seal, but it is then simply not isolated — no `backend:contract-check`, still paying the full suite — which is an accept-the-cost choice, not "isolated without a facade".

### Wiring couplings

Core sometimes needs behavior from a product, not data: query runners it dispatches on, Temporal workflows it registers, Max tools it offers.
These cross the boundary as classes — allowed only under all three rules:

1. **Approved interface.**
   The class implements a core-owned base from the approved list — today `QueryRunner` (`posthog/hogql_queries/query_runner.py`), `MaxTool` (`ee/hogai/tool.py`), Temporal's `@workflow.defn`/`@activity.defn`, and Celery's `@shared_task`.
   Core code may rely only on the base's interface, never on product-specific members.
   Extending the list is a core PR: define the base and validate at the registration point.
   DRF viewsets are not part of this channel: they live in `presentation/`, register through `routes.py`, and never pass through the facade (a facade must not import DRF, and not its own `presentation/`; the `facade must not import presentation or DRF` import-linter contract enforces both, with the existing violations grandfathered in its TODO list) — their soundness is governed by the presentation rules above.
2. **Designated location.**
   The implementation lives in the product's wiring location — `backend/hogql_queries/`, `backend/max_tools.py`, `backend/temporal/`, `backend/tasks/` (a flat `backend/tasks.py` also qualifies).
   An isolated product keeps a wiring location in its `backend:contract-check` inputs while a test outside the product can execute what lives there, so such a change still re-runs the full suite.
   The full suite matters only while such a test exists.
   For `backend/hogql_queries/` that is measured.
   Core dispatches runners by query kind, so `hogli product:crossings` reads the dispatch table and records every outside test that runs one of the product's kinds, or imports anything from the location, as a `drives(...)` line in the crossings baseline.
   A test whose kind the scan cannot read statically counts as `drives(unresolved-kind)` against every query location it could reach, so an unreadable spelling holds the inputs instead of releasing them in silence.
   `hogli product:lint` keeps the location in the inputs while a line for it stands, and lets it go when none does.
   Nothing is declared. Move the driving tests into the product, regenerate the baseline, and the input may leave.
   A location with several subtrees may be watched one subtree at a time.
   `product_analytics` watches `backend/hogql_queries/trends/` alone, because trends is the only subtree an outside test still drives, so its funnels, retention, lifecycle, paths and stickiness runners change without re-running the suite.
   The lint reads coverage per location rather than per subtree, so it cannot hold that scope; the repo invariant `test_product_analytics_drives_only_the_watched_subtree` does, and it fails when a line names code outside the watched subtree.
   The other locations stay in the inputs by presence until their channel (Celery task names, Temporal workflow names, Max tool names) is read the same way.
3. **Validated registration.**
   Registration points check `issubclass(cls, Base)` and reject anything else.
   Import linters (tach, import-linter) see only the import graph; _what an object is_ can only be checked at runtime, at the door.
   `ee/hogai/registry.py` (MaxTool) is the reference implementation: subclass auto-registration with validation.

Django models never cross, with or without an approved base.
A model cannot be narrowed: whatever interface it presents, the object still carries managers, `save()`/`delete()`, FK descriptors that query other tables on attribute access, and reverse relations added by other apps.
Two core registries are keyed by model class identity and are explicit, sanctioned exceptions: the team-extension registry and the file-system unfiled registry (`FileSystemSyncMixin`).
There the class crosses for registration only, core drives only the registry's mixin methods, and the model's module must stay in the product's contract-check inputs.

**The watched-models allowance** is the one further, deliberately temporary exception, for products whose models are load-bearing substrate that core and sibling products consume and cannot yet stop consuming.
Two products hold entries.
`warehouse_sources`: core HogQL reads its warehouse table/schema/source models to build queryable tables.
`ExternalDataDestination`, `ExternalDataSourceDestination` and `ExternalDataSchemaDestination` cross for the same reason as the rest of the product's models — the destination CRUD `ModelViewSet` and the source-/schema-level link-table editors need the classes themselves for `Meta.model`, querysets, and edits to the link rows, not a read-only shape.
`product_analytics`: `Insight` and `InsightVariable`.
Core and seven products (alerts, dashboards, surveys, annotations, exports, customer_analytics, pulse) hold ForeignKeys or M2Ms into `Insight` — dashboard tiles, subscriptions and exported assets, sharing configurations, tagged items — and rely on cascade deletes, relation traversal, reverse relations, and queryset-typed access-control filtering that a frozen contract cannot express.
`InsightVariable` has no consumer left outside the product; its entry survives only because the SQL-variables `ModelViewSet` in `presentation/` needs the class and presentation may reach internals only through the facade, so retiring the entry means converting that viewset off `ModelSerializer` first.
The dashboards→product_analytics `DashboardTile.insight` FK and `Dashboard.insights` M2M-through cross into the product against §8's direction rule; that coupling is accepted under this entry until dashboards pursues its own isolation.

An allowance product's facade may hand out model classes defined under `backend/models/`.
The model surface is watched by every narrowed product anyway (see [What makes the skip sound](#what-makes-the-skip-sound)); the allowance adds only the permission to hand out the class.
That is the same soundness contract wiring locations have; what it does not buy is isolation — the coupling to core remains, `hogli product:lint` keeps a standing warning on it, and the direction of travel is still facade functions returning contracts.
The list lives in `MODEL_CROSSINGS` (`tools/hogli-commands/hogli_commands/product/isolation.py`) and is keyed `(product, class)`, like the carve-outs above: a class that is not listed is a leak and blocks narrowing, so a product already on the list cannot grow a new crossing without a doctrine change.
It only shrinks.
Adding an entry requires amending this section to name the class and why it cannot yet be a contract.

**The consumer side is default-deny.**
A crossing class may appear in consumer code only in a shape that `hogli product:crossings` identifies as instance-free.
These shapes are allowed:

- an annotation, on an argument, a return, or a variable;
- `X.DoesNotExist`;
- a nested class attribute, such as `X.Status` or `X.PrivilegeLevel`;
- `X._meta`;
- a manager chain that ends in `values()`, `values_list()`, `count()`, `exists()`, or `aggregate()`;
- a manager chain that `Exists(...)` or `Subquery(...)` embeds.

Every other use is disallowed.
The check does not ask what the consumer intended.
If the check does not identify a use as instance-free, change the caller.

**Move the code, do not permit it.**
Code that queries, serializes, or writes a model belongs in that model's product.
A consumer that holds such code is misplaced code, not a coupling to document.
Move the code into the owning product.
The facade function is what the move leaves behind.
The consumer keeps the orchestration and the ids.

**`apps.get_model` is ratcheted for every product model.**
`apps.get_model('label', 'Class')` reaches a model through the Django app registry.
It leaves no import edge, so tach and import-linter cannot see it.
The scan therefore does not stop at the watched-models allowance on this channel: a reference from outside the owning product to any class on any product's model surface is counted as the disallowed kind `get_model`.
Test modules stay out of scope, which is a blind spot, not permission.
A core test fixture that reaches a model this way is not counted here and, with no import edge, not selected by snob when the model changes.
Seed product rows through a facade write function, or through a `facade/testing.py` helper for fixture-only needs, instead; any other exposed module is a legacy interface leak.
Migrations stay out of scope too: a migration reaches a model through the historical registry, and that is the only way a migration can.
Production code may not add one.

**The ratchet.**
`products/model_crossing_uses_baseline.txt` records every disallowed use still in the tree: one line for each model class, consumer module, kind, and count.
`drives(...)` lines record the tests outside a product that execute its query runners.
They are keyed by the product's `backend/hogql_queries/` location instead of a class, and read from test modules only.
A new line is a new outside test that drives product code, and that test belongs in the product.
`facade-*` lines record what a facade signature promises, read from the facade itself rather than from a caller.
A repo-invariant test compares that file against a fresh scan, in both directions.
A count can go down.
A count must not go up.
A use that goes away must leave the file in the same change.
Run `hogli product:crossings <product>` to see the uses of one product's classes.
Run `hogli product:crossings --all --write-baseline` to record a decrease.

**The baseline only shrinks.**
`--write-baseline` refuses to write when the scan holds a line the file does not, prints those lines, and changes nothing, so a new coupling cannot enter by regenerating.
A coupling that must stand is a hand-edited line in the baseline plus a note here that says why it stands.
Both are in the diff, which is what a reviewer reads; a regenerated line is not.

**What the check cannot see.**
The check reads uses of the class name, plus `get_model` string references.
It does not read three things:

- attribute access on an instance the consumer already holds, inside a function body;
- traversal of a foreign key that the consumer's own model declares;
- a `get_model` call whose app label or model name is a variable.

All three are a declared residual, not permission to add more.

A behavioral class that fits no approved interface must not cross at all.
Wrap it in a facade function returning contracts, or register a plain function (see the managed-view provider registry in `products/data_modeling/backend/facade/managed_viewset_hooks.py`).
A product whose facade hands out unapproved behavior is not soundly isolated: it loses `backend:contract-check` and pays the full suite until fixed.

**Inbound webhook consumers are a designated location of the same kind.**
A product declares its handlers in `backend/webhook_consumers.py`, in a `WEBHOOK_CONSUMERS` sequence.
`posthog/ingress/` discovers that module through `load_product_modules("webhook_consumers")` on the first delivery, and its registry validates each consumer at build: an unknown provider app, a name already taken for that provider, or an event type the provider does not declare raises.
No class crosses, because a consumer is a plain function behind a frozen contract, and an import-linter contract holds the module to its own product's `facade/`.
See [posthog/ingress/README.md](/posthog/ingress/README.md).

Why shape rules rather than location rules: publicness-by-location without a constrained API shape rots.
Shopify's Packwerk `app/public` folders became a "catch-all drawer" of models, controllers, and jobs for exactly this reason.
The facade stays honest only if what crosses is a frozen dataclass or an implementation of a core-owned interface — nothing else.

# 3. Folder Structure

Each product adopts the following structure:

```text
myproduct/
  backend/
    __init__.py
    apps.py
    models.py          # Django ORM only
    logic.py           # Business logic
    logic/             # ...or a package, once logic.py outgrows one file

    tasks/
      __init__.py
      tasks.py         # Celery entrypoints (call facade)
      schedules.py     # Celery beat / periodic config (optional)

    management/
      commands/
        <command>.py   # CLI entrypoints (parse args, call facade)

    facade/
      __init__.py
      api.py           # Facade (the only thing other products may import)
      contracts.py     # Frozen dataclasses (+ enums if small enough)
      enums.py         # Optional: exported enums/shared types when contracts.py grows

    presentation/
      __init__.py
      serializers.py   # DRF serializers (frozen dataclasses <-> JSON)
      views.py         # DRF views (HTTP endpoints)
      urls.py          # HTTP routing

    routes.py          # register_routes(routers): the one module core reads to mount the views

    tests/
      test_models.py
      test_logic.py
      test_api.py            # Facade tests
      test_presentation.py   # DRF integration tests
      test_tasks.py
```

### Why this layout?

- Matches Django conventions — low friction
- Keeps business logic separate from HTTP concerns
- Keeps the product root clean
- Provides an explicit, enforced boundary (`facade/`)
- Scales naturally with contract-based selective testing

### Which locations are fixed, and which are yours

Only the paths the tooling is pointed at have fixed names: `facade/`, `presentation/`, `tasks/`, `routes.py`, `webhook_consumers.py`, and the wiring locations (`hogql_queries/`, `max_tools.py`, `temporal/`) — see [Wiring couplings](#wiring-couplings).
They are the narrowed `backend:contract-check` inputs, and two import-linter contracts hold the HTTP surface inside them by shape: `routes.py` may only import `presentation/`, and `presentation/` may only import `facade/`.
Core reaches a product's views only through `routes.py`, so the chain core → routes → presentation → facade is three import edges, and a view anywhere else simply cannot be routed.
`hogli product:lint` holds the same two rules by reading the imports directly, because import-linter cannot see a module under a directory without `__init__.py`.

Everything else under `backend/` is internal implementation.
`logic/` is the default home and the scaffold creates it as a package, but as a domain grows into `services/`, `queries/`, `reviewer/`, or whatever it is called in that product, no lint polices the name.
Nothing outside the product can import those packages, and their changes are exactly what the isolation skip is meant to skip.
The boundary is the shape of what crosses the facade, not the location of what stays behind it.

For the broader monorepo structure (products, services, platform), see [monorepo-layout.md](/docs/internal/monorepo-layout.md).

# 4. Contracts (`contracts.py`)

Each product defines its public interface as **frozen dataclasses** in `backend/facade/contracts.py`. These are the only data structures that cross product boundaries — facades accept and return them, and other products import them.

### Rules:

- No Django imports
- Immutable (`frozen=True`)
- Small, hashable, stable
- Facades accept them as inputs and return them as outputs

### Choosing a dataclass flavor

Stdlib `dataclasses.dataclass` is the baseline.
`pydantic.dataclasses.dataclass` is the preferred upgrade when construction-time validation is useful:
it keeps full dataclass semantics (passes `is_dataclass()`, works with `DataclassSerializer`, identical kwargs construction, `frozen=True`, `field(default_factory=...)`)
and adds Pydantic's runtime type validation as a 1-line import swap.

Use `pydantic.BaseModel` only when a contract genuinely needs features that dataclasses don't have — field aliases (e.g., camelCase wire / snake_case Python), computed fields exposed in the schema, custom validators, discriminated unions.
Stay with one of the dataclass flavors otherwise;
switching to `BaseModel` loses `is_dataclass()`-based tooling.

DTO validation is **best-effort, not HTTP validation**.
DRF serializers (or Pydantic schemas at the HTTP boundary) own the contract for untrusted input.
Pydantic dataclass validation catches construction-site mistakes inside the backend — structural mismatches from mappers, malformed data from internal callers — close to the bug rather than at the wire.

Note that Pydantic v2 dataclasses coerce inputs where the conversion is unambiguous (string → UUID/datetime, int → str) rather than reject them.
Structural mistakes (None for a required int, dict where a list is expected, unparseable UUID) still raise `ValidationError`.
If a contract genuinely needs strict typing — e.g., to catch a string sneaking into a UUID field — opt in per-contract via `@dataclass(frozen=True, config=ConfigDict(strict=True))`.

### Example

```python
from pydantic.dataclasses import dataclass


@dataclass(frozen=True)
class Artifact:
    id: UUID
    project_id: int
    content_hash: str
    storage_path: str
    width: int
    height: int
    size_bytes: int
    created_at: datetime
```

Contracts **should not depend on**:

- Django models
- DRF serializers
- Request objects

If input and output shapes are identical, reuse the same dataclass.

# 5. Facades: The Public Interface

Each product exposes a facade via the `backend/facade/` package — the only place core and other products may import from (tach enforces this).
`api.py` holds the data capabilities: functions that accept and return contracts.
Capability submodules (`queries.py`, `temporal.py`, `max_tools.py`, `tasks.py`, …) exist only to re-export wiring implementations — see [Wiring couplings](#wiring-couplings) — and contain no logic of their own.

### Responsibilities

- Accept frozen dataclasses as input parameters
- Call business logic (`logic.py`)
- Convert Django models → frozen dataclasses before returning
- Enforce transactions where needed
- Remain thin and stable

### Do NOT:

- Implement business logic (use `logic.py`)
- Import DRF, HTTP, or serializers
- Expose Django models or return ORM instances

### Example

```python
class ArtifactAPI:
    @staticmethod
    def create(params: CreateArtifact) -> Artifact:
        instance = logic.create_artifact(params)
        return _to_artifact(instance)
```

### Contracts inside the product

A product's own `logic.py` may take its contracts as arguments, as `logic.create_artifact(params)` above does; internals importing `facade.contracts` and `facade.enums` is expected, not a layering violation.
Keep the wire in mind: a contract that also backs a `DataclassSerializer` request body is the HTTP shape shipped clients send.
Pass it through while its fields are one-to-one with what logic needs, and split off an internal parameter object at the first real divergence — dead or deprecated wire fields, values logic needs that the wire must not accept, invariants the wire can't promise.
That split lives in the facade, the only in-process caller.
Never widen a type on the way in: if logic needs a `str`, don't accept a contract with `str | None` and add a runtime guard.
See `/writing-dataclasses` for the general rule.

### Why explicit mappers?

Facades convert ORM models to frozen dataclasses via mapper functions. These look repetitive when fields align 1:1:

```python
def _to_artifact(instance) -> contracts.Artifact:
    return contracts.Artifact(
        id=instance.id,
        content_hash=instance.content_hash,
        # ... more fields
    )
```

The value isn't the copying — it's having **one place** where "internal" becomes "external":

1. **Explicit boundary** — the frozen dataclass defines exactly what callers receive. Internal fields don't accidentally leak.
2. **Transformation point** — add computed fields, flatten relations, rename for consistency.
3. **Drift absorption** — when models and the exposed dataclass diverge, the mapper absorbs it instead of changes leaking everywhere.

The alternative — returning ORM objects — works until it doesn't, then you're retrofitting isolation under pressure.

# 6. Business Logic (backend/logic/)

Business logic lives here: validation, calculations, business rules, ORM queries.
Further internal packages beside it are fine (see [Which locations are fixed](#which-locations-are-fixed-and-which-are-yours)).

Start as a single `logic.py`.
Once it outgrows one file, split it into a `logic/` package with one module per concern and mirror that split in `tests/logic/` — `products/visual_review/backend/logic/` is the reference, and `/splitting-oversized-modules` does the move.
Import the submodule you need (`from .logic import runs`) rather than re-exporting through `__init__.py`: one binding per symbol keeps it obvious where behavior lives and keeps test patch targets on the real definition.

Examples:

- Deduplication rules
- Business invariants
- Cross-field validations
- Idempotency checks

### Why separate from the facade?

- Facades must stay thin and stable
- Presentation should not contain business rules
- Frozen dataclasses remain pure data
- Logic is internal implementation — changes here don't affect other products' tests

# 7. Presentation Layer (DRF)

Located in `backend/presentation/`.

Responsibilities:

- Validate incoming JSON (via DRF serializers)
- Convert incoming JSON → frozen dataclasses
- Call facade methods
- Convert frozen dataclasses → JSON responses
- No business logic

Presentation may only import `facade` and other `presentation` modules within the same product. It must not import `models`, `logic`, or any other internal module directly — even utility modules like `cache.py` or `permissions.py`. This is enforced by import-linter in CI.

`backend/routes.py` may only import `presentation` — it exists to hand the views to core's router (`register_routes(routers)`), nothing else. Also enforced by import-linter; a product whose routes still register views from `backend/api/` carries a grandfathered `ignore_imports` line, and `hogli product:maturity` counts it as an open presentation bypass until `hogli product:isolate:move` relocates them.

### Where do cross-cutting utilities go?

If both presentation and logic need the same utility (caching, permissions, etc.), putting it at `backend/cache.py` and importing from both layers creates an "accidental shared kernel" — a hidden coupling that bypasses the facade. Instead:

- **Presentation concern** (response caching, rate limiting, user RBAC — see below) → `presentation/`
- **Business concern** (domain-level caching, tenant scoping, domain invariants) → `logic/`, exposed through the facade
- **Both layers need it** → that's a signal the boundary is drawn wrong; refactor

### Who owns RBAC?

User RBAC stays on the **viewset** — it depends on the authenticated `request`/`user`, which the facade doesn't have (facades also run from Celery, CLIs, and other products). Declare it the standard way: `scope_object` plus `scope_object_read_actions`/`scope_object_write_actions`, and let the shared permission classes (`APIScopePermission`, `AccessControlPermission`) on `TeamAndOrgViewSetMixin` enforce API-scope and resource access. See `products/visual_review/backend/presentation/views.py`.

The facade owns **tenant scoping** (`team_id` enforced via `for_team(team_id)` / a `ProductTeamModel` fail-closed manager) and **domain invariants** (state machines, idempotency) — these must hold for every caller, so they live below the HTTP boundary; user RBAC must not. Keeping RBAC in the shared DRF stack also lets cross-cutting permission tests enforce it consistently across products.

### Why not mix with the facade?

- Keeps HTTP concerns decoupled
- Allows reusing business logic for async tasks, CLI, future services

### Don't API views leak implementation?

No. Views only call facades, and facades only return frozen dataclasses. The presentation layer remains decoupled from internal details — when the facade hasn't changed, nothing outside the product is affected.

### Management commands

`backend/management/commands/` is an entrypoint, the same as presentation and `tasks/`. A command reads its arguments, calls the facade, and writes its output through `self.stdout` and `self.stderr`. Do not put business logic in a command.

The import-linter contract applies only to `presentation/`. It does not include this directory. Reviewers must enforce this rule.

A command sometimes needs a capability that the facade does not have. Add the necessary facade function. Do not import `logic` or `models` in the command.

# 8. Isolation Rules

### Forbidden

- Importing another product's `models.py` directly
- Importing anything from another product's `logic.py`
- Importing views or serializers from another product
- Returning ORM objects from facades

### Allowed

- Importing another product's `backend.facade` (the facade)
- Using frozen dataclasses returned by facades
- Calling business logic from within the same product
- Presentation calling its own product's facade

### Concrete examples

**Product A needs data from Product B — use the facade:**

```python
# products/revenue_analytics/backend/logic.py
from products.data_warehouse.backend.facade import DataWarehouseAPI

# OK: calling the facade, getting back frozen dataclasses
tables = DataWarehouseAPI.list_tables(team_id=team_id)
```

Not this:

```python
# WRONG: importing models directly from another product
from products.data_warehouse.backend.models.table import DataWarehouseTable
tables = DataWarehouseTable.objects.filter(team_id=team_id)
```

**Product exposing functionality — keep the facade thin:**

```python
# products/signals/backend/facade/api.py — real example from the codebase
async def emit_signal(team_id, source_product, source_type, source_id, description, weight):
    """Other products call this. They never touch signals' models or internals."""
    ...
```

**Using contracts from another product:**

```python
# products/other_product/backend/logic.py
from products.visual_review.backend.facade.contracts import Artifact

def process_artifact(artifact: Artifact) -> None:
    # artifact is a frozen dataclass, not an ORM object
    ...
```

### What tach enforces

Global `[[interfaces]]` blocks in `tach.toml` control which paths inside a product other modules can import. All modules — including core (`posthog`, `ee`) — sit in a single `modules` layer, so interface enforcement applies everywhere. tach will reject any import that doesn't go through the declared `expose` patterns.

Products with legacy interface leaks (where core still imports internals directly) get explicit blocks in `tach.toml` and have `backend:contract-check` removed so CI doesn't treat them as safely isolated. Run `hogli product:lint` to see which products have leaks.

### What import-linter enforces

[import-linter](https://github.com/seddonym/import-linter) enforces internal product architecture: presentation layers must not import any backend internals directly — they can only reach `facade` and other `presentation` modules. This is configured as a single forbidden contract in `pyproject.toml` that blocks `products.*.backend` from presentation, with allowlist ignores for facade and self-imports. Any new internal module (cache, helpers, etc.) is blocked automatically.

tach handles _inter_-module boundaries (what can cross a product boundary). import-linter handles _intra_-product architecture (how code is structured within a product). Both run in CI.

> [!TIP]
> Use the `isolating-product-facade-contracts` skill for the full migration workflow — it covers contracts, facades, caller migration, and boundary enforcement step by step.

During migration, existing cross-product model imports are tracked in `tach.toml` `depends_on`. The goal is to replace them with facade calls over time.

### Cross-product foreign keys

Django allows `ForeignKey` relationships across products. A relation that crosses a boundary creates an **implicit reverse dependency**, even if you never use it:

```python
# visual_review/backend/models.py
project = models.ForeignKey(Project, ...)
```

Django auto-generates a reverse accessor (`project.visualreview_set`), a reverse query name (`filter(visualreview__...)`), migration dependencies, and app loading order dependencies. No import checker can see the accessor, yet any caller can traverse it.

**Rule:** declare every relation field (FK, O2O, M2M) that crosses a product boundary with `related_name="+"`, and do not set an explicit `related_query_name` on it. `related_name="+"` alone removes the reverse accessor and the reverse query name; an explicit `related_query_name` keeps `filter()` traversal alive, and the ratchet records it as a `query:<name>` row. A product may point relations _at_ core models; other products must not reference models _inside_ this product. When a caller needs reverse access, add a facade read function — do not traverse the ORM.

A repo invariant enforces this: every cross-boundary reverse accessor is frozen as a `reverse-accessor(...)` line in `products/model_crossing_uses_baseline.txt`, next to the other crossing kinds. The set may only shrink. A new relation without `related_name="+"` fails CI until you seal it or a review adds a hand-edited baseline line. Regenerate after a removal with `bin/hogli product:crossings --all --write-baseline`.

`db_constraint` is a separate concern: it is migration safety (see the hot-table FK rules in [products/README.md](README.md)) and multi-database planning, not Python isolation. Both `db_constraint=False` and a two-phase validated constraint are sanctioned.

# 9. Turbo Tasks & Contract-Based Testing

Each product is a Turborepo package with tasks defined in its `package.json`.

## Contract files vs. implementation files

Turbo uses file-based inputs to determine cache validity. The key distinction:

**Contract inputs** (used by `backend:contract-check`):

- `backend/facade/contracts.py` — frozen dataclasses (enums can live here too)
- `backend/facade/enums.py` — optional, for exported enums/constants/shared types when contracts.py grows
- the product's wiring locations (`backend/hogql_queries/`, `backend/max_tools.py`, `backend/temporal/`, `backend/tasks/`) — implementations core registers and drives (see [Wiring couplings](#wiring-couplings)); `backend/hogql_queries/` may leave the list once the crossings baseline records no outside test driving it, the others stay by presence

**Implementation inputs** (used by `backend:test`):

- All `backend/**/*.py` files

Other products depend on a product's **contract files only**. When contract files haven't changed, downstream products don't need retesting.

**Import boundaries** are enforced by tach via global `[[interfaces]]` blocks in `tach.toml`. This ensures products don't accidentally import each other's internals, which would break the contract-based isolation model. See the `isolating-product-facade-contracts` skill for the migration workflow.

**Dependency rules for contract files (keep them pure):**

- No Django imports (`from django.*`)
- No DRF imports (`from rest_framework.*`)
- Use stdlib for errors, not `django.core.exceptions`
- No `from_model()` methods — put conversion in implementation code

## How selective testing works

```text
other_product tests
       | depends on
visual_review contracts  (facade/contracts.py, facade/enums.py)
       | does NOT depend on
visual_review impl       (logic.py, models.py)
```

**Scenario: Change `visual_review/logic.py`**

- `visual_review backend:test` → reruns (impl files changed)
- `visual_review backend:contract-check` → cache hit (contract files unchanged)
- `other_product backend:test` → skipped (depends only on contracts, which didn't change)

## CI commands

```bash
# Run all product tests
pnpm turbo run backend:test

# Run specific product tests
pnpm turbo run backend:test --filter=@posthog/products-visual_review

# Run contract checks
pnpm turbo run backend:contract-check
```

# 10. Summary

This document outlines the **future direction** of our codebase:

- Django-idiomatic layout with product boundaries
- Frozen dataclasses as the stable interface between products
- Thin facades as the only public interface
- Business logic isolated and testable
- DRF presentation decoupled from core logic
- Turbo for task caching and selective test execution
- tach for Python import boundary enforcement

This architecture reduces coupling, enables selective testing, and keeps the system maintainable as we grow.


## Diff X

Files:
- pnpm-lock.yaml (modified, +9 -0)
- pnpm-workspace.yaml (modified, +2 -0)
- products/workflows/packages/workflows/.gitignore (added, +1 -0)
- products/workflows/packages/workflows/README.md (added, +71 -0)
- products/workflows/packages/workflows/package.json (added, +43 -0)
- products/workflows/packages/workflows/src/definition.ts (added, +99 -0)
- products/workflows/packages/workflows/src/errors.ts (added, +24 -0)
- products/workflows/packages/workflows/src/index.ts (added, +5 -0)
- products/workflows/packages/workflows/src/steps.ts (added, +84 -0)
- products/workflows/packages/workflows/src/workflow.ts (added, +202 -0)
- products/workflows/packages/workflows/test/emit.ts (added, +194 -0)
- products/workflows/packages/workflows/test/type-rules.ts (added, +36 -0)
- products/workflows/packages/workflows/tsconfig.build.json (added, +7 -0)
- products/workflows/packages/workflows/tsconfig.json (added, +18 -0)

```diff
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 688810f9bc8..9ae7c0b2089 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -5222,6 +5222,15 @@ importers:
         specifier: 'catalog:'
         version: 0.2.4(kea@4.0.0-pre.6(patch_hash=139b8d1f1304f9d9da452a9a1244c94ea679dbcb85687d8999563146879fb6f5)(react@18.3.1))
 
+  products/workflows/packages/workflows:
+    devDependencies:
+      '@types/node':
+        specifier: 'catalog:'
+        version: 22.18.8
+      typescript:
+        specifier: 6.0.3
+        version: 6.0.3
+
   rust/common/hogvm/node: {}
 
   rust/replay-anonymizer-node:
diff --git a/pnpm-workspace.yaml b/pnpm-workspace.yaml
index 73322eb3b23..a291628784f 100644
--- a/pnpm-workspace.yaml
+++ b/pnpm-workspace.yaml
@@ -16,6 +16,8 @@ packages:
     - nodejs
     - nodejs/src/scripts
     - products/*
+    # products/* matches one level only, so a nested product package is listed by path.
+    - products/workflows/packages/workflows
     # products/desktop is a nested standalone workspace (own lockfile, catalog,
     # overrides, Node version); the root install must not absorb it.
     - '!products/desktop'
diff --git a/products/workflows/packages/workflows/.gitignore b/products/workflows/packages/workflows/.gitignore
new file mode 100644
index 00000000000..849ddff3b7e
--- /dev/null
+++ b/products/workflows/packages/workflows/.gitignore
@@ -0,0 +1 @@
+dist/
diff --git a/products/workflows/packages/workflows/README.md b/products/workflows/packages/workflows/README.md
new file mode 100644
index 00000000000..66922f22cfb
--- /dev/null
+++ b/products/workflows/packages/workflows/README.md
@@ -0,0 +1,71 @@
+# @posthog/workflows
+
+Define PostHog workflows in TypeScript and emit the workflow definition that the PostHog API accepts.
+
+```ts
+import { path, secret, step, trigger, workflow } from '@posthog/workflows'
+
+const notifyCrm = step.function({
+  name: 'Tell the CRM',
+  template_id: 'template-webhook',
+  inputs: { url: 'https://example.com/hooks/onboarding', signing_secret: secret('CRM_TOKEN') },
+})
+
+export default workflow({
+  key: 'onboarding',
+  name: 'Onboarding',
+  trigger: trigger.event({ event: 'user signed up' }),
+  steps: path(
+    step.delay({ name: 'Wait a day', duration: '1d' }),
+    step.branch({
+      name: 'Which plan?',
+      branches: [
+        {
+          name: 'Paid plan',
+          when: [{ key: 'plan', type: 'person', operator: 'exact', value: ['paid'] }],
+          then: path(
+            step.email({
+              name: 'Welcome',
+              to: { email: '{{ person.properties.email }}' },
+              subject: 'Welcome',
+              text: 'Thanks for upgrading.',
+              html: '<p>Thanks for upgrading.</p>',
+            }),
+            notifyCrm
+          ),
+        },
+      ],
+    }),
+    notifyCrm
+  ),
+  exit: { reason: 'Onboarding finished' },
+})
+```
+
+`workflow(...).emit()` returns the definition, or throws a `WorkflowError` with `status`, `message`, `why` and `fix`.
+
+## Steps
+
+| Step              | Emits                                                         |
+| ----------------- | ------------------------------------------------------------- |
+| `step.delay()`    | A `delay`. The duration is a number and `d`, `h`, `m` or `s`. |
+| `step.function()` | A `function` that runs any template by `template_id`.         |
+| `step.email()`    | A `function_email` with the content in the step.              |
+| `step.branch()`   | A `conditional_branch`. Each branch runs its own path.        |
+
+A workflow starts at `trigger.event()` or `trigger.schedule()` and ends at `exit`.
+
+## Action ids
+
+Each step has a `name`, and its action id is the name in lowercase with `_` between words. `Wait a day` becomes `wait_a_day`.
+
+- To rename a step and keep its id, set `id` to the old id.
+- If two different steps get the same id, `emit()` refuses the workflow. Rename one of them or set `id`.
+- If you place the same step value twice, the second placement gets `_2` at the end of its id.
+
+## Workflow options
+
+- `key` identifies the workflow across pushes. Keep it when you rename the workflow.
+- `status` is `draft`, `active` or `archived`. The default is `draft`.
+- `variables` is a list of `{ key, type, default }`. Keys must be unique, and the list must fit in 5120 bytes.
+- `secret('ENV_NAME')` names an environment variable for a function input. The file holds the name and never the value.
diff --git a/products/workflows/packages/workflows/package.json b/products/workflows/packages/workflows/package.json
new file mode 100644
index 00000000000..c5bd46983ce
--- /dev/null
+++ b/products/workflows/packages/workflows/package.json
@@ -0,0 +1,43 @@
+{
+    "name": "@posthog/workflows",
+    "version": "0.0.1",
+    "private": true,
+    "description": "Define PostHog workflows in TypeScript.",
+    "license": "MIT",
+    "repository": {
+        "type": "git",
+        "url": "https://github.com/PostHog/posthog.git",
+        "directory": "products/workflows/packages/workflows"
+    },
+    "bin": {
+        "posthog-workflows": "./dist/cli/index.js"
+    },
+    "files": [
+        "dist"
+    ],
+    "type": "module",
+    "main": "./dist/index.js",
+    "module": "./dist/index.js",
+    "types": "./dist/index.d.ts",
+    "exports": {
+        ".": {
+            "types": "./dist/index.d.ts",
+            "import": "./dist/index.js",
+            "require": "./dist/index.js",
+            "default": "./dist/index.js"
+        },
+        "./package.json": "./package.json"
+    },
+    "scripts": {
+        "build": "tsc -p tsconfig.build.json",
+        "typecheck": "tsc --noEmit",
+        "test": "tsc --noEmit && node --test test/emit.ts"
+    },
+    "devDependencies": {
+        "@types/node": "catalog:",
+        "typescript": "catalog:"
+    },
+    "engines": {
+        "node": ">=22.18"
+    }
+}
diff --git a/products/workflows/packages/workflows/src/definition.ts b/products/workflows/packages/workflows/src/definition.ts
new file mode 100644
index 00000000000..f0ec6a23159
--- /dev/null
+++ b/products/workflows/packages/workflows/src/definition.ts
@@ -0,0 +1,99 @@
+// The workflow definition: the JSON body that HogFlowSerializer accepts on
+// POST and PATCH /api/projects/{id}/hog_flows/ (products/workflows/backend/api/hog_flow.py).
+
+/** A duration as the serializer reads it: a number, then one of d, h, m or s. */
+export type Duration = `${number}${'d' | 'h' | 'm' | 's'}`
+
+export interface PropertyCondition {
+    readonly key: string
+    readonly type: 'event' | 'person' | 'group'
+    readonly operator: 'exact' | 'is_not' | 'icontains' | 'not_icontains' | 'is_set' | 'is_not_set' | 'gt' | 'lt'
+    readonly value?: readonly (string | number | boolean)[]
+}
+
+export type TriggerConfig =
+    | {
+          readonly type: 'event'
+          readonly filters: {
+              readonly events: readonly {
+                  readonly id: string
+                  readonly name: string
+                  readonly type: 'events'
+                  readonly order: number
+                  readonly properties: readonly PropertyCondition[]
+              }[]
+              readonly properties: readonly PropertyCondition[]
+              readonly filter_test_accounts: boolean
+          }
+      }
+    | { readonly type: 'schedule' }
+
+/** Holds the name of an environment variable. The value is resolved when the workflow is pushed. */
+export interface SecretRef {
+    readonly __posthog_secret: string
+}
+
+export interface EmailMessage {
+    readonly from: { readonly integrationId?: number }
+    readonly to: { readonly email: string }
+    readonly subject: string
+    readonly text: string
+    readonly html: string
+    readonly preheader?: string
+}
+
+interface ActionBase {
+    readonly id: string
+    readonly name: string
+}
+
+export type Action =
+    | (ActionBase & { readonly type: 'trigger'; readonly config: TriggerConfig })
+    | (ActionBase & { readonly type: 'delay'; readonly config: { readonly delay_duration: Duration } })
+    | (ActionBase & {
+          readonly type: 'function'
+          readonly config: {
+              readonly template_id: string
+              readonly inputs: Readonly<Record<string, { readonly value: unknown }>>
+          }
+      })
+    | (ActionBase & {
+          readonly type: 'function_email'
+          readonly config: {
+              readonly template_id: 'template-email'
+              readonly inputs: { readonly email: { readonly value: EmailMessage } }
+          }
+      })
+    | (ActionBase & {
+          readonly type: 'conditional_branch'
+          readonly config: {
+              readonly conditions: readonly {
+                  readonly name: string
+                  readonly filters: { readonly properties: readonly PropertyCondition[] }
+              }[]
+          }
+      })
+    | (ActionBase & { readonly type: 'exit'; readonly config: { readonly reason: string } })
+
+export type Edge =
+    | { readonly from: string; readonly to: string; readonly type: 'continue' }
+    | { readonly from: string; readonly to: string; readonly type: 'branch'; readonly index: number }
+
+export type WorkflowStatus = 'draft' | 'active' | 'archived'
+
+/** HogFlowVariableSerializer stores every field as a string, so a default is a string too. */
+export interface Variable {
+    readonly key: string
+    readonly type: 'string' | 'number' | 'boolean'
+    readonly default: string
+}
+
+export interface WorkflowDefinition {
+    readonly name: string
+    readonly description: string
+    readonly status: WorkflowStatus
+    readonly exit_condition: 'exit_only_at_end'
+    readonly variables: readonly Variable[]
+    readonly actions: readonly Action[]
+    readonly edges: readonly Edge[]
+}
diff --git a/products/workflows/packages/workflows/src/errors.ts b/products/workflows/packages/workflows/src/errors.ts
new file mode 100644
index 00000000000..4cfb314c466
--- /dev/null
+++ b/products/workflows/packages/workflows/src/errors.ts
@@ -0,0 +1,24 @@
+export interface WorkflowErrorFields {
+    readonly status: string
+    readonly message: string
+    readonly why: string
+    readonly fix: string
+}
+
+export class WorkflowError extends Error {
+    readonly status: string
+    readonly why: string
+    readonly fix: string
+
+    constructor(fields: WorkflowErrorFields) {
+        super(fields.message)
+        this.name = 'WorkflowError'
+        this.status = fields.status
+        this.why = fields.why
+        this.fix = fields.fix
+    }
+}
+
+export function invalid(message: string, why: string, fix: string): WorkflowError {
+    return new WorkflowError({ status: 'invalid_workflow', message, why, fix })
+}
diff --git a/products/workflows/packages/workflows/src/index.ts b/products/workflows/packages/workflows/src/index.ts
new file mode 100644
index 00000000000..cb93734dc3e
--- /dev/null
+++ b/products/workflows/packages/workflows/src/index.ts
@@ -0,0 +1,5 @@
+export type * from './definition.ts'
+export { WorkflowError, type WorkflowErrorFields } from './errors.ts'
+export { path, secret, step, trigger } from './steps.ts'
+export type * from './steps.ts'
+export { workflow, type Workflow, type WorkflowOptions } from './workflow.ts'
diff --git a/products/workflows/packages/workflows/src/steps.ts b/products/workflows/packages/workflows/src/steps.ts
new file mode 100644
index 00000000000..fdb60b013d9
--- /dev/null
+++ b/products/workflows/packages/workflows/src/steps.ts
@@ -0,0 +1,84 @@
+// A step is a value with no id and no position. The same value can sit at two
+// places in one workflow, and emit gives each placement its own action.
+
+import type { Duration, EmailMessage, PropertyCondition, SecretRef, TriggerConfig } from './definition.ts'
+
+interface Named {
+    /** The action id is the slug of this name, unless `id` is set. */
+    readonly name: string
+    /** Keeps the action id stable when the step is renamed. */
+    readonly id?: string
+}
+
+/** At least one condition. An empty `when` does not compile. */
+export type Conditions = readonly [PropertyCondition, ...PropertyCondition[]]
+
+/** At least one step. An empty sub-path does not compile. */
+export type Path = readonly [Step, ...Step[]]
+
+export interface Branch {
+    readonly name: string
+    readonly when: Conditions
+    readonly then: Path
+}
+
+export type DelayOptions = Named & { readonly duration: Duration }
+
+export type FunctionOptions = Named & {
+    readonly template_id: string
+    readonly inputs: Readonly<Record<string, unknown>>
+}
+
+// Content is inline only. A `template_uuid` makes the server copy a library
+// template into the step on save, so the stored step would differ from the
+// emitted one.
+export type EmailOptions = Named & Omit<EmailMessage, 'from'> & { readonly from?: EmailMessage['from'] }
+
+export type BranchOptions = Named & { readonly branches: readonly [Branch, ...Branch[]] }
+
+export type Step =
+    | (DelayOptions & { readonly kind: 'delay' })
+    | (FunctionOptions & { readonly kind: 'function' })
+    | (EmailOptions & { readonly kind: 'email' })
+    | (BranchOptions & { readonly kind: 'branch' })
+
+export const step = {
+    delay: (options: DelayOptions): Step => Object.freeze({ ...options, kind: 'delay' as const }),
+    /** Runs any function template. The server validates `inputs` against the template on push. */
+    function: (options: FunctionOptions): Step => Object.freeze({ ...options, kind: 'function' as const }),
+    email: (options: EmailOptions): Step => Object.freeze({ ...options, kind: 'email' as const }),
+    branch: (options: BranchOptions): Step => Object.freeze({ ...options, kind: 'branch' as const }),
+}
+
+export function path(...steps: Path): Path {
+    return steps
+}
+
+export const trigger = {
+    event: (options: {
+        readonly event: string
+        readonly properties?: readonly PropertyCondition[]
+    }): TriggerConfig => ({
+        type: 'event',
+        filters: {
+            events: [
+                {
+                    id: options.event,
+                    name: options.event,
+                    type: 'events',
+                    order: 0,
+                    properties: options.properties ?? [],
+                },
+            ],
+            properties: [],
+            filter_test_accounts: false,
+        },
+    }),
+    /** The schedule itself is attached to the workflow separately and is not part of the definition. */
+    schedule: (): TriggerConfig => ({ type: 'schedule' }),
+}
+
+/** Names an environment variable for a function input. The source holds the name, never the value. */
+export function secret(envName: string): SecretRef {
+    return Object.freeze({ __posthog_secret: envName })
+}
diff --git a/products/workflows/packages/workflows/src/workflow.ts b/products/workflows/packages/workflows/src/workflow.ts
new file mode 100644
index 00000000000..89b2ac94652
--- /dev/null
+++ b/products/workflows/packages/workflows/src/workflow.ts
@@ -0,0 +1,202 @@
+import type { Action, Edge, TriggerConfig, Variable, WorkflowDefinition, WorkflowStatus } from './definition.ts'
+import { invalid } from './errors.ts'
+import type { Path, Step } from './steps.ts'
+
+export interface WorkflowOptions {
+    /** Identifies this workflow across pushes. Keep it when you rename the workflow. */
+    readonly key: string
+    readonly name: string
+    readonly description?: string
+    /** Defaults to `draft`. */
+    readonly status?: WorkflowStatus
+    readonly variables?: readonly Variable[]
+    readonly trigger: TriggerConfig
+    readonly steps: Path
+    readonly exit: { readonly reason: string }
+}
+
+export interface Workflow {
+    readonly key: string
+    /** Builds the definition, or throws a `WorkflowError` that names the step at fault. */
+    emit(): WorkflowDefinition
+}
+
+export function workflow(options: WorkflowOptions): Workflow {
+    return Object.freeze({ key: options.key, emit: () => emit(options) })
+}
+
+// The grammar of products/workflows/backend/utils/durations.py, which the Node worker also reads.
+const DURATION = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)[dhms]$/
+
+// HOG_FLOW_VARIABLES_MAX_BYTES in products/workflows/backend/api/hog_flow.py.
+const VARIABLES_MAX_BYTES = 5120
+
+const TRIGGER = { id: 'trigger_node', name: 'Trigger' }
+const EXIT = { id: 'exit_node', name: 'Exit' }
+
+function slug(name: string): string {
+    return name
+        .toLowerCase()
+        .replace(/[^a-z0-9]+/g, '_')
+        .replace(/^_+|_+$/g, '')
+}
+
+// HogFlowVariableSerializer measures each variable with Python's json.dumps, which puts a
+// space after ":" and "," and escapes every character outside printable ASCII as \uXXXX.
+// Measuring the same way refuses exactly the variables the server refuses.
+function serializedLength(variable: Variable): number {
+    const fields = Object.entries(variable).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
+    return `{${fields.join(', ')}}`.replace(/[^\x20-\x7e]/g, '\\u0000').length
+}
+
+function checkVariables(variables: readonly Variable[]): Variable[] {
+    const normalized = variables.map(({ key, type, default: value }) => ({ key, type, default: value }))
+    const seen = new Set<string>()
+    for (const { key } of normalized) {
+        if (seen.has(key)) {
+            throw invalid(
+                `Two variables use the key "${key}".`,
+                'A step reads a variable by its key, so each key can name only one variable.',
+                `Rename or remove one of the variables named "${key}".`
+            )
+        }
+        seen.add(key)
+    }
+    const total = normalized.reduce((sum, variable) => sum + serializedLength(variable), 0)
+    if (total > VARIABLES_MAX_BYTES) {
+        throw invalid(
+            `The variables take ${total} bytes, and the limit is ${VARIABLES_MAX_BYTES}.`,
+            'PostHog refuses a workflow whose variable keys and default values are larger than the limit.',
+            'Shorten the default values, or remove variables the workflow does not use.'
+        )
+    }
+    return normalized
+}
+
+class Compiler {
+    readonly actions: Action[] = []
+    readonly edges: Edge[] = []
+    private readonly owners = new Map<string, { readonly name: string }>([
+        [TRIGGER.id, TRIGGER],
+        [EXIT.id, EXIT],
+    ])
+    private readonly placements = new Map<Step, number>()
+
+    /** Emits the steps in order and returns the id of the first one. */
+    path(steps: Path, owner: string, continuation: string): string {
+        if (steps.length === 0) {
+            throw invalid(
+                `${owner} has no steps.`,
+                'A path with no steps has nothing to run, so the edge into it would have no target.',
+                'Add at least one step to the path.'
+            )
+        }
+        const ids = steps.map((step) => this.id(step))
+        steps.forEach((step, position) => this.step(step, ids[position]!, ids[position + 1] ?? continuation))
+        return ids[0]!
+    }
+
+    // A second placement of the same step value gets a suffix. Two different steps
+    // that land on one id are refused instead, because a suffix would go to
+    // whichever step comes second, and moving one step would swap the two ids.
+    private id(step: Step): string {
+        const base = step.id ?? slug(step.name)
+        if (base === '') {
+            throw invalid(
+                `The step "${step.name}" has a name with no letters or digits.`,
+                'The action id is made from the letters and digits of the step name.',
+                'Add a letter or digit to the name, or set an id on the step.'
+            )
+        }
+        const placement = (this.placements.get(step) ?? 0) + 1
+        this.placements.set(step, placement)
+        const id = placement === 1 ? base : `${base}_${placement}`
+        const owner = this.owners.get(id)
+        if (owner !== undefined && owner !== step) {
+            throw invalid(
+                `The steps "${owner.name}" and "${step.name}" both get the action id "${id}".`,
+                'Each action id must be unique in a workflow. The id is the slug of the step name, unless the step sets id.',
+                `Rename one of the two steps, or set a different id on one of them.`
+            )
+        }
+        this.owners.set(id, step)
+        return id
+    }
+
+    private step(step: Step, id: string, next: string): void {
+        const { name } = step
+        if (step.kind === 'delay') {
+            if (!DURATION.test(step.duration)) {
+                throw invalid(
+                    `The step "${name}" waits for "${step.duration}", which is not a duration.`,
+                    'PostHog reads a delay as a number followed by one unit: d, h, m or s.',
+                    'Write the delay like "30m", "2h" or "1.5d".'
+                )
+            }
+            this.actions.push({ id, name, type: 'delay', config: { delay_duration: step.duration } })
+        } else if (step.kind === 'function') {
+            const inputs = Object.fromEntries(Object.entries(step.inputs).map(([key, value]) => [key, { value }]))
+            this.actions.push({ id, name, type: 'function', config: { template_id: step.template_id, inputs } })
+        } else if (step.kind === 'email') {
+            if ('template_uuid' in step) {
+                throw invalid(
+                    `The email step "${name}" sets template_uuid.`,
+                    'PostHog copies a library template into the step when it saves, so the saved step would not match this file.',
+                    'Remove template_uuid and write the subject, text and html in the step.'
+                )
+            }
+            const value = {
+                from: step.from ?? {},
+                to: { email: step.to.email },
+                subject: step.subject,
+                text: step.text,
+                html: step.html,
+                ...(step.preheader === undefined ? {} : { preheader: step.preheader }),
+            }
+            this.actions.push({
+                id,
+                name,
+                type: 'function_email',
+                config: { template_id: 'template-email', inputs: { email: { value } } },
+            })
+        } else {
+            const conditions = step.branches.map((branch) => ({
+                name: branch.name,
+                filters: { properties: [...branch.when] },
+            }))
+            this.actions.push({ id, name, type: 'conditional_branch', config: { conditions } })
+            step.branches.forEach((branch, index) => {
+                const entry = this.path(branch.then, `The branch "${branch.name}" in "${name}"`, next)
+                this.edges.push({ from: id, to: entry, type: 'branch', index })
+            })
+        }
+        // For a branch this is the path taken when no condition matches.
+        this.edges.push({ from: id, to: next, type: 'continue' })
+    }
+}
+
+function emit(options: WorkflowOptions): WorkflowDefinition {
+    if (options.key.trim() === '') {
+        throw invalid(
+            `The workflow "${options.name}" has an empty key.`,
+            'The key is how a push finds the workflow it created before.',
+            'Set key to a short name that stays the same when the workflow is renamed, like "onboarding".'
+        )
+    }
+    const variables = checkVariables(options.variables ?? [])
+    const compiler = new Compiler()
+    const entry = compiler.path(options.steps, `The workflow "${options.name}"`, EXIT.id)
+    return {
+        name: options.name,
+        description: options.description ?? '',
+        status: options.status ?? 'draft',
+        exit_condition: 'exit_only_at_end',
+        variables,
+        actions: [
+            { ...TRIGGER, type: 'trigger', config: options.trigger },
+            ...compiler.actions,
+            { ...EXIT, type: 'exit', config: { reason: options.exit.reason } },
+        ],
+        edges: [{ from: TRIGGER.id, to: entry, type: 'continue' }, ...compiler.edges],
+    }
+}
diff --git a/products/workflows/packages/workflows/test/emit.ts b/products/workflows/packages/workflows/test/emit.ts
new file mode 100644
index 00000000000..d2bd1105cf9
--- /dev/null
+++ b/products/workflows/packages/workflows/test/emit.ts
@@ -0,0 +1,194 @@
+import assert from 'node:assert/strict'
+import { describe, test } from 'node:test'
+
+import { path, secret, step, trigger, workflow, WorkflowError, type Step, type WorkflowOptions } from '../src/index.ts'
+
+const notifyCrm = step.function({
+    name: 'Tell the CRM',
+    template_id: 'template-webhook',
+    inputs: { url: 'https://example.com/hooks/onboarding', method: 'POST', signing_secret: secret('CRM_TOKEN') },
+})
+
+const onboarding: WorkflowOptions = {
+    key: 'onboarding',
+    name: 'Onboarding',
+    variables: [{ key: 'plan', type: 'string', default: 'free' }],
+    trigger: trigger.event({ event: 'user signed up' }),
+    steps: path(
+        step.delay({ name: 'Wait a day', duration: '1d' }),
+        step.branch({
+            name: 'Which plan?',
+            branches: [
+                {
+                    name: 'Paid plan',
+                    when: [{ key: 'plan', type: 'person', operator: 'exact', value: ['paid'] }],
+                    then: path(
+                        step.email({
+                            name: 'Welcome',
+                            to: { email: '{{ person.properties.email }}' },
+                            subject: 'Welcome',
+                            text: 'Hello',
+                            html: '<p>Hello</p>',
+                        }),
+                        notifyCrm
+                    ),
+                },
+            ],
+        }),
+        notifyCrm
+    ),
+    exit: { reason: 'Onboarding finished' },
+}
+
+function refusal(options: WorkflowOptions): WorkflowError {
+    try {
+        workflow(options).emit()
+    } catch (error) {
+        assert.ok(error instanceof WorkflowError)
+        return error
+    }
+    assert.fail('emit accepted the workflow')
+}
+
+const delay = (name: string): Step => step.delay({ name, duration: '1d' })
+const variable = (key: string, value: string) => ({ key, type: 'string' as const, default: value })
+
+describe('emit', () => {
+    test('emits the definition and a JSON round trip leaves it identical', () => {
+        const definition = workflow(onboarding).emit()
+
+        assert.deepStrictEqual(definition, {
+            name: 'Onboarding',
+            description: '',
+            status: 'draft',
+            exit_condition: 'exit_only_at_end',
+            variables: [{ key: 'plan', type: 'string', default: 'free' }],
+            actions: [
+                {
+                    id: 'trigger_node',
+                    name: 'Trigger',
+                    type: 'trigger',
+                    config: {
+                        type: 'event',
+                        filters: {
+                            events: [
+                                {
+                                    id: 'user signed up',
+                                    name: 'user signed up',
+                                    type: 'events',
+                                    order: 0,
+                                    properties: [],
+                                },
+                            ],
+                            properties: [],
+                            filter_test_accounts: false,
+                        },
+                    },
+                },
+                { id: 'wait_a_day', name: 'Wait a day', type: 'delay', config: { delay_duration: '1d' } },
+                {
+                    id: 'which_plan',
+                    name: 'Which plan?',
+                    type: 'conditional_branch',
+                    config: {
+                        conditions: [
+                            {
+                                name: 'Paid plan',
+                                filters: {
+                                    properties: [{ key: 'plan', type: 'person', operator: 'exact', value: ['paid'] }],
+                                },
+                            },
+                        ],
+                    },
+                },
+                {
+                    id: 'welcome',
+                    name: 'Welcome',
+                    type: 'function_email',
+                    config: {
+                        template_id: 'template-email',
+                        inputs: {
+                            email: {
+                                value: {
+                                    from: {},
+                                    to: { email: '{{ person.properties.email }}' },
+                                    subject: 'Welcome',
+                                    text: 'Hello',
+                                    html: '<p>Hello</p>',
+                                },
+                            },
+                        },
+                    },
+                },
+                ...['tell_the_crm_2', 'tell_the_crm'].map((id) => ({
+                    id,
+                    name: 'Tell the CRM',
+                    type: 'function',
+                    config: {
+                        template_id: 'template-webhook',
+                        inputs: {
+                            url: { value: 'https://example.com/hooks/onboarding' },
+                            method: { value: 'POST' },
+                            signing_secret: { value: { __posthog_secret: 'CRM_TOKEN' } },
+                        },
+                    },
+                })),
+                { id: 'exit_node', name: 'Exit', type: 'exit', config: { reason: 'Onboarding finished' } },
+            ],
+            edges: [
+                { from: 'trigger_node', to: 'wait_a_day', type: 'continue' },
+                { from: 'wait_a_day', to: 'which_plan', type: 'continue' },
+                { from: 'welcome', to: 'tell_the_crm_2', type: 'continue' },
+                { from: 'tell_the_crm_2', to: 'tell_the_crm', type: 'continue' },
+                { from: 'which_plan', to: 'welcome', type: 'branch', index: 0 },
+                { from: 'which_plan', to: 'tell_the_crm', type: 'continue' },
+                { from: 'tell_the_crm', to: 'exit_node', type: 'continue' },
+            ],
+        })
+        assert.deepStrictEqual(JSON.parse(JSON.stringify(definition)), definition)
+    })
+
+    const refusals: [string, WorkflowOptions, RegExp][] = [
+        [
+            'two steps whose slugs collide',
+            { ...onboarding, steps: path(delay('Wait a day'), delay('Wait, a day!')) },
+            /"Wait a day" and "Wait, a day!" both get the action id "wait_a_day"/,
+        ],
+        [
+            'duplicate variable keys',
+            { ...onboarding, variables: [variable('plan', 'free'), variable('plan', 'paid')] },
+            /Two variables use the key "plan"/,
+        ],
+        [
+            'variables over the size cap',
+            // 45 bytes of JSON around the default, plus 846 characters that Python escapes to 6 bytes each.
+            { ...onboarding, variables: [variable('k', 'é'.repeat(846))] },
+            /The variables take 5121 bytes, and the limit is 5120/,
+        ],
+        [
+            'a delay that is not a duration, from source that skipped the type check',
+            { ...onboarding, steps: path(step.delay({ name: 'Wait', duration: 'soon' as unknown as '1d' })) },
+            /"Wait" waits for "soon", which is not a duration/,
+        ],
+    ]
+
+    for (const [description, options, message] of refusals) {
+        test(`refuses ${description} with status, message, why and fix`, () => {
+            const error = refusal(options)
+            assert.equal(error.status, 'invalid_workflow')
+            assert.match(error.message, message)
+            assert.ok(error.why.length > 0 && error.fix.length > 0)
+        })
+    }
+
+    test('accepts variables at exactly the size cap', () => {
+        const definition = workflow({ ...onboarding, variables: [variable('k', 'a'.repeat(5075))] }).emit()
+        assert.equal(definition.variables.length, 1)
+    })
+
+    test('lets a renamed step keep its action id', () => {
+        const renamed = step.delay({ name: 'Wait one day', id: 'wait_a_day', duration: '1d' })
+        const definition = workflow({ ...onboarding, steps: path(renamed) }).emit()
+        assert.equal(definition.actions[1]?.id, 'wait_a_day')
+    })
+})
diff --git a/products/workflows/packages/workflows/test/type-rules.ts b/products/workflows/packages/workflows/test/type-rules.ts
new file mode 100644
index 00000000000..0a5fe0f9f56
--- /dev/null
+++ b/products/workflows/packages/workflows/test/type-rules.ts
@@ -0,0 +1,36 @@
+// Checked by `tsc --noEmit` and never run. Each `@ts-expect-error` fails the
+// type check if the line under it starts to compile.
+
+import { path, step, workflow, type Path } from '../src/index.ts'
+
+const paidPlan = [{ key: 'plan', type: 'person', operator: 'exact', value: ['paid'] }] as const
+
+// @ts-expect-error An empty sub-path is a compile error.
+export const emptyPath: Path = []
+
+export const emptyBranch = step.branch({
+    name: 'Which plan?',
+    // @ts-expect-error An empty branch path is a compile error.
+    branches: [{ name: 'Paid plan', when: paidPlan, then: [] }],
+})
+
+// @ts-expect-error A duration refuses a value that is not a duration, also inside a const.
+export const wait = step.delay({ name: 'Wait a bit', duration: 'soon' })
+
+export const templated = step.email({
+    name: 'Welcome',
+    to: { email: '{{ person.properties.email }}' },
+    subject: 'Welcome',
+    text: 'Hello',
+    html: '<p>Hello</p>',
+    // @ts-expect-error The email step takes inline content only.
+    template_uuid: '00000000-0000-0000-0000-000000000000',
+})
+
+// @ts-expect-error A workflow needs a key.
+export const noKey = workflow({
+    name: 'No key',
+    trigger: { type: 'schedule' },
+    steps: path(step.delay({ name: 'Wait a day', duration: '1d' })),
+    exit: { reason: 'Done' },
+})
diff --git a/products/workflows/packages/workflows/tsconfig.build.json b/products/workflows/packages/workflows/tsconfig.build.json
new file mode 100644
index 00000000000..d7a1106ca14
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.build.json
@@ -0,0 +1,7 @@
+{
+    "extends": "./tsconfig.json",
+    "compilerOptions": {
+        "rootDir": "src"
+    },
+    "include": ["src"]
+}
diff --git a/products/workflows/packages/workflows/tsconfig.json b/products/workflows/packages/workflows/tsconfig.json
new file mode 100644
index 00000000000..2ba7c14dd4b
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.json
@@ -0,0 +1,18 @@
+{
+    "compilerOptions": {
+        "target": "es2022",
+        "module": "nodenext",
+        "moduleResolution": "nodenext",
+        "rootDir": ".",
+        "outDir": "dist",
+        "strict": true,
+        "noUncheckedIndexedAccess": true,
+        "declaration": true,
+        "rewriteRelativeImportExtensions": true,
+        "erasableSyntaxOnly": true,
+        "verbatimModuleSyntax": true,
+        "skipLibCheck": true,
+        "types": ["node"]
+    },
+    "include": ["src", "test"]
+}

```

## Diff Y

Files:
- pnpm-workspace.yaml (modified, +2 -0)
- products/workflows/packages/workflows/.gitignore (added, +1 -0)
- products/workflows/packages/workflows/README.md (added, +64 -0)
- products/workflows/packages/workflows/package.json (added, +40 -0)
- products/workflows/packages/workflows/src/definition.ts (added, +109 -0)
- products/workflows/packages/workflows/src/errors.ts (added, +29 -0)
- products/workflows/packages/workflows/src/index.ts (added, +26 -0)
- products/workflows/packages/workflows/src/steps.ts (added, +104 -0)
- products/workflows/packages/workflows/src/workflow.ts (added, +229 -0)
- products/workflows/packages/workflows/test/type-rules.ts (added, +45 -0)
- products/workflows/packages/workflows/test/workflow.test.ts (added, +222 -0)
- products/workflows/packages/workflows/tsconfig.build.json (added, +10 -0)
- products/workflows/packages/workflows/tsconfig.json (added, +15 -0)

```diff
diff --git a/pnpm-workspace.yaml b/pnpm-workspace.yaml
index 73322eb3b23..5107ef09758 100644
--- a/pnpm-workspace.yaml
+++ b/pnpm-workspace.yaml
@@ -19,6 +19,8 @@ packages:
     # products/desktop is a nested standalone workspace (own lockfile, catalog,
     # overrides, Node version); the root install must not absorb it.
     - '!products/desktop'
+    # products/* matches one level only, so a nested product package is listed by hand.
+    - products/workflows/packages/workflows
     - docs/onboarding
     - services/agent-proxy
     - services/integration-service
diff --git a/products/workflows/packages/workflows/.gitignore b/products/workflows/packages/workflows/.gitignore
new file mode 100644
index 00000000000..849ddff3b7e
--- /dev/null
+++ b/products/workflows/packages/workflows/.gitignore
@@ -0,0 +1 @@
+dist/
diff --git a/products/workflows/packages/workflows/README.md b/products/workflows/packages/workflows/README.md
new file mode 100644
index 00000000000..65709165763
--- /dev/null
+++ b/products/workflows/packages/workflows/README.md
@@ -0,0 +1,64 @@
+# @posthog/workflows
+
+Define a PostHog workflow in TypeScript. The package turns the file into the workflow definition that the PostHog API accepts.
+
+## A workflow file
+
+```ts
+import { path, secret, step, trigger, workflow } from '@posthog/workflows'
+
+const notifyCrm = step.function({
+  name: 'Tell the CRM',
+  template_id: 'template-webhook',
+  inputs: { url: 'https://example.com/hooks/onboarding', signing_secret: secret('CRM_SIGNING_SECRET') },
+})
+
+export const onboarding = workflow({
+  key: 'replace-me-onboarding',
+  name: 'Onboarding nudge',
+  trigger: trigger.event({ event: 'user signed up' }),
+  steps: path(
+    step.delay({ name: 'Wait a day', duration: '1d' }),
+    step.branch({
+      name: 'Which plan?',
+      branches: [
+        {
+          name: 'Paid plan',
+          when: [{ key: 'plan', operator: 'exact', value: ['pro'], type: 'person' }],
+          steps: path(
+            step.email({
+              name: 'Welcome email',
+              to: '{person.properties.email}',
+              subject: 'Welcome aboard',
+              text: 'Thanks for upgrading.',
+              html: '<p>Thanks for upgrading.</p>',
+            }),
+            notifyCrm
+          ),
+        },
+      ],
+    })
+  ),
+  exit: { reason: 'Onboarding finished' },
+})
+```
+
+`onboarding.emit()` returns the definition, or throws a `WorkflowError` that carries `status`, `message`, `why` and `fix`.
+
+## Rules
+
+- `key` identifies the workflow in PostHog. Pick one per workflow and keep it.
+- `status` is `draft` unless you set it.
+- Each step's id comes from its name: `Wait a day` becomes `wait_a_day`. Set `id` on a step to keep its id when you rename it.
+- Two steps can't share an id. To place one step twice, give the second placement its own id: `{ ...notifyCrm, id: 'tell_the_crm_again' }`.
+- `secret('NAME')` names an environment variable. The definition carries the name, and the value is read when the workflow is pushed.
+- `variables` is a list of `{ key, type, default }` with unique keys, up to 5120 bytes in total.
+
+The triggers are `trigger.event()` and `trigger.schedule()`. The steps are `step.delay()`, `step.branch()`, `step.email()` and `step.function()`, which runs any function template by its `template_id`.
+
+## Develop
+
+```bash
+pnpm --filter=@posthog/workflows build
+pnpm --filter=@posthog/workflows test
+```
diff --git a/products/workflows/packages/workflows/package.json b/products/workflows/packages/workflows/package.json
new file mode 100644
index 00000000000..df585458ba0
--- /dev/null
+++ b/products/workflows/packages/workflows/package.json
@@ -0,0 +1,40 @@
+{
+    "name": "@posthog/workflows",
+    "version": "0.0.0",
+    "private": true,
+    "description": "Define PostHog workflows in TypeScript and emit the workflow definition the PostHog API accepts.",
+    "license": "MIT",
+    "repository": {
+        "type": "git",
+        "url": "https://github.com/PostHog/posthog.git",
+        "directory": "products/workflows/packages/workflows"
+    },
+    "bin": {
+        "posthog-workflows": "./dist/cli/index.js"
+    },
+    "files": [
+        "dist"
+    ],
+    "type": "module",
+    "main": "./dist/index.js",
+    "module": "./dist/index.js",
+    "types": "./dist/index.d.ts",
+    "exports": {
+        ".": {
+            "types": "./dist/index.d.ts",
+            "import": "./dist/index.js",
+            "require": "./dist/index.js",
+            "default": "./dist/index.js"
+        },
+        "./package.json": "./package.json"
+    },
+    "scripts": {
+        "build": "tsc -p tsconfig.build.json",
+        "test": "tsc --noEmit && vitest run",
+        "typecheck": "tsc --noEmit"
+    },
+    "devDependencies": {
+        "typescript": "catalog:",
+        "vitest": "^4.1.0"
+    }
+}
diff --git a/products/workflows/packages/workflows/src/definition.ts b/products/workflows/packages/workflows/src/definition.ts
new file mode 100644
index 00000000000..1a7385be088
--- /dev/null
+++ b/products/workflows/packages/workflows/src/definition.ts
@@ -0,0 +1,109 @@
+// The workflow definition: the body POST and PATCH on /api/projects/{id}/hog_flows/ accept,
+// as HogFlowSerializer in products/workflows/backend/api/hog_flow.py reads it.
+
+/** The grammar products/workflows/backend/utils/durations.py accepts, such as '30m' or '1.5d'. */
+export type Duration = `${number}${'d' | 'h' | 'm' | 's'}`
+
+export type WorkflowStatus = 'draft' | 'active' | 'archived'
+
+export type PropertyOperator =
+    | 'exact'
+    | 'is_not'
+    | 'icontains'
+    | 'not_icontains'
+    | 'is_set'
+    | 'is_not_set'
+    | 'gt'
+    | 'lt'
+
+export interface PropertyCondition {
+    readonly key: string
+    readonly operator: PropertyOperator
+    readonly type: 'event' | 'person' | 'group'
+    readonly value?: readonly (string | number | boolean)[]
+}
+
+export type TriggerConfig =
+    | {
+          readonly type: 'event'
+          readonly filters: {
+              readonly events: readonly {
+                  readonly id: string
+                  readonly name: string
+                  readonly type: 'events'
+                  readonly order: number
+                  readonly properties: readonly PropertyCondition[]
+              }[]
+          }
+      }
+    | { readonly type: 'schedule' }
+
+/** A named environment variable. The name travels in the definition and the value never does. */
+export interface SecretRef {
+    readonly __posthog_secret: string
+}
+
+export interface EmailMessage {
+    readonly from: { readonly integrationId?: number; readonly email?: string; readonly name?: string }
+    readonly to: { readonly email: string; readonly name?: string }
+    readonly subject: string
+    readonly text: string
+    readonly html: string
+    readonly preheader?: string
+}
+
+interface ActionBase {
+    readonly id: string
+    readonly name: string
+}
+
+export type Action =
+    | (ActionBase & { readonly type: 'trigger'; readonly config: TriggerConfig })
+    | (ActionBase & { readonly type: 'delay'; readonly config: { readonly delay_duration: Duration } })
+    | (ActionBase & {
+          readonly type: 'conditional_branch'
+          readonly config: {
+              readonly conditions: readonly {
+                  readonly name: string
+                  readonly filters: { readonly properties: readonly PropertyCondition[] }
+              }[]
+          }
+      })
+    | (ActionBase & {
+          readonly type: 'function'
+          readonly config: {
+              readonly template_id: string
+              readonly inputs: Readonly<Record<string, { readonly value: unknown }>>
+          }
+      })
+    | (ActionBase & {
+          readonly type: 'function_email'
+          readonly config: {
+              readonly template_id: 'template-email'
+              readonly inputs: { readonly email: { readonly value: EmailMessage } }
+          }
+      })
+    | (ActionBase & { readonly type: 'exit'; readonly config: { readonly reason: string } })
+
+export type Edge =
+    | { readonly from: string; readonly to: string; readonly type: 'continue' }
+    | { readonly from: string; readonly to: string; readonly type: 'branch'; readonly index: number }
+
+/** HogFlowVariableSerializer reads every field as a string, `default` included. */
+export interface Variable {
+    readonly key: string
+    readonly type: 'string' | 'number' | 'boolean'
+    readonly default: string
+}
+
+export interface WorkflowDefinition {
+    readonly name: string
+    readonly description: string
+    readonly status: WorkflowStatus
+    // The model defaults to exit_on_conversion, which does nothing without a conversion goal,
+    // so the definition always sends the one exit condition v1 supports.
+    readonly exit_condition: 'exit_only_at_end'
+    readonly actions: readonly Action[]
+    readonly edges: readonly Edge[]
+    readonly variables: readonly Variable[]
+}
diff --git a/products/workflows/packages/workflows/src/errors.ts b/products/workflows/packages/workflows/src/errors.ts
new file mode 100644
index 00000000000..01355ee5cf3
--- /dev/null
+++ b/products/workflows/packages/workflows/src/errors.ts
@@ -0,0 +1,29 @@
+export type WorkflowErrorStatus =
+    | 'invalid_key'
+    | 'invalid_step_id'
+    | 'duplicate_step_id'
+    | 'invalid_duration'
+    | 'duplicate_variable_key'
+    | 'variables_too_large'
+
+export interface WorkflowErrorFields {
+    readonly status: WorkflowErrorStatus
+    readonly message: string
+    readonly why: string
+    /** Names an action, because the person or agent reading the error recovers from this field. */
+    readonly fix: string
+}
+
+export class WorkflowError extends Error implements WorkflowErrorFields {
+    readonly status: WorkflowErrorStatus
+    readonly why: string
+    readonly fix: string
+
+    constructor(fields: WorkflowErrorFields) {
+        super(fields.message)
+        this.name = 'WorkflowError'
+        this.status = fields.status
+        this.why = fields.why
+        this.fix = fields.fix
+    }
+}
diff --git a/products/workflows/packages/workflows/src/index.ts b/products/workflows/packages/workflows/src/index.ts
new file mode 100644
index 00000000000..f8e4f72ca40
--- /dev/null
+++ b/products/workflows/packages/workflows/src/index.ts
@@ -0,0 +1,26 @@
+export type {
+    Action,
+    Duration,
+    Edge,
+    EmailMessage,
+    PropertyCondition,
+    PropertyOperator,
+    SecretRef,
+    TriggerConfig,
+    Variable,
+    WorkflowDefinition,
+    WorkflowStatus,
+} from './definition.js'
+export { WorkflowError, type WorkflowErrorFields, type WorkflowErrorStatus } from './errors.js'
+export {
+    path,
+    secret,
+    step,
+    trigger,
+    type Branch,
+    type Conditions,
+    type EmailOptions,
+    type Path,
+    type Step,
+} from './steps.js'
+export { workflow, type Workflow, type WorkflowOptions } from './workflow.js'
diff --git a/products/workflows/packages/workflows/src/steps.ts b/products/workflows/packages/workflows/src/steps.ts
new file mode 100644
index 00000000000..5eef4f4c51c
--- /dev/null
+++ b/products/workflows/packages/workflows/src/steps.ts
@@ -0,0 +1,104 @@
+// A step is a frozen value with a name and no position, so one value can sit at several places
+// in a graph. Each placement becomes its own action; emit() in workflow.ts derives every id and
+// every edge.
+
+import type { Duration, EmailMessage, PropertyCondition, SecretRef, TriggerConfig } from './definition.js'
+
+interface StepBase {
+    readonly name: string
+    /** Replaces the id derived from `name`, so a step keeps its id through a rename. */
+    readonly id?: string
+}
+
+/** At least one condition, because a branch path with no condition can never run. */
+export type Conditions = readonly [PropertyCondition, ...PropertyCondition[]]
+
+/**
+ * A non-empty tuple. `readonly Step[]` would accept `[]`, and an empty branch path emits a branch
+ * edge that points at the same target as the no-match path.
+ */
+export type Path = readonly [Step, ...Step[]]
+
+export interface Branch {
+    readonly name: string
+    readonly when: Conditions
+    readonly steps: Path
+}
+
+export interface EmailOptions extends StepBase {
+    readonly to: string
+    readonly subject: string
+    readonly text: string
+    readonly html: string
+    readonly preheader?: string
+    readonly from?: EmailMessage['from']
+}
+
+export type Step =
+    | (StepBase & { readonly kind: 'delay'; readonly duration: Duration })
+    | (StepBase & {
+          readonly kind: 'function'
+          readonly template_id: string
+          readonly inputs: Readonly<Record<string, unknown>>
+      })
+    | (EmailOptions & { readonly kind: 'email' })
+    | (StepBase & { readonly kind: 'branch'; readonly branches: readonly [Branch, ...Branch[]] })
+
+export const step = {
+    delay(options: StepBase & { readonly duration: Duration }): Step {
+        return Object.freeze({ ...options, kind: 'delay' as const })
+    },
+
+    /** Runs any function template. The inputs are not checked here, the API checks them on push. */
+    function(
+        options: StepBase & { readonly template_id: string; readonly inputs: Readonly<Record<string, unknown>> }
+    ): Step {
+        return Object.freeze({ ...options, kind: 'function' as const })
+    },
+
+    /**
+     * Sends an email with inline content. There is no `template_uuid` option: the API copies a
+     * library template into the step on write, so the stored step would never match the file.
+     */
+    email(options: EmailOptions): Step {
+        return Object.freeze({ ...options, kind: 'email' as const })
+    },
+
+    branch(options: StepBase & { readonly branches: readonly [Branch, ...Branch[]] }): Step {
+        return Object.freeze({ ...options, kind: 'branch' as const })
+    },
+}
+
+export const trigger = {
+    event(options: { readonly event: string; readonly properties?: readonly PropertyCondition[] }): TriggerConfig {
+        return {
+            type: 'event',
+            filters: {
+                events: [
+                    {
+                        id: options.event,
+                        name: options.event,
+                        type: 'events',
+                        order: 0,
+                        properties: options.properties ?? [],
+                    },
+                ],
+            },
+        }
+    },
+
+    /** The schedule itself is attached to the workflow separately and is not part of the definition. */
+    schedule(): TriggerConfig {
+        return { type: 'schedule' }
+    },
+}
+
+/** Names a sub-path so it can be defined once and placed in several branches. */
+export function path(...steps: Path): Path {
+    return steps
+}
+
+/** Names the environment variable that holds a function input. The value is read at push. */
+export function secret(envName: string): SecretRef {
+    return Object.freeze({ __posthog_secret: envName })
+}
diff --git a/products/workflows/packages/workflows/src/workflow.ts b/products/workflows/packages/workflows/src/workflow.ts
new file mode 100644
index 00000000000..6388f54b1ea
--- /dev/null
+++ b/products/workflows/packages/workflows/src/workflow.ts
@@ -0,0 +1,229 @@
+import type { Action, Edge, TriggerConfig, Variable, WorkflowDefinition, WorkflowStatus } from './definition.js'
+import { WorkflowError } from './errors.js'
+import type { Path, Step } from './steps.js'
+
+export interface WorkflowOptions {
+    /** Identifies the workflow in PostHog, so the name can change without making a new workflow. */
+    readonly key: string
+    readonly name: string
+    readonly description?: string
+    /** Defaults to `draft`, so a first push never starts live runs. */
+    readonly status?: WorkflowStatus
+    readonly variables?: readonly Variable[]
+    readonly trigger: TriggerConfig
+    readonly steps: Path
+    readonly exit: { readonly reason: string }
+}
+
+export interface Workflow {
+    readonly key: string
+    /** Throws a WorkflowError when the definition would be refused or would fail at run time. */
+    emit(): WorkflowDefinition
+}
+
+// The frontend reads these two ids by name, so they stay fixed and a step cannot take them.
+const TRIGGER_ID = 'trigger_node'
+const EXIT_ID = 'exit_node'
+
+// Mirrors DURATION_PATTERN in products/workflows/backend/utils/durations.py. The Duration type
+// accepts any `${number}`, which includes '-1d' and '1e3d'.
+const DURATION = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)[dhms]$/
+
+// HOG_FLOW_VARIABLES_MAX_BYTES in products/workflows/backend/api/hog_flow.py.
+const VARIABLES_MAX_BYTES = 5120
+
+export function workflow(options: WorkflowOptions): Workflow {
+    return { key: options.key, emit: () => emit(options) }
+}
+
+function emit(options: WorkflowOptions): WorkflowDefinition {
+    if (options.key.trim() === '') {
+        throw new WorkflowError({
+            status: 'invalid_key',
+            message: `Workflow "${options.name}" has an empty key.`,
+            why: 'The key is how PostHog finds this workflow again on the next push.',
+            fix: `Set key to a short, stable value, for example key: 'onboarding-nudge'.`,
+        })
+    }
+    const variables = options.variables ?? []
+    checkVariables(variables)
+
+    const graph: Graph = {
+        actions: [],
+        edges: [],
+        owners: new Map([
+            [TRIGGER_ID, 'the trigger'],
+            [EXIT_ID, 'the exit'],
+        ]),
+    }
+    const entry = compilePath(options.steps, EXIT_ID, graph)
+
+    return {
+        name: options.name,
+        description: options.description ?? '',
+        status: options.status ?? 'draft',
+        exit_condition: 'exit_only_at_end',
+        actions: [
+            { id: TRIGGER_ID, name: 'Trigger', type: 'trigger', config: options.trigger },
+            ...graph.actions,
+            { id: EXIT_ID, name: 'Exit', type: 'exit', config: { reason: options.exit.reason } },
+        ],
+        edges: [{ from: TRIGGER_ID, to: entry, type: 'continue' }, ...graph.edges],
+        variables: variables.map((variable) => ({ key: variable.key, type: variable.type, default: variable.default })),
+    }
+}
+
+interface Graph {
+    readonly actions: Action[]
+    readonly edges: Edge[]
+    /** Every id taken so far, with what took it, as an error message names it. */
+    readonly owners: Map<string, string>
+}
+
+function slug(name: string): string {
+    return name
+        .toLowerCase()
+        .replace(/[^a-z0-9]+/g, '_')
+        .replace(/^_+|_+$/g, '')
+}
+
+function claimId(step: Step, graph: Graph): string {
+    const id = step.id ?? slug(step.name)
+    if (id === '') {
+        throw new WorkflowError({
+            status: 'invalid_step_id',
+            message: `Step "${step.name}" has no usable id.`,
+            why: 'A step id comes from the letters and digits in its name, and this name has none.',
+            fix: `Add an id to the step, for example id: 'send_welcome'.`,
+        })
+    }
+    const owner = graph.owners.get(id)
+    if (owner !== undefined) {
+        throw new WorkflowError({
+            status: 'duplicate_step_id',
+            message: `Step "${step.name}" and ${owner} both have the id "${id}".`,
+            why: 'A step id comes from its name, and edges point at steps by id. A step placed twice, or two names that differ only in case or punctuation, give the same id.',
+            fix: `Give one of them its own id, for example { ...step, id: '${id}_2' }.`,
+        })
+    }
+    graph.owners.set(id, `step "${step.name}"`)
+    return id
+}
+
+/** Adds a path to the graph and returns the id of its first action. */
+function compilePath(steps: readonly Step[], continuation: string, graph: Graph): string {
+    const ids = steps.map((step) => claimId(step, graph))
+
+    steps.forEach((step, position) => {
+        const id = ids[position]!
+        const next = ids[position + 1] ?? continuation
+
+        // The fall-through edge. After a branch step it is the path a person takes when no condition matches.
+        graph.edges.push({ from: id, to: next, type: 'continue' })
+
+        switch (step.kind) {
+            case 'delay':
+                if (!DURATION.test(step.duration)) {
+                    throw new WorkflowError({
+                        status: 'invalid_duration',
+                        message: `Step "${step.name}" waits for "${step.duration}", which is not a duration.`,
+                        why: 'PostHog reads a duration as a number and one of the units s, m, h or d.',
+                        fix: `Write the duration as a number and a unit, for example '30m', '1.5h' or '2d'.`,
+                    })
+                }
+                graph.actions.push({ id, name: step.name, type: 'delay', config: { delay_duration: step.duration } })
+                return
+            case 'function':
+                graph.actions.push({
+                    id,
+                    name: step.name,
+                    type: 'function',
+                    config: {
+                        template_id: step.template_id,
+                        inputs: Object.fromEntries(Object.entries(step.inputs).map(([key, value]) => [key, { value }])),
+                    },
+                })
+                return
+            case 'email':
+                graph.actions.push({
+                    id,
+                    name: step.name,
+                    type: 'function_email',
+                    config: {
+                        template_id: 'template-email',
+                        inputs: {
+                            email: {
+                                value: {
+                                    from: step.from ?? {},
+                                    to: { email: step.to },
+                                    subject: step.subject,
+                                    text: step.text,
+                                    html: step.html,
+                                    ...(step.preheader === undefined ? {} : { preheader: step.preheader }),
+                                },
+                            },
+                        },
+                    },
+                })
+                return
+            case 'branch':
+                graph.actions.push({
+                    id,
+                    name: step.name,
+                    type: 'conditional_branch',
+                    config: {
+                        conditions: step.branches.map((branch) => ({
+                            name: branch.name,
+                            filters: { properties: branch.when },
+                        })),
+                    },
+                })
+                // The index and the condition come from the same array position, so they cannot disagree.
+                step.branches.forEach((branch, index) => {
+                    graph.edges.push({ from: id, to: compilePath(branch.steps, next, graph), type: 'branch', index })
+                })
+                return
+        }
+    })
+
+    return ids[0] ?? continuation
+}
+
+function checkVariables(variables: readonly Variable[]): void {
+    const seen = new Set<string>()
+    for (const variable of variables) {
+        if (seen.has(variable.key)) {
+            throw new WorkflowError({
+                status: 'duplicate_variable_key',
+                message: `Two variables have the key "${variable.key}".`,
+                why: 'A step reads a variable by its key, so each key can belong to one variable only.',
+                fix: `Rename or remove one of the variables with the key "${variable.key}".`,
+            })
+        }
+        seen.add(variable.key)
+    }
+
+    const size = variables.reduce((total, variable) => total + pythonJsonLength(variable), 0)
+    if (size > VARIABLES_MAX_BYTES) {
+        throw new WorkflowError({
+            status: 'variables_too_large',
+            message: `The variables take ${size} bytes, and the limit is ${VARIABLES_MAX_BYTES}.`,
+            why: 'PostHog refuses a workflow whose variable keys, types and default values add up to more than the limit.',
+            fix: 'Shorten the longest default values, or move large values into the step that uses them.',
+        })
+    }
+}
+
+/**
+ * The length of Python's json.dumps(variable), which is what the API measures: ", " and ": " as
+ * separators, and every character outside printable ASCII escaped as \uXXXX.
+ */
+function pythonJsonLength(variable: Variable): number {
+    const quote = (text: string): string =>
+        JSON.stringify(text).replace(
+            /[^\x20-\x7e]/g,
+            (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
+        )
+    const fields = Object.entries({ key: variable.key, type: variable.type, default: variable.default })
+    return `{${fields.map(([name, value]) => `${quote(name)}: ${quote(value)}`).join(', ')}}`.length
+}
diff --git a/products/workflows/packages/workflows/test/type-rules.ts b/products/workflows/packages/workflows/test/type-rules.ts
new file mode 100644
index 00000000000..36fda3b1c16
--- /dev/null
+++ b/products/workflows/packages/workflows/test/type-rules.ts
@@ -0,0 +1,45 @@
+// Rules the compiler enforces. `pnpm test` runs tsc over this file first, and each expect-error
+// directive below fails that run if the line under it starts to compile.
+
+import { path, step, trigger, workflow } from '../src/index.js'
+
+const onPaidPlan = [{ key: 'plan', operator: 'exact', value: ['pro'], type: 'person' }] as const
+
+export const emptyPath = step.branch({
+    name: 'Which plan?',
+    // @ts-expect-error A branch path needs at least one step.
+    branches: [{ name: 'Paid plan', when: onPaidPlan, steps: [] }],
+})
+
+// @ts-expect-error path() needs at least one step.
+export const emptyNamedPath = path()
+
+export const noCondition = step.branch({
+    name: 'Which plan?',
+    // @ts-expect-error A branch needs at least one condition.
+    branches: [{ name: 'Paid plan', when: [], steps: path(step.delay({ name: 'Wait', duration: '1d' })) }],
+})
+
+export const notADuration = step.delay({
+    name: 'Wait a bit',
+    // @ts-expect-error 'soon' is not a duration.
+    duration: 'soon',
+})
+
+export const email = step.email({
+    name: 'Welcome email',
+    to: '{person.properties.email}',
+    subject: 'Welcome aboard',
+    text: 'Hello',
+    html: '<p>Hello</p>',
+    // @ts-expect-error The email step takes inline content only.
+    template_uuid: '00000000-0000-0000-0000-000000000000',
+})
+
+// @ts-expect-error A workflow needs a key.
+export const noKey = workflow({
+    name: 'No key',
+    trigger: trigger.schedule(),
+    steps: path(step.delay({ name: 'Wait', duration: '1d' })),
+    exit: { reason: 'done' },
+})
diff --git a/products/workflows/packages/workflows/test/workflow.test.ts b/products/workflows/packages/workflows/test/workflow.test.ts
new file mode 100644
index 00000000000..643e5d429c0
--- /dev/null
+++ b/products/workflows/packages/workflows/test/workflow.test.ts
@@ -0,0 +1,222 @@
+import { describe, expect, it } from 'vitest'
+
+import {
+    path,
+    secret,
+    step,
+    trigger,
+    workflow,
+    WorkflowError,
+    type Step,
+    type Workflow,
+    type WorkflowOptions,
+} from '../src/index.js'
+
+const notifyCrm = step.function({
+    name: 'Tell the CRM',
+    template_id: 'template-webhook',
+    inputs: { url: 'https://example.com/hooks/onboarding', signing_secret: secret('CRM_SIGNING_SECRET') },
+})
+
+const onboarding = workflow({
+    key: 'replace-me-onboarding',
+    name: 'Onboarding nudge',
+    variables: [{ key: 'plan_name', type: 'string', default: 'free' }],
+    trigger: trigger.event({ event: 'user signed up' }),
+    steps: path(
+        step.delay({ name: 'Wait a day', duration: '1d' }),
+        step.branch({
+            name: 'Which plan?',
+            branches: [
+                {
+                    name: 'Paid plan',
+                    when: [{ key: 'plan', operator: 'exact', value: ['pro'], type: 'person' }],
+                    steps: path(
+                        step.email({
+                            name: 'Welcome email',
+                            to: '{person.properties.email}',
+                            subject: 'Welcome aboard',
+                            text: 'Thanks for upgrading.',
+                            html: '<p>Thanks for upgrading.</p>',
+                        }),
+                        notifyCrm
+                    ),
+                },
+            ],
+        }),
+        { ...notifyCrm, id: 'tell_the_crm_again' }
+    ),
+    exit: { reason: 'Onboarding finished' },
+})
+
+const base: WorkflowOptions = {
+    key: 'replace-me-base',
+    name: 'Base',
+    trigger: trigger.schedule(),
+    steps: path(step.delay({ name: 'Wait', duration: '1h' })),
+    exit: { reason: 'done' },
+}
+
+const wait = (name: string, id?: string): Step => step.delay({ name, duration: '1h', ...(id ? { id } : {}) })
+
+describe('workflow', () => {
+    it('emits the definition, and the definition survives the trip through JSON unchanged', () => {
+        const definition = onboarding.emit()
+
+        expect(definition).toEqual({
+            name: 'Onboarding nudge',
+            description: '',
+            status: 'draft',
+            exit_condition: 'exit_only_at_end',
+            actions: [
+                {
+                    id: 'trigger_node',
+                    name: 'Trigger',
+                    type: 'trigger',
+                    config: {
+                        type: 'event',
+                        filters: {
+                            events: [
+                                {
+                                    id: 'user signed up',
+                                    name: 'user signed up',
+                                    type: 'events',
+                                    order: 0,
+                                    properties: [],
+                                },
+                            ],
+                        },
+                    },
+                },
+                { id: 'wait_a_day', name: 'Wait a day', type: 'delay', config: { delay_duration: '1d' } },
+                {
+                    id: 'which_plan',
+                    name: 'Which plan?',
+                    type: 'conditional_branch',
+                    config: {
+                        conditions: [
+                            {
+                                name: 'Paid plan',
+                                filters: {
+                                    properties: [{ key: 'plan', operator: 'exact', value: ['pro'], type: 'person' }],
+                                },
+                            },
+                        ],
+                    },
+                },
+                {
+                    id: 'welcome_email',
+                    name: 'Welcome email',
+                    type: 'function_email',
+                    config: {
+                        template_id: 'template-email',
+                        inputs: {
+                            email: {
+                                value: {
+                                    from: {},
+                                    to: { email: '{person.properties.email}' },
+                                    subject: 'Welcome aboard',
+                                    text: 'Thanks for upgrading.',
+                                    html: '<p>Thanks for upgrading.</p>',
+                                },
+                            },
+                        },
+                    },
+                },
+                {
+                    id: 'tell_the_crm',
+                    name: 'Tell the CRM',
+                    type: 'function',
+                    config: {
+                        template_id: 'template-webhook',
+                        inputs: {
+                            url: { value: 'https://example.com/hooks/onboarding' },
+                            signing_secret: { value: { __posthog_secret: 'CRM_SIGNING_SECRET' } },
+                        },
+                    },
+                },
+                {
+                    id: 'tell_the_crm_again',
+                    name: 'Tell the CRM',
+                    type: 'function',
+                    config: {
+                        template_id: 'template-webhook',
+                        inputs: {
+                            url: { value: 'https://example.com/hooks/onboarding' },
+                            signing_secret: { value: { __posthog_secret: 'CRM_SIGNING_SECRET' } },
+                        },
+                    },
+                },
+                { id: 'exit_node', name: 'Exit', type: 'exit', config: { reason: 'Onboarding finished' } },
+            ],
+            edges: [
+                { from: 'trigger_node', to: 'wait_a_day', type: 'continue' },
+                { from: 'wait_a_day', to: 'which_plan', type: 'continue' },
+                { from: 'which_plan', to: 'tell_the_crm_again', type: 'continue' },
+                { from: 'welcome_email', to: 'tell_the_crm', type: 'continue' },
+                { from: 'tell_the_crm', to: 'tell_the_crm_again', type: 'continue' },
+                { from: 'which_plan', to: 'welcome_email', type: 'branch', index: 0 },
+                { from: 'tell_the_crm_again', to: 'exit_node', type: 'continue' },
+            ],
+            variables: [{ key: 'plan_name', type: 'string', default: 'free' }],
+        })
+        expect(JSON.stringify(JSON.parse(JSON.stringify(definition)))).toEqual(JSON.stringify(definition))
+        expect(JSON.stringify(onboarding.emit())).toEqual(JSON.stringify(definition))
+    })
+
+    it.each<[string, Partial<WorkflowOptions>, string]>([
+        [
+            'two names with the same slug',
+            { steps: path(wait('Wait a day'), wait('wait, a day!')) },
+            'duplicate_step_id',
+        ],
+        ['one step placed twice', { steps: path(notifyCrm, notifyCrm) }, 'duplicate_step_id'],
+        ['a step that takes the exit id', { steps: path(wait('Exit node')) }, 'duplicate_step_id'],
+        ['an id override that collides', { steps: path(wait('First'), wait('Second', 'first')) }, 'duplicate_step_id'],
+        ['a name with no letters or digits', { steps: path(wait('!!!')) }, 'invalid_step_id'],
+        ['a negative duration', { steps: path(step.delay({ name: 'Back', duration: '-1d' })) }, 'invalid_duration'],
+        ['an empty key', { key: ' ' }, 'invalid_key'],
+        [
+            'two variables with one key',
+            {
+                variables: [
+                    { key: 'plan', type: 'string', default: 'free' },
+                    { key: 'plan', type: 'string', default: 'pro' },
+                ],
+            },
+            'duplicate_variable_key',
+        ],
+    ])('refuses %s with all four error fields', (_, overrides, status) => {
+        const error = captureError(() => workflow({ ...base, ...overrides }).emit())
+
+        expect(error).toBeInstanceOf(WorkflowError)
+        expect(error).toMatchObject({
+            status,
+            message: expect.stringMatching(/\S/),
+            why: expect.stringMatching(/\S/),
+            fix: expect.stringMatching(/\S/),
+        })
+    })
+
+    it('measures variables the way the API does, so 5120 bytes pass and 5121 are refused', () => {
+        // The API measures len(json.dumps(item)). Each of the 100 "é" counts six characters once
+        // escaped, which brings this variable to exactly 5120 at a padding of 4468.
+        const padded = (padding: number): Workflow =>
+            workflow({
+                ...base,
+                variables: [{ key: 'greeting', type: 'string', default: 'é'.repeat(100) + 'x'.repeat(padding) }],
+            })
+
+        expect(() => padded(4468).emit()).not.toThrow()
+        expect(captureError(() => padded(4469).emit())).toMatchObject({ status: 'variables_too_large' })
+    })
+})
+
+function captureError(run: () => unknown): unknown {
+    try {
+        run()
+    } catch (error) {
+        return error
+    }
+    throw new Error('Expected the call to throw.')
+}
diff --git a/products/workflows/packages/workflows/tsconfig.build.json b/products/workflows/packages/workflows/tsconfig.build.json
new file mode 100644
index 00000000000..f270c8477b1
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.build.json
@@ -0,0 +1,10 @@
+{
+    "extends": "./tsconfig.json",
+    "compilerOptions": {
+        "noEmit": false,
+        "declaration": true,
+        "rootDir": "src",
+        "outDir": "dist"
+    },
+    "include": ["src"]
+}
diff --git a/products/workflows/packages/workflows/tsconfig.json b/products/workflows/packages/workflows/tsconfig.json
new file mode 100644
index 00000000000..4980aba2322
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.json
@@ -0,0 +1,15 @@
+{
+    "compilerOptions": {
+        "target": "es2022",
+        "module": "nodenext",
+        "moduleResolution": "nodenext",
+        "verbatimModuleSyntax": true,
+        "strict": true,
+        "noUncheckedIndexedAccess": true,
+        "exactOptionalPropertyTypes": true,
+        "skipLibCheck": true,
+        "noEmit": true,
+        "types": []
+    },
+    "include": ["src", "test"]
+}

```

## Diff Z

Files:
- pnpm-lock.yaml (modified, +12 -0)
- pnpm-workspace.yaml (modified, +2 -0)
- products/workflows/packages/workflows/.gitignore (added, +1 -0)
- products/workflows/packages/workflows/README.md (added, +67 -0)
- products/workflows/packages/workflows/package.json (added, +44 -0)
- products/workflows/packages/workflows/src/definition.ts (added, +103 -0)
- products/workflows/packages/workflows/src/emit.test.ts (added, +147 -0)
- products/workflows/packages/workflows/src/emit.ts (added, +178 -0)
- products/workflows/packages/workflows/src/errors.ts (added, +20 -0)
- products/workflows/packages/workflows/src/index.ts (added, +28 -0)
- products/workflows/packages/workflows/src/type-rules.test-d.ts (added, +36 -0)
- products/workflows/packages/workflows/src/validate.ts (added, +65 -0)
- products/workflows/packages/workflows/src/workflow.ts (added, +93 -0)
- products/workflows/packages/workflows/tsconfig.build.json (added, +10 -0)
- products/workflows/packages/workflows/tsconfig.json (added, +16 -0)

```diff
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 688810f9bc8..aebbb3b8f93 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -5222,6 +5222,18 @@ importers:
         specifier: 'catalog:'
         version: 0.2.4(kea@4.0.0-pre.6(patch_hash=139b8d1f1304f9d9da452a9a1244c94ea679dbcb85687d8999563146879fb6f5)(react@18.3.1))
 
+  products/workflows/packages/workflows:
+    devDependencies:
+      '@types/node':
+        specifier: ^24.0.0
+        version: 24.13.3
+      typescript:
+        specifier: 6.0.3
+        version: 6.0.3
+      vitest:
+        specifier: ^4.1.0
+        version: 4.1.8(@opentelemetry/api@1.9.0)(@types/node@24.13.3)(happy-dom@20.9.0)(jsdom@20.0.3)(msw@2.14.6(@types/node@24.13.3)(typescript@6.0.3))(vite@8.1.3(@types/node@24.13.3)(esbuild@0.28.1)(jiti@2.6.1)(less@4.2.2)(sass-embedded@1.70.0)(terser@5.46.0)(tsx@4.20.5)(yaml@2.9.0))
+
   rust/common/hogvm/node: {}
 
   rust/replay-anonymizer-node:
diff --git a/pnpm-workspace.yaml b/pnpm-workspace.yaml
index 73322eb3b23..d037a33e73c 100644
--- a/pnpm-workspace.yaml
+++ b/pnpm-workspace.yaml
@@ -16,6 +16,8 @@ packages:
     - nodejs
     - nodejs/src/scripts
     - products/*
+    # products/* matches direct children only, so a package nested inside a product is listed by hand.
+    - products/workflows/packages/workflows
     # products/desktop is a nested standalone workspace (own lockfile, catalog,
     # overrides, Node version); the root install must not absorb it.
     - '!products/desktop'
diff --git a/products/workflows/packages/workflows/.gitignore b/products/workflows/packages/workflows/.gitignore
new file mode 100644
index 00000000000..849ddff3b7e
--- /dev/null
+++ b/products/workflows/packages/workflows/.gitignore
@@ -0,0 +1 @@
+dist/
diff --git a/products/workflows/packages/workflows/README.md b/products/workflows/packages/workflows/README.md
new file mode 100644
index 00000000000..cc2811d446a
--- /dev/null
+++ b/products/workflows/packages/workflows/README.md
@@ -0,0 +1,67 @@
+# @posthog/workflows
+
+Write a PostHog workflow in TypeScript and turn it into the workflow definition the PostHog API accepts.
+
+This package is private and is not published to npm.
+
+## Write a workflow
+
+```ts
+import { emit, secret, step, trigger, workflow } from '@posthog/workflows'
+
+const notifyCrm = step.function({
+    name: 'Tell the CRM',
+    template_id: 'template-webhook',
+    inputs: { url: 'https://example.com/hooks/onboarding', signing_secret: secret('CRM_TOKEN') },
+})
+
+export const onboarding = workflow({
+    key: 'onboarding',
+    name: 'Onboarding',
+    on: trigger.event({ event: 'user signed up' }),
+    steps: [
+        step.delay({ name: 'Wait a day', duration: '1d' }),
+        step.branch({
+            name: 'Which plan?',
+            branches: [
+                {
+                    name: 'Paid plan',
+                    when: [{ key: 'plan', type: 'person', operator: 'exact', value: ['pro'] }],
+                    then: [
+                        step.email({
+                            name: 'Welcome email',
+                            to: '{person.properties.email}',
+                            subject: 'Welcome',
+                            text: 'Thanks for upgrading.',
+                            html: '<p>Thanks for upgrading.</p>',
+                        }),
+                        notifyCrm,
+                    ],
+                },
+            ],
+        }),
+        notifyCrm,
+    ],
+    exit: { reason: 'Onboarding finished' },
+    variables: [{ key: 'coupon', type: 'string', default: 'WELCOME10' }],
+})
+
+const definition = emit(onboarding)
+```
+
+- **Steps:** `step.delay`, `step.function`, `step.email` and `step.branch`. Every step needs a `name`.
+- **Triggers:** `trigger.event` and `trigger.schedule`. You set the schedule itself in PostHog.
+- **Status:** a workflow is a `draft` unless you set `status` to `active` or `archived`.
+- **Secrets:** `secret('CRM_TOKEN')` reads the value from that environment variable when you call `emit`. The value is never in your source.
+
+## Step ids
+
+Each step's id comes from its name: `Wait a day` becomes `wait_a_day`. To rename a step and keep its id, set `id` to the old one.
+
+A step is a value, so you can place the same step more than once. The second placement gets the id `tell_the_crm_2`.
+
+Two different steps can't share an id. `emit` stops with an error that names both steps.
+
+## Errors
+
+`emit` throws a `WorkflowError` when a workflow can't be sent to PostHog. Each error has a `status`, a `message`, a `why` and a `fix`.
diff --git a/products/workflows/packages/workflows/package.json b/products/workflows/packages/workflows/package.json
new file mode 100644
index 00000000000..123fa0a56b2
--- /dev/null
+++ b/products/workflows/packages/workflows/package.json
@@ -0,0 +1,44 @@
+{
+    "name": "@posthog/workflows",
+    "version": "0.0.0",
+    "private": true,
+    "description": "Write PostHog workflows as TypeScript and emit the workflow definition the PostHog API accepts",
+    "license": "MIT",
+    "repository": {
+        "type": "git",
+        "url": "https://github.com/PostHog/posthog.git",
+        "directory": "products/workflows/packages/workflows"
+    },
+    "files": [
+        "dist"
+    ],
+    "type": "module",
+    "main": "./dist/index.js",
+    "module": "./dist/index.js",
+    "types": "./dist/index.d.ts",
+    "exports": {
+        ".": {
+            "types": "./dist/index.d.ts",
+            "import": "./dist/index.js",
+            "require": "./dist/index.js",
+            "default": "./dist/index.js"
+        },
+        "./package.json": "./package.json"
+    },
+    "bin": {
+        "posthog-workflows": "./dist/cli/index.js"
+    },
+    "scripts": {
+        "build": "tsc -p tsconfig.build.json",
+        "test": "tsc --noEmit && vitest run",
+        "typecheck": "tsc --noEmit"
+    },
+    "devDependencies": {
+        "@types/node": "^24.0.0",
+        "typescript": "^6.0.3",
+        "vitest": "^4.1.0"
+    },
+    "engines": {
+        "node": ">=22.12"
+    }
+}
diff --git a/products/workflows/packages/workflows/src/definition.ts b/products/workflows/packages/workflows/src/definition.ts
new file mode 100644
index 00000000000..9da54025cf2
--- /dev/null
+++ b/products/workflows/packages/workflows/src/definition.ts
@@ -0,0 +1,103 @@
+// The workflow definition: the create and update body that HogFlowSerializer accepts
+// (products/workflows/backend/api/hog_flow.py). The backend is Python, so this mirrors
+// the serializer by reading it. Keep the two in step when the serializer changes.
+
+/** The duration grammar of `backend/utils/durations.py`, as far as a template literal can hold it. */
+export type Duration = `${number}${'d' | 'h' | 'm' | 's'}`
+
+export type PropertyOperator =
+    | 'exact'
+    | 'is_not'
+    | 'icontains'
+    | 'not_icontains'
+    | 'is_set'
+    | 'is_not_set'
+    | 'gt'
+    | 'lt'
+
+/** One property condition. The server compiles its bytecode, so the definition never carries it. */
+export interface PropertyCondition {
+    readonly key: string
+    readonly type: 'event' | 'person' | 'group'
+    readonly operator: PropertyOperator
+    readonly value?: readonly (string | number | boolean)[]
+}
+
+export interface EventFilter {
+    readonly id: string
+    readonly name: string
+    readonly type: 'events'
+    readonly order: number
+    readonly properties: readonly PropertyCondition[]
+}
+
+export type TriggerConfig =
+    | { readonly type: 'event'; readonly filters: { readonly events: readonly EventFilter[] } }
+    | { readonly type: 'schedule' }
+
+export interface EmailMessage {
+    readonly from: Readonly<Record<string, never>>
+    readonly to: { readonly email: string }
+    readonly subject: string
+    readonly text: string
+    readonly html: string
+    readonly preheader?: string
+}
+
+interface ActionBase {
+    readonly id: string
+    readonly name: string
+}
+
+export type Action =
+    | (ActionBase & { readonly type: 'trigger'; readonly config: TriggerConfig })
+    | (ActionBase & { readonly type: 'delay'; readonly config: { readonly delay_duration: Duration } })
+    | (ActionBase & {
+          readonly type: 'conditional_branch'
+          readonly config: {
+              readonly conditions: readonly {
+                  readonly name: string
+                  readonly filters: { readonly properties: readonly PropertyCondition[] }
+              }[]
+          }
+      })
+    | (ActionBase & {
+          readonly type: 'function'
+          readonly config: {
+              readonly template_id: string
+              readonly inputs: Readonly<Record<string, { readonly value: unknown }>>
+          }
+      })
+    | (ActionBase & {
+          readonly type: 'function_email'
+          // The server coerces template_id to template-email whatever is sent. A template_uuid would make
+          // the server copy a library template into the stored action, so the stored definition would
+          // no longer match the one sent, and the SDK never sends one.
+          readonly config: {
+              readonly template_id: 'template-email'
+              readonly inputs: { readonly email: { readonly value: EmailMessage } }
+          }
+      })
+    | (ActionBase & { readonly type: 'exit'; readonly config: { readonly reason: string } })
+
+export type Edge =
+    | { readonly from: string; readonly to: string; readonly type: 'continue' }
+    | { readonly from: string; readonly to: string; readonly type: 'branch'; readonly index: number }
+
+/** The serializer holds every field of a variable as a string. */
+export interface Variable {
+    readonly key: string
+    readonly type: 'string' | 'number' | 'boolean'
+    readonly default: string
+}
+
+export type WorkflowStatus = 'draft' | 'active' | 'archived'
+
+export interface WorkflowDefinition {
+    readonly name: string
+    readonly description: string
+    readonly status: WorkflowStatus
+    readonly actions: readonly Action[]
+    readonly edges: readonly Edge[]
+    readonly variables: readonly Variable[]
+}
diff --git a/products/workflows/packages/workflows/src/emit.test.ts b/products/workflows/packages/workflows/src/emit.test.ts
new file mode 100644
index 00000000000..4d04bda8ed4
--- /dev/null
+++ b/products/workflows/packages/workflows/src/emit.test.ts
@@ -0,0 +1,147 @@
+import { describe, expect, it } from 'vitest'
+
+import { emit, secret, step, trigger, workflow, WorkflowError, type Path, type Step, type Variable } from './index.js'
+
+const notifyCrm = step.function({
+    name: 'Tell the CRM',
+    template_id: 'template-webhook',
+    inputs: { url: 'https://example.com/hooks/onboarding', signing_secret: secret('CRM_TOKEN') },
+})
+
+const welcome = step.email({
+    name: 'Welcome email',
+    to: '{person.properties.email}',
+    subject: 'Welcome to Example',
+    text: 'Thanks for signing up.',
+    html: '<p>Thanks for signing up.</p>',
+})
+
+function onboarding(steps: Path, variables?: readonly Variable[]) {
+    return workflow({
+        key: 'onboarding',
+        name: 'Onboarding',
+        on: trigger.event({ event: 'user signed up' }),
+        steps,
+        exit: { reason: 'Onboarding finished' },
+        ...(variables === undefined ? {} : { variables }),
+    })
+}
+
+const env = { CRM_TOKEN: 'test-token' }
+
+// 5120 bytes as Python's json.dumps measures the variable: 45 bytes around the default, and 6 bytes for
+// each "é", which Python escapes as \u00e9. Counting UTF-16 or UTF-8 instead gives a different total.
+const AT_CAP = 'é'.repeat(845) + 'aaaaa'
+
+function refusal(run: () => unknown): WorkflowError {
+    try {
+        run()
+    } catch (error) {
+        expect(error).toBeInstanceOf(WorkflowError)
+        const refused = error as WorkflowError
+        for (const field of [refused.status, refused.message, refused.why, refused.fix]) {
+            expect(field).not.toBe('')
+        }
+        return refused
+    }
+    throw new Error('expected a WorkflowError')
+}
+
+describe('emit', () => {
+    it('places a reused step twice, wires branches to the next step, and survives a JSON round trip', () => {
+        const definition = emit(
+            onboarding(
+                [
+                    step.delay({ name: 'Wait a day', duration: '1d' }),
+                    step.branch({
+                        name: 'Which plan?',
+                        branches: [
+                            {
+                                name: 'Paid',
+                                when: [{ key: 'plan', type: 'person', operator: 'exact', value: ['pro'] }],
+                                then: [welcome, notifyCrm],
+                            },
+                        ],
+                    }),
+                    notifyCrm,
+                ],
+                [{ key: 'coupon', type: 'string', default: 'WELCOME10' }]
+            ),
+            { env }
+        )
+
+        expect(definition.actions.map((action) => action.id)).toEqual([
+            'trigger_node',
+            'wait_a_day',
+            'which_plan',
+            'welcome_email',
+            'tell_the_crm_2',
+            'tell_the_crm',
+            'exit_node',
+        ])
+        expect(definition.edges).toEqual([
+            { from: 'trigger_node', to: 'wait_a_day', type: 'continue' },
+            { from: 'wait_a_day', to: 'which_plan', type: 'continue' },
+            { from: 'which_plan', to: 'tell_the_crm', type: 'continue' },
+            { from: 'welcome_email', to: 'tell_the_crm_2', type: 'continue' },
+            { from: 'tell_the_crm_2', to: 'tell_the_crm', type: 'continue' },
+            { from: 'which_plan', to: 'welcome_email', type: 'branch', index: 0 },
+            { from: 'tell_the_crm', to: 'exit_node', type: 'continue' },
+        ])
+        expect(definition.status).toBe('draft')
+        expect(definition.actions[5]).toMatchObject({
+            config: { inputs: { signing_secret: { value: 'test-token' } } },
+        })
+        expect(JSON.parse(JSON.stringify(definition))).toStrictEqual(definition)
+    })
+
+    it('keeps an id override when the step is renamed', () => {
+        const renamed = step.delay({ name: 'Wait two days', id: 'wait_a_day', duration: '2d' })
+        expect(emit(onboarding([renamed])).actions[1]!.id).toBe('wait_a_day')
+    })
+
+    it.each<[string, Path]>([
+        [
+            'two steps with the same slug',
+            [step.delay({ name: 'Wait', duration: '1d' }), step.delay({ name: 'wait!', duration: '2d' })],
+        ],
+        ['a step that slugs to a fixed id', [step.delay({ name: 'Exit node', duration: '1d' })]],
+        [
+            'a reused step whose suffix hits another slug',
+            [welcome, welcome, step.delay({ name: 'Welcome email 2', duration: '1d' })],
+        ],
+    ])('refuses %s', (_, steps) => {
+        expect(refusal(() => emit(onboarding(steps), { env })).status).toBe('slug_collision')
+    })
+
+    it.each<[string, Step, string]>([
+        ['a missing secret', notifyCrm, 'missing_secret'],
+        ['a duration the template literal lets through', step.delay({ name: 'Wait', duration: '-1d' }), 'invalid_duration'],
+        ['a name with no letters or digits', step.delay({ name: '???', duration: '1d' }), 'invalid_step_name'],
+    ])('refuses %s', (_, only, status) => {
+        expect(refusal(() => emit(onboarding([only]), { env: {} })).status).toBe(status)
+    })
+
+    it.each<[string, Variable[], string]>([
+        [
+            'duplicate variable keys',
+            [
+                { key: 'coupon', type: 'string', default: 'A' },
+                { key: 'coupon', type: 'string', default: 'B' },
+            ],
+            'duplicate_variable_key',
+        ],
+        [
+            'variables over the size cap',
+            [{ key: 'k', type: 'string', default: AT_CAP + 'a' }],
+            'variables_too_large',
+        ],
+    ])('refuses %s', (_, variables, status) => {
+        expect(refusal(() => emit(onboarding([welcome], variables))).status).toBe(status)
+    })
+
+    it('accepts variables at exactly the size cap', () => {
+        const variables: Variable[] = [{ key: 'k', type: 'string', default: AT_CAP }]
+        expect(emit(onboarding([welcome], variables)).variables).toEqual(variables)
+    })
+})
diff --git a/products/workflows/packages/workflows/src/emit.ts b/products/workflows/packages/workflows/src/emit.ts
new file mode 100644
index 00000000000..de997a2b839
--- /dev/null
+++ b/products/workflows/packages/workflows/src/emit.ts
@@ -0,0 +1,178 @@
+import type { Action, Edge, WorkflowDefinition } from './definition.js'
+import { WorkflowError } from './errors.js'
+import { validate } from './validate.js'
+import type { Path, Secret, Step, Workflow } from './workflow.js'
+
+const TRIGGER_ID = 'trigger_node'
+const EXIT_ID = 'exit_node'
+
+export interface EmitOptions {
+    /** Where `secret()` names are read. Defaults to `process.env`. */
+    readonly env?: Readonly<Record<string, string | undefined>>
+}
+
+function slugify(name: string): string {
+    return name
+        .toLowerCase()
+        .replace(/[^a-z0-9]+/g, '_')
+        .replace(/^_+|_+$/g, '')
+}
+
+function isSecret(value: unknown): value is Secret {
+    return typeof value === 'object' && value !== null && typeof (value as Secret).secret === 'string'
+}
+
+class Ids {
+    // Seeded so that a step named "Exit node" cannot take the id of the fixed exit action.
+    private readonly owners = new Map<string, Step | null>([
+        [TRIGGER_ID, null],
+        [EXIT_ID, null],
+    ])
+    private readonly placements = new Map<Step, number>()
+
+    /** A step value placed a second time gets `_2`, so reuse makes a second node with its own id. */
+    next(step: Step): string {
+        const base = step.id ?? slugify(step.name)
+        if (base === '') {
+            throw new WorkflowError({
+                status: 'invalid_step_name',
+                message: `The step name "${step.name}" has no letters or digits.`,
+                why: 'An action id is made from the letters and digits of the step name, so this step would have an empty id.',
+                fix: 'Give the step a name with at least one letter or digit, or set its id.',
+            })
+        }
+        const count = (this.placements.get(step) ?? 0) + 1
+        this.placements.set(step, count)
+        const id = count === 1 ? base : `${base}_${count}`
+
+        const owner = this.owners.get(id)
+        if (owner !== undefined && owner !== step) {
+            const other = owner === null ? `the workflow's own ${id === TRIGGER_ID ? 'trigger' : 'exit'}` : `step "${owner.name}"`
+            throw new WorkflowError({
+                status: 'slug_collision',
+                message: `Step "${step.name}" and ${other} both get the id "${id}".`,
+                why: 'Each action in a workflow needs its own id, and the id comes from the step name.',
+                fix: `Rename one of the two steps, or give one of them its own id with id: '...'.`,
+            })
+        }
+        this.owners.set(id, step)
+        return id
+    }
+}
+
+interface Context {
+    readonly ids: Ids
+    readonly actions: Action[]
+    readonly edges: Edge[]
+    readonly env: Readonly<Record<string, string | undefined>>
+}
+
+function resolveInputs(
+    step: Extract<Step, { kind: 'function' }>,
+    env: Context['env']
+): Record<string, { value: unknown }> {
+    const inputs: Record<string, { value: unknown }> = {}
+    for (const [key, raw] of Object.entries(step.inputs)) {
+        if (!isSecret(raw)) {
+            inputs[key] = { value: raw }
+            continue
+        }
+        const value = env[raw.secret]
+        if (value === undefined || value === '') {
+            throw new WorkflowError({
+                status: 'missing_secret',
+                message: `The environment variable ${raw.secret} is not set.`,
+                why: `Step "${step.name}" reads the input "${key}" from it, and the value is sent with the workflow.`,
+                fix: `Set ${raw.secret} in the environment, then run again.`,
+            })
+        }
+        inputs[key] = { value }
+    }
+    return inputs
+}
+
+function toAction(step: Step, id: string, env: Context['env']): Action {
+    switch (step.kind) {
+        case 'delay':
+            return { id, name: step.name, type: 'delay', config: { delay_duration: step.duration } }
+        case 'function':
+            return {
+                id,
+                name: step.name,
+                type: 'function',
+                config: { template_id: step.template_id, inputs: resolveInputs(step, env) },
+            }
+        case 'email':
+            return {
+                id,
+                name: step.name,
+                type: 'function_email',
+                config: {
+                    template_id: 'template-email',
+                    inputs: {
+                        email: {
+                            value: {
+                                from: {},
+                                to: { email: step.to },
+                                subject: step.subject,
+                                text: step.text,
+                                html: step.html,
+                                ...(step.preheader === undefined ? {} : { preheader: step.preheader }),
+                            },
+                        },
+                    },
+                },
+            }
+        case 'branch':
+            return {
+                id,
+                name: step.name,
+                type: 'conditional_branch',
+                config: {
+                    conditions: step.branches.map((branch) => ({
+                        name: branch.name,
+                        filters: { properties: [...branch.when] },
+                    })),
+                },
+            }
+    }
+}
+
+/** Places a path in front of `continuation` and returns the id of its first action. */
+function place(path: Path, continuation: string, context: Context): string {
+    const ids = path.map((step) => context.ids.next(step))
+    path.forEach((step, position) => {
+        const id = ids[position]!
+        const next = ids[position + 1] ?? continuation
+        context.actions.push(toAction(step, id, context.env))
+        // For a branch, this continue edge is the path taken when no condition matches.
+        context.edges.push({ from: id, to: next, type: 'continue' })
+        if (step.kind === 'branch') {
+            step.branches.forEach((branch, index) => {
+                context.edges.push({ from: id, to: place(branch.then, next, context), type: 'branch', index })
+            })
+        }
+    })
+    return ids[0]!
+}
+
+/** Turns a workflow into the definition the PostHog API accepts, and throws a `WorkflowError` if it is not valid. */
+export function emit(workflow: Workflow, options: EmitOptions = {}): WorkflowDefinition {
+    const context: Context = { ids: new Ids(), actions: [], edges: [], env: options.env ?? process.env }
+    const entry = place(workflow.steps, EXIT_ID, context)
+
+    const definition: WorkflowDefinition = {
+        name: workflow.name,
+        description: workflow.description ?? '',
+        status: workflow.status,
+        actions: [
+            { id: TRIGGER_ID, name: 'Trigger', type: 'trigger', config: workflow.on },
+            ...context.actions,
+            { id: EXIT_ID, name: 'Exit', type: 'exit', config: { reason: workflow.exit.reason } },
+        ],
+        edges: [{ from: TRIGGER_ID, to: entry, type: 'continue' }, ...context.edges],
+        variables: workflow.variables ?? [],
+    }
+    validate(definition)
+    return definition
+}
diff --git a/products/workflows/packages/workflows/src/errors.ts b/products/workflows/packages/workflows/src/errors.ts
new file mode 100644
index 00000000000..48e6642170a
--- /dev/null
+++ b/products/workflows/packages/workflows/src/errors.ts
@@ -0,0 +1,20 @@
+export interface WorkflowErrorFields {
+    readonly status: string
+    readonly message: string
+    readonly why: string
+    readonly fix: string
+}
+
+export class WorkflowError extends Error {
+    readonly status: string
+    readonly why: string
+    readonly fix: string
+
+    constructor(fields: WorkflowErrorFields) {
+        super(fields.message)
+        this.name = 'WorkflowError'
+        this.status = fields.status
+        this.why = fields.why
+        this.fix = fields.fix
+    }
+}
diff --git a/products/workflows/packages/workflows/src/index.ts b/products/workflows/packages/workflows/src/index.ts
new file mode 100644
index 00000000000..7a1c96814e7
--- /dev/null
+++ b/products/workflows/packages/workflows/src/index.ts
@@ -0,0 +1,28 @@
+export type {
+    Action,
+    Duration,
+    Edge,
+    EmailMessage,
+    PropertyCondition,
+    PropertyOperator,
+    TriggerConfig,
+    Variable,
+    WorkflowDefinition,
+    WorkflowStatus,
+} from './definition.js'
+export { emit, type EmitOptions } from './emit.js'
+export { WorkflowError, type WorkflowErrorFields } from './errors.js'
+export { validate } from './validate.js'
+export {
+    secret,
+    step,
+    trigger,
+    workflow,
+    type Branch,
+    type Conditions,
+    type Path,
+    type Secret,
+    type Step,
+    type Workflow,
+    type WorkflowOptions,
+} from './workflow.js'
diff --git a/products/workflows/packages/workflows/src/type-rules.test-d.ts b/products/workflows/packages/workflows/src/type-rules.test-d.ts
new file mode 100644
index 00000000000..7c56f460eda
--- /dev/null
+++ b/products/workflows/packages/workflows/src/type-rules.test-d.ts
@@ -0,0 +1,36 @@
+// Checked by `tsc --noEmit`, never run. Each `@ts-expect-error` fails the check if the line under it
+// compiles, so every rule here stays a compile error.
+
+import { step, trigger, workflow, type Path } from './index.js'
+
+const paid = [{ key: 'plan', type: 'person', operator: 'exact', value: ['pro'] }] as const
+
+// @ts-expect-error A sub-path cannot be empty.
+export const emptyPath: Path = []
+
+export const emptyBranch = step.branch({
+    name: 'Which plan?',
+    // @ts-expect-error A branch path cannot be empty.
+    branches: [{ name: 'Paid', when: paid, then: [] }],
+})
+
+export const noSteps = workflow({
+    key: 'k',
+    name: 'n',
+    on: trigger.schedule(),
+    // @ts-expect-error A workflow needs at least one step.
+    steps: [],
+    exit: { reason: 'Done' },
+})
+
+// @ts-expect-error A delay takes a duration, not any string, even when the step is held in a const.
+export const soon = step.delay({ name: 'Wait', duration: 'soon' })
+
+// @ts-expect-error The email step has inline content only.
+export const libraryEmail = step.email({ name: 'Hi', to: 'a', subject: 's', text: 't', html: 'h', template_uuid: 'x' })
+
+// @ts-expect-error Every step needs a name, because its id is made from the name.
+export const unnamed = step.delay({ duration: '1d' })
+
+// @ts-expect-error A workflow needs a key.
+export const noKey = workflow({ name: 'n', on: trigger.schedule(), steps: [soon], exit: { reason: 'Done' } })
diff --git a/products/workflows/packages/workflows/src/validate.ts b/products/workflows/packages/workflows/src/validate.ts
new file mode 100644
index 00000000000..6b7b4ee7b52
--- /dev/null
+++ b/products/workflows/packages/workflows/src/validate.ts
@@ -0,0 +1,65 @@
+// Checks a definition against the serializer rules that the types cannot hold. Mirrors
+// HogFlowActionSerializer, HogFlowVariableSerializer and backend/utils/durations.py.
+
+import type { Variable, WorkflowDefinition } from './definition.js'
+import { WorkflowError } from './errors.js'
+
+const DURATION = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)[dhms]$/
+const MAX_ACTION_ID_LENGTH = 200
+export const MAX_VARIABLES_BYTES = 5120
+
+/**
+ * The length of Python's `json.dumps(variable)`, which is what the serializer measures. Python puts a
+ * space after `:` and `,`, and escapes every character outside printable ASCII (0x7f too) as `\uXXXX`,
+ * where JSON.stringify does neither.
+ */
+function pythonJsonLength(variable: Variable): number {
+    const body = Object.entries(variable)
+        .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
+        .join(', ')
+    return `{${body}}`.replace(/[\u007f-￿]/g, '\\uXXXX').length
+}
+
+export function validate(definition: WorkflowDefinition): void {
+    for (const action of definition.actions) {
+        if (action.id.length > MAX_ACTION_ID_LENGTH) {
+            throw new WorkflowError({
+                status: 'invalid_action_id',
+                message: `The id of step "${action.name}" is ${action.id.length} characters long.`,
+                why: `PostHog accepts an action id of at most ${MAX_ACTION_ID_LENGTH} characters, and the id comes from the step name.`,
+                fix: 'Give the step a shorter name, or a shorter id with id: \'...\'.',
+            })
+        }
+        if (action.type === 'delay' && !DURATION.test(action.config.delay_duration)) {
+            throw new WorkflowError({
+                status: 'invalid_duration',
+                message: `Step "${action.name}" waits for "${action.config.delay_duration}", which is not a duration.`,
+                why: 'PostHog reads a duration as a positive number followed by d, h, m or s.',
+                fix: 'Write the duration as a number and a unit, for example "30m", "1.5h" or "2d".',
+            })
+        }
+    }
+
+    const keys = new Set<string>()
+    for (const variable of definition.variables) {
+        if (keys.has(variable.key)) {
+            throw new WorkflowError({
+                status: 'duplicate_variable_key',
+                message: `The variable "${variable.key}" is defined more than once.`,
+                why: 'Steps read a variable by its key, so each key can name only one variable.',
+                fix: `Remove one of the variables named "${variable.key}", or rename it.`,
+            })
+        }
+        keys.add(variable.key)
+    }
+
+    const size = definition.variables.reduce((total, variable) => total + pythonJsonLength(variable), 0)
+    if (size > MAX_VARIABLES_BYTES) {
+        throw new WorkflowError({
+            status: 'variables_too_large',
+            message: `The variables take ${size} bytes, and the limit is ${MAX_VARIABLES_BYTES}.`,
+            why: 'PostHog limits the total size of the variable keys, types and default values of one workflow.',
+            fix: 'Shorten the default values, or remove variables the workflow does not use.',
+        })
+    }
+}
diff --git a/products/workflows/packages/workflows/src/workflow.ts b/products/workflows/packages/workflows/src/workflow.ts
new file mode 100644
index 00000000000..5caad5f7ef8
--- /dev/null
+++ b/products/workflows/packages/workflows/src/workflow.ts
@@ -0,0 +1,93 @@
+// The authoring surface. A step is a frozen value with a name and no id or position, so the same
+// value can be placed at two points in one workflow. `emit()` derives every id and edge.
+
+import type { Duration, PropertyCondition, TriggerConfig, Variable, WorkflowStatus } from './definition.js'
+
+/** Names an environment variable that `emit()` reads. The source holds the name and never the value. */
+export interface Secret {
+    readonly secret: string
+}
+
+export function secret(envName: string): Secret {
+    return Object.freeze({ secret: envName })
+}
+
+/** At least one condition, so a branch with nothing to test does not compile. */
+export type Conditions = readonly [PropertyCondition, ...PropertyCondition[]]
+
+/**
+ * A non-empty tuple. `readonly Step[]` would accept `[]`, and an empty branch path emits a branch edge
+ * straight to the step after the branch, which is a valid graph that does nothing.
+ */
+export type Path = readonly [Step, ...Step[]]
+
+export interface Branch {
+    readonly name: string
+    readonly when: Conditions
+    readonly then: Path
+}
+
+interface StepBase {
+    readonly name: string
+    /** Overrides the id derived from `name`, so a step can be renamed and keep its id. */
+    readonly id?: string
+}
+
+export type Step =
+    | (StepBase & { readonly kind: 'delay'; readonly duration: Duration })
+    | (StepBase & {
+          readonly kind: 'function'
+          readonly template_id: string
+          readonly inputs: Readonly<Record<string, unknown>>
+      })
+    | (StepBase & {
+          readonly kind: 'email'
+          readonly to: string
+          readonly subject: string
+          readonly text: string
+          readonly html: string
+          readonly preheader?: string
+      })
+    | (StepBase & { readonly kind: 'branch'; readonly branches: readonly [Branch, ...Branch[]] })
+
+type Options<K extends Step['kind']> = Omit<Extract<Step, { kind: K }>, 'kind'>
+
+export const step = {
+    delay: (options: Options<'delay'>): Step => Object.freeze({ ...options, kind: 'delay' }),
+    /** Any function template by id. The server checks `inputs` against the template, the compiler does not. */
+    function: (options: Options<'function'>): Step => Object.freeze({ ...options, kind: 'function' }),
+    /** Inline content only. There is no `template_uuid`. */
+    email: (options: Options<'email'>): Step => Object.freeze({ ...options, kind: 'email' }),
+    branch: (options: Options<'branch'>): Step => Object.freeze({ ...options, kind: 'branch' }),
+}
+
+export const trigger = {
+    event: (options: { event: string; properties?: readonly PropertyCondition[] }): TriggerConfig => ({
+        type: 'event',
+        filters: {
+            events: [{ id: options.event, name: options.event, type: 'events', order: 0, properties: options.properties ?? [] }],
+        },
+    }),
+    /** The cadence lives on a separate schedule the API attaches to the workflow, not in the definition. */
+    schedule: (): TriggerConfig => ({ type: 'schedule' }),
+}
+
+export interface WorkflowOptions {
+    /** Identifies the workflow across renames. */
+    readonly key: string
+    readonly name: string
+    readonly description?: string
+    readonly status?: WorkflowStatus
+    readonly on: TriggerConfig
+    readonly steps: Path
+    readonly exit: { readonly reason: string }
+    readonly variables?: readonly Variable[]
+}
+
+export interface Workflow extends WorkflowOptions {
+    readonly status: WorkflowStatus
+}
+
+export function workflow(options: WorkflowOptions): Workflow {
+    return Object.freeze({ ...options, status: options.status ?? 'draft' })
+}
diff --git a/products/workflows/packages/workflows/tsconfig.build.json b/products/workflows/packages/workflows/tsconfig.build.json
new file mode 100644
index 00000000000..491c7243946
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.build.json
@@ -0,0 +1,10 @@
+{
+    "extends": "./tsconfig.json",
+    "compilerOptions": {
+        "noEmit": false,
+        "declaration": true,
+        "rootDir": "src",
+        "outDir": "dist"
+    },
+    "exclude": ["src/**/*.test.ts", "src/**/*.test-d.ts"]
+}
diff --git a/products/workflows/packages/workflows/tsconfig.json b/products/workflows/packages/workflows/tsconfig.json
new file mode 100644
index 00000000000..d0fdf476de8
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.json
@@ -0,0 +1,16 @@
+{
+    "compilerOptions": {
+        "target": "es2022",
+        "module": "nodenext",
+        "moduleResolution": "nodenext",
+        "verbatimModuleSyntax": true,
+        "noEmit": true,
+        "strict": true,
+        "noImplicitReturns": true,
+        "noUncheckedIndexedAccess": true,
+        "exactOptionalPropertyTypes": true,
+        "skipLibCheck": true,
+        "types": ["node"]
+    },
+    "include": ["src/**/*.ts"]
+}

```

## Diff W

Files:
- pnpm-workspace.yaml (modified, +2 -0)
- products/workflows/packages/workflows/.gitignore (added, +1 -0)
- products/workflows/packages/workflows/README.md (added, +58 -0)
- products/workflows/packages/workflows/package.json (added, +44 -0)
- products/workflows/packages/workflows/scripts/write-cjs-entry.mjs (added, +7 -0)
- products/workflows/packages/workflows/src/authoring.test-d.ts (added, +55 -0)
- products/workflows/packages/workflows/src/definition.ts (added, +115 -0)
- products/workflows/packages/workflows/src/errors.ts (added, +29 -0)
- products/workflows/packages/workflows/src/index.ts (added, +19 -0)
- products/workflows/packages/workflows/src/steps.ts (added, +142 -0)
- products/workflows/packages/workflows/src/workflow.test.ts (added, +244 -0)
- products/workflows/packages/workflows/src/workflow.ts (added, +246 -0)
- products/workflows/packages/workflows/tsconfig.build.json (added, +9 -0)
- products/workflows/packages/workflows/tsconfig.cjs.json (added, +9 -0)
- products/workflows/packages/workflows/tsconfig.json (added, +14 -0)

```diff
diff --git a/pnpm-workspace.yaml b/pnpm-workspace.yaml
index 73322eb3b23..e7d980aa846 100644
--- a/pnpm-workspace.yaml
+++ b/pnpm-workspace.yaml
@@ -16,6 +16,8 @@ packages:
     - nodejs
     - nodejs/src/scripts
     - products/*
+    # products/* matches one level only, so a package nested under a product is listed here.
+    - products/workflows/packages/workflows
     # products/desktop is a nested standalone workspace (own lockfile, catalog,
     # overrides, Node version); the root install must not absorb it.
     - '!products/desktop'
diff --git a/products/workflows/packages/workflows/.gitignore b/products/workflows/packages/workflows/.gitignore
new file mode 100644
index 00000000000..1521c8b7652
--- /dev/null
+++ b/products/workflows/packages/workflows/.gitignore
@@ -0,0 +1 @@
+dist
diff --git a/products/workflows/packages/workflows/README.md b/products/workflows/packages/workflows/README.md
new file mode 100644
index 00000000000..e638cd39527
--- /dev/null
+++ b/products/workflows/packages/workflows/README.md
@@ -0,0 +1,58 @@
+# @posthog/workflows
+
+Define a PostHog workflow in TypeScript and build the definition that PostHog stores.
+
+This package is not published yet.
+
+## A workflow
+
+```ts
+import { path, secret, step, trigger, workflow } from '@posthog/workflows'
+
+const notifyCrm = step.function({
+  name: 'Tell the CRM',
+  template_id: 'template-webhook',
+  inputs: { url: 'https://example.com/hooks/onboarding', signing_secret: secret('CRM_TOKEN') },
+})
+
+export const onboarding = workflow({
+  key: 'onboarding-nudge',
+  name: 'Onboarding nudge',
+  variables: [{ key: 'plan', type: 'string', default: 'free' }],
+  trigger: trigger.event({ event: 'user signed up' }),
+  steps: path(
+    step.delay({ name: 'Wait a day', duration: '1d' }),
+    step.branch({
+      name: 'Which plan?',
+      branches: [
+        {
+          name: 'Paid plan',
+          when: [{ key: 'plan', operator: 'exact', value: ['pro'], type: 'person' }],
+          then: [notifyCrm],
+        },
+      ],
+    })
+  ),
+  exit: { reason: 'Onboarding finished' },
+})
+```
+
+## Rules
+
+- `key` identifies the workflow. Keep it the same when you rename the workflow.
+- `status` is `draft` unless you set it.
+- Every step has a `name`. The step's id is made from the name, so `Wait a day` becomes `wait_a_day`. To rename a step and keep its id, set `id`.
+- Two different steps can't have the same id. The same step used in two places gets `_2` added to its second id.
+- A branch and a list of steps each need at least one step.
+- A delay is a number followed by `d`, `h`, `m` or `s`, for example `30m` or `1.5d`.
+- `step.email()` takes the content inline. It does not accept a library template.
+- `secret('CRM_TOKEN')` reads the value from the environment variable `CRM_TOKEN` when the definition is built. The value is never in your file.
+- Variable keys must be unique, and all variables together must fit in 5120 bytes.
+
+## Building the definition
+
+`workflow(...).emit()` returns the definition as JSON-ready data. When something is wrong it throws a `WorkflowError` with four fields: `status`, `message`, `why` and `fix`.
+
+```ts
+const definition = onboarding.emit({ env: process.env })
+```
diff --git a/products/workflows/packages/workflows/package.json b/products/workflows/packages/workflows/package.json
new file mode 100644
index 00000000000..eac184e0b10
--- /dev/null
+++ b/products/workflows/packages/workflows/package.json
@@ -0,0 +1,44 @@
+{
+    "name": "@posthog/workflows",
+    "version": "0.0.0",
+    "private": true,
+    "description": "Define PostHog workflows as code.",
+    "license": "MIT",
+    "repository": {
+        "type": "git",
+        "url": "https://github.com/PostHog/posthog.git",
+        "directory": "products/workflows/packages/workflows"
+    },
+    "bin": {
+        "posthog-workflows": "./dist/cli/index.js"
+    },
+    "files": [
+        "dist"
+    ],
+    "type": "module",
+    "main": "./dist/index.cjs",
+    "module": "./dist/index.js",
+    "types": "./dist/index.d.ts",
+    "exports": {
+        ".": {
+            "types": "./dist/index.d.ts",
+            "import": "./dist/index.js",
+            "require": "./dist/index.cjs",
+            "default": "./dist/index.js"
+        },
+        "./package.json": "./package.json"
+    },
+    "scripts": {
+        "build": "tsc -p tsconfig.build.json && tsc -p tsconfig.cjs.json && node scripts/write-cjs-entry.mjs",
+        "test": "tsc --noEmit && vitest run",
+        "typecheck": "tsc --noEmit"
+    },
+    "devDependencies": {
+        "@types/node": "catalog:",
+        "typescript": "catalog:",
+        "vitest": "^4.1.0"
+    },
+    "engines": {
+        "node": ">=20"
+    }
+}
diff --git a/products/workflows/packages/workflows/scripts/write-cjs-entry.mjs b/products/workflows/packages/workflows/scripts/write-cjs-entry.mjs
new file mode 100644
index 00000000000..deacf8a4f7c
--- /dev/null
+++ b/products/workflows/packages/workflows/scripts/write-cjs-entry.mjs
@@ -0,0 +1,7 @@
+// tsc cannot give an output file the .cjs extension, so the `require` entry in package.json
+// loads the CommonJS build from dist/cjs. The nested package.json makes Node read the .js files
+// there as CommonJS, because this package is "type": "module".
+import { writeFileSync } from 'node:fs'
+
+writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), '{ "type": "commonjs" }\n')
+writeFileSync(new URL('../dist/index.cjs', import.meta.url), "module.exports = require('./cjs/index.js')\n")
diff --git a/products/workflows/packages/workflows/src/authoring.test-d.ts b/products/workflows/packages/workflows/src/authoring.test-d.ts
new file mode 100644
index 00000000000..2bad1424d69
--- /dev/null
+++ b/products/workflows/packages/workflows/src/authoring.test-d.ts
@@ -0,0 +1,55 @@
+// `tsc --noEmit` in the test script compiles this file. Each @ts-expect-error pins a rule the
+// compiler must enforce, and tsc fails if the line below it stops being an error.
+
+import { path, step, trigger, workflow, type Duration, type Path } from './index.js'
+
+const wait = step.delay({ name: 'Wait a day', duration: '1d' })
+
+// @ts-expect-error A sub-path is a non-empty tuple.
+export const emptyPath: Path = []
+
+// @ts-expect-error path() needs at least one step.
+export const emptyPathCall = path()
+
+export const emptyBranch = step.branch({
+    name: 'Which plan?',
+    branches: [
+        {
+            name: 'Paid plan',
+            when: [{ key: 'plan', operator: 'exact', value: ['pro'], type: 'person' }],
+            // @ts-expect-error A branch path is a non-empty tuple.
+            then: [],
+        },
+    ],
+})
+
+export const noSteps = workflow({
+    key: 'nothing',
+    name: 'Nothing',
+    trigger: trigger.schedule(),
+    // @ts-expect-error A workflow has at least one step.
+    steps: [],
+    exit: { reason: 'Done' },
+})
+
+// @ts-expect-error A delay held in a const still refuses a value that is not a duration.
+export const soon = step.delay({ name: 'Wait a bit', duration: 'soon' })
+
+// @ts-expect-error The Duration type refuses a missing unit.
+export const bare: Duration = '10'
+
+export const fromLibrary = step.email({
+    name: 'Welcome',
+    to: '{person.properties.email}',
+    subject: 'Welcome',
+    text: 'Hello',
+    html: '<p>Hello</p>',
+    // @ts-expect-error Email content is inline, so a library template is refused.
+    template_uuid: '00000000-0000-0000-0000-000000000000',
+})
+
+// @ts-expect-error Every step has a name.
+export const unnamed = step.delay({ duration: '1d' })
+
+// @ts-expect-error A workflow has a key.
+export const noKey = workflow({ name: 'No key', trigger: trigger.schedule(), steps: [wait], exit: { reason: 'Done' } })
diff --git a/products/workflows/packages/workflows/src/definition.ts b/products/workflows/packages/workflows/src/definition.ts
new file mode 100644
index 00000000000..9541986420a
--- /dev/null
+++ b/products/workflows/packages/workflows/src/definition.ts
@@ -0,0 +1,115 @@
+// The workflow definition JSON that POST/PATCH /api/projects/{id}/hog_flows/ accepts.
+// The shapes follow HogFlowSerializer in products/workflows/backend/api/hog_flow.py and the
+// graph contract in products/workflows/skills/building-workflows/references/graph-schema.md.
+
+/** The server's grammar is `<number><d|h|m|s>`. The template literal type catches most typos; emit checks the rest. */
+export type Duration = `${number}${'d' | 'h' | 'm' | 's'}`
+
+export type PropertyType = 'event' | 'person' | 'group'
+
+export type PropertyOperator =
+    | 'exact'
+    | 'is_not'
+    | 'icontains'
+    | 'not_icontains'
+    | 'is_set'
+    | 'is_not_set'
+    | 'gt'
+    | 'lt'
+
+export interface PropertyCondition {
+    readonly key: string
+    readonly value?: readonly (string | number | boolean)[]
+    readonly operator: PropertyOperator
+    readonly type: PropertyType
+}
+
+export interface EventFilter {
+    readonly id: string
+    readonly name: string
+    readonly type: 'events'
+    readonly order: number
+    readonly properties: readonly PropertyCondition[]
+}
+
+export type TriggerConfig =
+    | {
+          readonly type: 'event'
+          readonly filters: {
+              readonly events: readonly EventFilter[]
+              readonly properties: readonly PropertyCondition[]
+              readonly filter_test_accounts: boolean
+          }
+      }
+    | { readonly type: 'schedule' }
+
+export interface BranchCondition {
+    readonly name: string
+    readonly filters: { readonly properties: readonly PropertyCondition[] }
+}
+
+export type FunctionInputs = Readonly<Record<string, { readonly value: unknown }>>
+
+export interface EmailMessage {
+    readonly from: { readonly integrationId?: number }
+    readonly to: { readonly email: string }
+    readonly subject: string
+    readonly text: string
+    readonly html: string
+    readonly preheader?: string
+}
+
+interface ActionBase {
+    readonly id: string
+    readonly name: string
+}
+
+export type Action =
+    | (ActionBase & { readonly type: 'trigger'; readonly config: TriggerConfig })
+    | (ActionBase & { readonly type: 'delay'; readonly config: { readonly delay_duration: Duration } })
+    | (ActionBase & {
+          readonly type: 'conditional_branch'
+          readonly config: { readonly conditions: readonly BranchCondition[] }
+      })
+    | (ActionBase & {
+          readonly type: 'function'
+          readonly config: { readonly template_id: string; readonly inputs: FunctionInputs }
+      })
+    | (ActionBase & {
+          readonly type: 'function_email'
+          readonly config: {
+              readonly template_id: 'template-email'
+              readonly inputs: { readonly email: { readonly value: EmailMessage } }
+          }
+      })
+    | (ActionBase & { readonly type: 'exit'; readonly config: { readonly reason: string } })
+
+export type Edge =
+    | { readonly from: string; readonly to: string; readonly type: 'continue' }
+    | { readonly from: string; readonly to: string; readonly type: 'branch'; readonly index: number }
+
+export type WorkflowStatus = 'draft' | 'active' | 'archived'
+
+/**
+ * HogFlowVariableSerializer validates each variable as a dict of strings, so `default` is a
+ * string whatever the `type`. A number sent there comes back as a string, and a boolean is rejected.
+ */
+export interface Variable {
+    readonly key: string
+    readonly type: 'string' | 'number' | 'boolean'
+    readonly default: string
+}
+
+/**
+ * Only fields a client may write. `trigger`, `version`, `abort_action`, `action_redirects`,
+ * `billable_action_types` and the `draft*` fields are read-only on HogFlowSerializer.
+ */
+export interface WorkflowDefinition {
+    readonly name: string
+    readonly description: string
+    readonly status: WorkflowStatus
+    readonly exit_condition: 'exit_only_at_end'
+    readonly variables: readonly Variable[]
+    readonly actions: readonly Action[]
+    readonly edges: readonly Edge[]
+}
diff --git a/products/workflows/packages/workflows/src/errors.ts b/products/workflows/packages/workflows/src/errors.ts
new file mode 100644
index 00000000000..b59394abbc1
--- /dev/null
+++ b/products/workflows/packages/workflows/src/errors.ts
@@ -0,0 +1,29 @@
+export type WorkflowErrorStatus =
+    | 'duplicate_step_id'
+    | 'empty_step_id'
+    | 'invalid_duration'
+    | 'missing_secret'
+    | 'duplicate_variable_key'
+    | 'variables_too_large'
+
+export interface WorkflowErrorFields {
+    readonly status: WorkflowErrorStatus
+    readonly message: string
+    readonly why: string
+    readonly fix: string
+}
+
+/** Every failure carries `why` and `fix`, so a person or an agent reading it knows the next action. */
+export class WorkflowError extends Error implements WorkflowErrorFields {
+    readonly status: WorkflowErrorStatus
+    readonly why: string
+    readonly fix: string
+
+    constructor(fields: WorkflowErrorFields) {
+        super(fields.message)
+        this.name = 'WorkflowError'
+        this.status = fields.status
+        this.why = fields.why
+        this.fix = fields.fix
+    }
+}
diff --git a/products/workflows/packages/workflows/src/index.ts b/products/workflows/packages/workflows/src/index.ts
new file mode 100644
index 00000000000..30bf8bd45bf
--- /dev/null
+++ b/products/workflows/packages/workflows/src/index.ts
@@ -0,0 +1,19 @@
+export type * from './definition.js'
+export { WorkflowError, type WorkflowErrorFields, type WorkflowErrorStatus } from './errors.js'
+export {
+    path,
+    secret,
+    step,
+    trigger,
+    type Branch,
+    type BranchStep,
+    type Conditions,
+    type DelayStep,
+    type EmailOptions,
+    type EmailStep,
+    type FunctionStep,
+    type Path,
+    type SecretRef,
+    type Step,
+} from './steps.js'
+export { workflow, type Environment, type Workflow, type WorkflowOptions } from './workflow.js'
diff --git a/products/workflows/packages/workflows/src/steps.ts b/products/workflows/packages/workflows/src/steps.ts
new file mode 100644
index 00000000000..60604ca4e9c
--- /dev/null
+++ b/products/workflows/packages/workflows/src/steps.ts
@@ -0,0 +1,142 @@
+// A step is a frozen value with a name and a config, and no id and no position. Placing the
+// same value twice makes two actions, and emit derives both ids from the one name.
+
+import type { Duration, EmailMessage, PropertyCondition, TriggerConfig } from './definition.js'
+
+/** Names an environment variable. emit reads the value from the environment, so the source never holds it. */
+export interface SecretRef {
+    readonly __posthog_secret: string
+}
+
+export function secret(envName: string): SecretRef {
+    return Object.freeze({ __posthog_secret: envName })
+}
+
+export function isSecretRef(value: unknown): value is SecretRef {
+    return typeof value === 'object' && value !== null && typeof (value as SecretRef).__posthog_secret === 'string'
+}
+
+interface StepBase {
+    /** The action id is the slug of this name, unless `id` is set. */
+    readonly name: string
+    /** Keeps the action id when the name changes, so PostHog keeps the step's stored secrets and run history. */
+    readonly id?: string
+}
+
+export interface DelayStep extends StepBase {
+    readonly kind: 'delay'
+    readonly duration: Duration
+}
+
+export interface FunctionStep extends StepBase {
+    readonly kind: 'function'
+    readonly template_id: string
+    readonly inputs: Readonly<Record<string, unknown>>
+}
+
+export interface EmailStep extends StepBase {
+    readonly kind: 'email'
+    readonly message: EmailMessage
+}
+
+export interface BranchStep extends StepBase {
+    readonly kind: 'branch'
+    readonly branches: readonly [Branch, ...Branch[]]
+}
+
+export type Step = DelayStep | FunctionStep | EmailStep | BranchStep
+
+/**
+ * A non-empty tuple, so an empty sub-path is a compile error. An empty branch path would emit
+ * a branch edge that points straight at the no-match target.
+ */
+export type Path = readonly [Step, ...Step[]]
+
+export type Conditions = readonly [PropertyCondition, ...PropertyCondition[]]
+
+export interface Branch {
+    readonly name: string
+    readonly when: Conditions
+    readonly then: Path
+}
+
+/** Keeps a sub-path held in a `const` a tuple. A plain array literal there widens to `Step[]`. */
+export function path(...steps: Path): Path {
+    return Object.freeze(steps) as Path
+}
+
+export interface EmailOptions extends StepBase {
+    readonly to: string
+    readonly subject: string
+    readonly text: string
+    readonly html: string
+    readonly preheader?: string
+    readonly fromIntegrationId?: number
+    /**
+     * Content is inline only. The server copies a library template's body into the step when it
+     * saves, so the stored definition would never match what the file emits.
+     */
+    readonly template_uuid?: never
+}
+
+export const step = {
+    delay(options: StepBase & { readonly duration: Duration }): DelayStep {
+        return Object.freeze({ kind: 'delay', ...options })
+    },
+
+    /** The escape hatch for any function template. Inputs are checked by the server, not here. */
+    function(
+        options: StepBase & { readonly template_id: string; readonly inputs: Readonly<Record<string, unknown>> }
+    ): FunctionStep {
+        return Object.freeze({ kind: 'function', ...options })
+    },
+
+    email(options: EmailOptions): EmailStep {
+        const message: EmailMessage = {
+            from: options.fromIntegrationId === undefined ? {} : { integrationId: options.fromIntegrationId },
+            to: { email: options.to },
+            subject: options.subject,
+            text: options.text,
+            html: options.html,
+            ...(options.preheader === undefined ? {} : { preheader: options.preheader }),
+        }
+        return Object.freeze({
+            kind: 'email',
+            name: options.name,
+            ...(options.id === undefined ? {} : { id: options.id }),
+            message,
+        })
+    },
+
+    /** Emits a `conditional_branch`. A person who matches no condition continues after the branch. */
+    branch(options: StepBase & { readonly branches: readonly [Branch, ...Branch[]] }): BranchStep {
+        return Object.freeze({ kind: 'branch', ...options })
+    },
+}
+
+export const trigger = {
+    /** Fires on every matching event. */
+    event(options: { readonly event: string; readonly properties?: readonly PropertyCondition[] }): TriggerConfig {
+        return {
+            type: 'event',
+            filters: {
+                events: [
+                    {
+                        id: options.event,
+                        name: options.event,
+                        type: 'events',
+                        order: 0,
+                        properties: options.properties ?? [],
+                    },
+                ],
+                properties: [],
+                filter_test_accounts: false,
+            },
+        }
+    },
+
+    /** The cadence is a separate schedule object on the workflow, so it is not part of the definition. */
+    schedule(): TriggerConfig {
+        return { type: 'schedule' }
+    },
+}
diff --git a/products/workflows/packages/workflows/src/workflow.test.ts b/products/workflows/packages/workflows/src/workflow.test.ts
new file mode 100644
index 00000000000..331b1c6297e
--- /dev/null
+++ b/products/workflows/packages/workflows/src/workflow.test.ts
@@ -0,0 +1,244 @@
+import { describe, expect, test } from 'vitest'
+
+import { path, secret, step, trigger, workflow, WorkflowError, type Step, type WorkflowOptions } from './index.js'
+
+const notifyCrm = step.function({
+    name: 'Tell the CRM',
+    template_id: 'template-webhook',
+    inputs: { url: 'https://example.com/hooks/onboarding', signing_secret: secret('CRM_TOKEN') },
+})
+
+const onboarding: WorkflowOptions = {
+    key: 'onboarding-nudge',
+    name: 'Onboarding nudge',
+    variables: [{ key: 'plan', type: 'string', default: 'free' }],
+    trigger: trigger.event({ event: 'user signed up' }),
+    steps: path(
+        step.delay({ name: 'Wait a day', duration: '1d' }),
+        step.branch({
+            name: 'Which plan?',
+            branches: [
+                {
+                    name: 'Paid plan',
+                    when: [{ key: 'plan', operator: 'exact', value: ['pro'], type: 'person' }],
+                    then: [
+                        step.email({
+                            name: 'Welcome',
+                            to: '{person.properties.email}',
+                            subject: 'Welcome aboard',
+                            text: 'Thanks for upgrading.',
+                            html: '<p>Thanks for upgrading.</p>',
+                        }),
+                        notifyCrm,
+                    ],
+                },
+            ],
+        }),
+        notifyCrm
+    ),
+    exit: { reason: 'Onboarding finished' },
+}
+
+const env = { CRM_TOKEN: 'crm-token-value' }
+
+function refusal(options: WorkflowOptions, emitEnv: Record<string, string> = env): WorkflowError {
+    let caught: unknown
+    try {
+        workflow(options).emit({ env: emitEnv })
+    } catch (error) {
+        caught = error
+    }
+    expect(caught).toBeInstanceOf(WorkflowError)
+    return caught as WorkflowError
+}
+
+const delay = (name: string, duration = '1d'): Step => step.delay({ name, duration: duration as '1d' })
+
+describe('workflow emit', () => {
+    test('emits the definition HogFlowSerializer accepts, and it survives a JSON round trip unchanged', () => {
+        const emitted = workflow(onboarding).emit({ env })
+
+        expect(emitted).toEqual({
+            name: 'Onboarding nudge',
+            description: '',
+            status: 'draft',
+            exit_condition: 'exit_only_at_end',
+            variables: [{ key: 'plan', type: 'string', default: 'free' }],
+            actions: [
+                {
+                    id: 'trigger_node',
+                    name: 'Trigger',
+                    type: 'trigger',
+                    config: {
+                        type: 'event',
+                        filters: {
+                            events: [
+                                {
+                                    id: 'user signed up',
+                                    name: 'user signed up',
+                                    type: 'events',
+                                    order: 0,
+                                    properties: [],
+                                },
+                            ],
+                            properties: [],
+                            filter_test_accounts: false,
+                        },
+                    },
+                },
+                { id: 'wait_a_day', name: 'Wait a day', type: 'delay', config: { delay_duration: '1d' } },
+                {
+                    id: 'which_plan',
+                    name: 'Which plan?',
+                    type: 'conditional_branch',
+                    config: {
+                        conditions: [
+                            {
+                                name: 'Paid plan',
+                                filters: {
+                                    properties: [{ key: 'plan', operator: 'exact', value: ['pro'], type: 'person' }],
+                                },
+                            },
+                        ],
+                    },
+                },
+                {
+                    id: 'welcome',
+                    name: 'Welcome',
+                    type: 'function_email',
+                    config: {
+                        template_id: 'template-email',
+                        inputs: {
+                            email: {
+                                value: {
+                                    from: {},
+                                    to: { email: '{person.properties.email}' },
+                                    subject: 'Welcome aboard',
+                                    text: 'Thanks for upgrading.',
+                                    html: '<p>Thanks for upgrading.</p>',
+                                },
+                            },
+                        },
+                    },
+                },
+                {
+                    id: 'tell_the_crm_2',
+                    name: 'Tell the CRM',
+                    type: 'function',
+                    config: {
+                        template_id: 'template-webhook',
+                        inputs: {
+                            url: { value: 'https://example.com/hooks/onboarding' },
+                            signing_secret: { value: 'crm-token-value' },
+                        },
+                    },
+                },
+                {
+                    id: 'tell_the_crm',
+                    name: 'Tell the CRM',
+                    type: 'function',
+                    config: {
+                        template_id: 'template-webhook',
+                        inputs: {
+                            url: { value: 'https://example.com/hooks/onboarding' },
+                            signing_secret: { value: 'crm-token-value' },
+                        },
+                    },
+                },
+                { id: 'exit_node', name: 'Exit', type: 'exit', config: { reason: 'Onboarding finished' } },
+            ],
+            edges: [
+                { from: 'trigger_node', to: 'wait_a_day', type: 'continue' },
+                { from: 'wait_a_day', to: 'which_plan', type: 'continue' },
+                { from: 'which_plan', to: 'tell_the_crm', type: 'continue' },
+                { from: 'welcome', to: 'tell_the_crm_2', type: 'continue' },
+                { from: 'tell_the_crm_2', to: 'tell_the_crm', type: 'continue' },
+                { from: 'which_plan', to: 'welcome', type: 'branch', index: 0 },
+                { from: 'tell_the_crm', to: 'exit_node', type: 'continue' },
+            ],
+        })
+
+        const text = JSON.stringify(emitted)
+        expect(JSON.stringify(JSON.parse(text))).toBe(text)
+        expect(JSON.stringify(workflow(onboarding).emit({ env }))).toBe(text)
+    })
+
+    test.each<[string, WorkflowOptions, WorkflowError['status']]>([
+        [
+            'two different steps whose names slug to the same id',
+            { ...onboarding, steps: [delay('Wait a day'), delay('Wait a day!')] },
+            'duplicate_step_id',
+        ],
+        [
+            'an id override that takes another step id',
+            {
+                ...onboarding,
+                steps: [delay('Wait a day'), step.delay({ name: 'Other', id: 'wait_a_day', duration: '1h' })],
+            },
+            'duplicate_step_id',
+        ],
+        [
+            'a step id that takes the id of a second placement',
+            { ...onboarding, steps: [notifyCrm, notifyCrm, delay('Tell the CRM 2')] },
+            'duplicate_step_id',
+        ],
+        ['a step name with no letters or digits', { ...onboarding, steps: [delay('!!!')] }, 'empty_step_id'],
+        [
+            'a duration the server grammar rejects',
+            { ...onboarding, steps: [delay('Wait a thousand days', '1e3d')] },
+            'invalid_duration',
+        ],
+        [
+            'two variables with the same key',
+            {
+                ...onboarding,
+                variables: [
+                    { key: 'plan', type: 'string', default: 'free' },
+                    { key: 'plan', type: 'string', default: 'pro' },
+                ],
+            },
+            'duplicate_variable_key',
+        ],
+        [
+            'variables one byte over the cap',
+            // {"key": "big", "type": "string", "default": "..."} is 47 bytes plus the default.
+            { ...onboarding, variables: [{ key: 'big', type: 'string', default: 'x'.repeat(5120 - 47 + 1) }] },
+            'variables_too_large',
+        ],
+        [
+            'variables over the cap once non-ASCII is escaped the way the server measures it',
+            { ...onboarding, variables: [{ key: 'big', type: 'string', default: 'é'.repeat(1000) }] },
+            'variables_too_large',
+        ],
+    ])('refuses %s with status, message, why and fix', (_, options, status) => {
+        const error = refusal(options)
+
+        expect(error.status).toBe(status)
+        for (const field of [error.message, error.why, error.fix]) {
+            expect(field).toEqual(expect.any(String))
+            expect(field.length).toBeGreaterThan(0)
+        }
+    })
+
+    test('names both colliding steps in a slug collision', () => {
+        const error = refusal({ ...onboarding, steps: [delay('Wait a day'), delay('Wait a day!')] })
+
+        expect(error.message).toBe('Step "Wait a day!" and step "Wait a day" both get the action id "wait_a_day".')
+    })
+
+    test('accepts variables at exactly the cap', () => {
+        const options: WorkflowOptions = {
+            ...onboarding,
+            variables: [{ key: 'big', type: 'string', default: 'x'.repeat(5120 - 47) }],
+        }
+
+        expect(workflow(options).emit({ env }).variables).toHaveLength(1)
+    })
+
+    test('refuses a secret whose environment variable is not set', () => {
+        expect(refusal(onboarding, {})).toMatchObject({
+            status: 'missing_secret',
+            message: 'The environment variable CRM_TOKEN is not set.',
+        })
+    })
+})
diff --git a/products/workflows/packages/workflows/src/workflow.ts b/products/workflows/packages/workflows/src/workflow.ts
new file mode 100644
index 00000000000..f48ed134892
--- /dev/null
+++ b/products/workflows/packages/workflows/src/workflow.ts
@@ -0,0 +1,246 @@
+import type {
+    Action,
+    Edge,
+    FunctionInputs,
+    TriggerConfig,
+    Variable,
+    WorkflowDefinition,
+    WorkflowStatus,
+} from './definition.js'
+import { WorkflowError } from './errors.js'
+import { isSecretRef, type FunctionStep, type Path, type Step } from './steps.js'
+
+export interface WorkflowOptions {
+    /** Identifies this workflow across pushes. Keep it stable when the name changes. */
+    readonly key: string
+    readonly name: string
+    readonly description?: string
+    /** Defaults to `draft`, so a first push never starts sending live traffic. */
+    readonly status?: WorkflowStatus
+    readonly variables?: readonly Variable[]
+    readonly trigger: TriggerConfig
+    readonly steps: Path
+    readonly exit: { readonly reason: string }
+}
+
+export type Environment = Readonly<Record<string, string | undefined>>
+
+export interface Workflow {
+    readonly key: string
+    /** Builds the definition. `env` defaults to `process.env` and supplies every `secret()`. */
+    emit(options?: { readonly env?: Environment }): WorkflowDefinition
+}
+
+export function workflow(options: WorkflowOptions): Workflow {
+    return Object.freeze({
+        key: options.key,
+        emit: (emitOptions?: { readonly env?: Environment }) => emit(options, emitOptions?.env ?? process.env),
+    })
+}
+
+const TRIGGER_ID = 'trigger_node'
+const EXIT_ID = 'exit_node'
+
+// The same grammar as DURATION_PATTERN in products/workflows/backend/utils/durations.py. The
+// Duration type still lets through values such as '-1d' and '1e3d', which the server rejects.
+const DURATION = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)[dhms]$/
+
+// HOG_FLOW_VARIABLES_MAX_BYTES in products/workflows/backend/api/hog_flow.py.
+const VARIABLES_MAX_BYTES = 5120
+
+function slug(name: string): string {
+    return name
+        .toLowerCase()
+        .replace(/[^a-z0-9]+/g, '_')
+        .replace(/^_+|_+$/g, '')
+}
+
+class Ids {
+    private readonly placements = new Map<Step, number>()
+    private readonly owners = new Map<string, string>([
+        [TRIGGER_ID, 'the trigger'],
+        [EXIT_ID, 'the exit'],
+    ])
+    private readonly ownerSteps = new Map<string, Step>()
+
+    /** A second placement of the same value gets a suffix. Two different values may not share an id. */
+    next(step: Step): string {
+        const base = step.id ?? slug(step.name)
+        if (base === '') {
+            throw new WorkflowError({
+                status: 'empty_step_id',
+                message: `Step "${step.name}" has no letters or digits in its name.`,
+                why: 'The action id is made from the letters and digits of the step name, so this step has no id.',
+                fix: `Add letters or digits to the name of step "${step.name}", or give it an id.`,
+            })
+        }
+        const count = (this.placements.get(step) ?? 0) + 1
+        this.placements.set(step, count)
+        const id = count === 1 ? base : `${base}_${count}`
+
+        const owner = this.owners.get(id)
+        if (owner !== undefined && this.ownerSteps.get(id) !== step) {
+            throw new WorkflowError({
+                status: 'duplicate_step_id',
+                message: `Step "${step.name}" and ${owner} both get the action id "${id}".`,
+                why: 'Each action id must be unique in the workflow, because edges point at actions by id and PostHog stores secret inputs under the id.',
+                fix: `Rename one of them, or give step "${step.name}" its own id, for example id: "${base}_2".`,
+            })
+        }
+        this.owners.set(id, `step "${step.name}"`)
+        this.ownerSteps.set(id, step)
+        return id
+    }
+}
+
+function resolveInputs(step: FunctionStep, id: string, env: Environment): FunctionInputs {
+    const inputs: Record<string, { value: unknown }> = {}
+    for (const [key, raw] of Object.entries(step.inputs)) {
+        if (!isSecretRef(raw)) {
+            inputs[key] = { value: raw }
+            continue
+        }
+        const value = env[raw.__posthog_secret]
+        if (value === undefined || value === '') {
+            throw new WorkflowError({
+                status: 'missing_secret',
+                message: `The environment variable ${raw.__posthog_secret} is not set.`,
+                why: `Step "${step.name}" (${id}) reads the input "${key}" from it, and the workflow always sends a secret's value.`,
+                fix: `Set ${raw.__posthog_secret} in the environment that builds the workflow, then run it again.`,
+            })
+        }
+        inputs[key] = { value }
+    }
+    return inputs
+}
+
+interface Graph {
+    readonly ids: Ids
+    readonly actions: Action[]
+    readonly edges: Edge[]
+    readonly env: Environment
+}
+
+/** Adds the actions and edges of one path, and returns the id of its first action. */
+function emitPath(steps: Path, continuation: string, graph: Graph): string {
+    const ids = steps.map((step) => graph.ids.next(step))
+
+    steps.forEach((step, position) => {
+        const id = ids[position]!
+        const next = ids[position + 1] ?? continuation
+
+        switch (step.kind) {
+            case 'delay':
+                if (!DURATION.test(step.duration)) {
+                    throw new WorkflowError({
+                        status: 'invalid_duration',
+                        message: `Step "${step.name}" waits "${step.duration}", which is not a duration.`,
+                        why: 'PostHog reads a delay as a number followed by d, h, m or s.',
+                        fix: `Write the delay of step "${step.name}" as a number and a unit, for example "30m", "1.5h" or "1d".`,
+                    })
+                }
+                graph.actions.push({ id, name: step.name, type: 'delay', config: { delay_duration: step.duration } })
+                break
+            case 'function':
+                graph.actions.push({
+                    id,
+                    name: step.name,
+                    type: 'function',
+                    config: { template_id: step.template_id, inputs: resolveInputs(step, id, graph.env) },
+                })
+                break
+            case 'email':
+                graph.actions.push({
+                    id,
+                    name: step.name,
+                    type: 'function_email',
+                    config: { template_id: 'template-email', inputs: { email: { value: step.message } } },
+                })
+                break
+            case 'branch':
+                graph.actions.push({
+                    id,
+                    name: step.name,
+                    type: 'conditional_branch',
+                    config: {
+                        conditions: step.branches.map((branch) => ({
+                            name: branch.name,
+                            filters: { properties: [...branch.when] },
+                        })),
+                    },
+                })
+                break
+        }
+        // For a branch this is the no-match path.
+        graph.edges.push({ from: id, to: next, type: 'continue' })
+
+        if (step.kind === 'branch') {
+            step.branches.forEach((branch, index) => {
+                // Each path ends where the branch continues, and the edge index matches the condition index.
+                const entry = emitPath(branch.then, next, graph)
+                graph.edges.push({ from: id, to: entry, type: 'branch', index })
+            })
+        }
+    })
+
+    return ids[0]!
+}
+
+/** The length Python's json.dumps gives, which is what HogFlowVariableSerializer measures. */
+function serializedSize(variable: Variable): number {
+    const encode = (text: string): string =>
+        JSON.stringify(text).replace(/[\u0080-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
+    const entries = Object.entries(variable).map(([key, value]) => `${encode(key)}: ${encode(String(value))}`)
+    return `{${entries.join(', ')}}`.length
+}
+
+function checkVariables(variables: readonly Variable[]): void {
+    const seen = new Set<string>()
+    for (const variable of variables) {
+        if (seen.has(variable.key)) {
+            throw new WorkflowError({
+                status: 'duplicate_variable_key',
+                message: `The variable "${variable.key}" is defined twice.`,
+                why: 'Steps read a variable by its key, so each key must be unique in the workflow.',
+                fix: `Remove one of the two "${variable.key}" variables, or rename one of them.`,
+            })
+        }
+        seen.add(variable.key)
+    }
+
+    const size = variables.reduce((total, variable) => total + serializedSize(variable), 0)
+    if (size > VARIABLES_MAX_BYTES) {
+        throw new WorkflowError({
+            status: 'variables_too_large',
+            message: `The variables take ${size} bytes, over the limit of ${VARIABLES_MAX_BYTES}.`,
+            why: `PostHog refuses a workflow whose variable keys and default values take more than ${VARIABLES_MAX_BYTES} bytes in total.`,
+            fix: 'Shorten the longest default values, or remove variables the workflow does not read.',
+        })
+    }
+}
+
+function emit(options: WorkflowOptions, env: Environment): WorkflowDefinition {
+    const variables = (options.variables ?? []).map((variable) => ({
+        key: variable.key,
+        type: variable.type,
+        default: variable.default,
+    }))
+    checkVariables(variables)
+
+    const graph: Graph = { ids: new Ids(), actions: [], edges: [], env }
+    const entry = emitPath(options.steps, EXIT_ID, graph)
+
+    return {
+        name: options.name,
+        description: options.description ?? '',
+        status: options.status ?? 'draft',
+        exit_condition: 'exit_only_at_end',
+        variables,
+        actions: [
+            { id: TRIGGER_ID, name: 'Trigger', type: 'trigger', config: options.trigger },
+            ...graph.actions,
+            { id: EXIT_ID, name: 'Exit', type: 'exit', config: { reason: options.exit.reason } },
+        ],
+        edges: [{ from: TRIGGER_ID, to: entry, type: 'continue' }, ...graph.edges],
+    }
+}
diff --git a/products/workflows/packages/workflows/tsconfig.build.json b/products/workflows/packages/workflows/tsconfig.build.json
new file mode 100644
index 00000000000..f4916dea584
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.build.json
@@ -0,0 +1,9 @@
+{
+    "extends": "./tsconfig.json",
+    "compilerOptions": {
+        "noEmit": false,
+        "declaration": true,
+        "outDir": "dist"
+    },
+    "exclude": ["src/**/*.test.ts", "src/**/*.test-d.ts"]
+}
diff --git a/products/workflows/packages/workflows/tsconfig.cjs.json b/products/workflows/packages/workflows/tsconfig.cjs.json
new file mode 100644
index 00000000000..faea8843e80
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.cjs.json
@@ -0,0 +1,9 @@
+{
+    "extends": "./tsconfig.build.json",
+    "compilerOptions": {
+        "module": "commonjs",
+        "moduleResolution": "bundler",
+        "declaration": false,
+        "outDir": "dist/cjs"
+    }
+}
diff --git a/products/workflows/packages/workflows/tsconfig.json b/products/workflows/packages/workflows/tsconfig.json
new file mode 100644
index 00000000000..034aebaa030
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.json
@@ -0,0 +1,14 @@
+{
+    "compilerOptions": {
+        "target": "ES2022",
+        "module": "nodenext",
+        "moduleResolution": "nodenext",
+        "strict": true,
+        "noUncheckedIndexedAccess": true,
+        "skipLibCheck": true,
+        "types": ["node"],
+        "rootDir": "src",
+        "noEmit": true
+    },
+    "include": ["src"]
+}

```

## Diff V

Files:
- pnpm-lock.yaml (modified, +10 -3)
- pnpm-workspace.yaml (modified, +2 -0)
- products/workflows/packages/workflows/.gitignore (added, +2 -0)
- products/workflows/packages/workflows/README.md (added, +99 -0)
- products/workflows/packages/workflows/package.json (added, +42 -0)
- products/workflows/packages/workflows/src/definition.ts (added, +123 -0)
- products/workflows/packages/workflows/src/emit.ts (added, +303 -0)
- products/workflows/packages/workflows/src/errors.ts (added, +31 -0)
- products/workflows/packages/workflows/src/index.ts (added, +6 -0)
- products/workflows/packages/workflows/src/steps.ts (added, +150 -0)
- products/workflows/packages/workflows/src/triggers.ts (added, +26 -0)
- products/workflows/packages/workflows/src/workflow.ts (added, +49 -0)
- products/workflows/packages/workflows/tests/emit.test.ts (added, +404 -0)
- products/workflows/packages/workflows/tests/types.test-d.ts (added, +57 -0)
- products/workflows/packages/workflows/tsconfig.base.json (added, +17 -0)
- products/workflows/packages/workflows/tsconfig.build.json (added, +8 -0)
- products/workflows/packages/workflows/tsconfig.json (added, +7 -0)
- products/workflows/packages/workflows/tsconfig.test.json (added, +8 -0)

```diff
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 688810f9bc8..cf24f4db66c 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -5222,6 +5222,15 @@ importers:
         specifier: 'catalog:'
         version: 0.2.4(kea@4.0.0-pre.6(patch_hash=139b8d1f1304f9d9da452a9a1244c94ea679dbcb85687d8999563146879fb6f5)(react@18.3.1))
 
+  products/workflows/packages/workflows:
+    devDependencies:
+      '@types/node':
+        specifier: ^25.8.0
+        version: 25.8.0
+      typescript:
+        specifier: 6.0.3
+        version: 6.0.3
+
   rust/common/hogvm/node: {}
 
   rust/replay-anonymizer-node:
@@ -33426,7 +33435,6 @@ snapshots:
   '@types/node@25.8.0':
     dependencies:
       undici-types: 7.24.6
-    optional: true
 
   '@types/nodemailer@8.0.0':
     dependencies:
@@ -45770,8 +45778,7 @@ snapshots:
 
   undici-types@7.18.2: {}
 
-  undici-types@7.24.6:
-    optional: true
+  undici-types@7.24.6: {}
 
   undici-types@7.3.0: {}
 
diff --git a/pnpm-workspace.yaml b/pnpm-workspace.yaml
index 73322eb3b23..60d92e56ff8 100644
--- a/pnpm-workspace.yaml
+++ b/pnpm-workspace.yaml
@@ -16,6 +16,8 @@ packages:
     - nodejs
     - nodejs/src/scripts
     - products/*
+    # products/*/packages/* is not covered by the products/* glob, which matches one level.
+    - products/workflows/packages/*
     # products/desktop is a nested standalone workspace (own lockfile, catalog,
     # overrides, Node version); the root install must not absorb it.
     - '!products/desktop'
diff --git a/products/workflows/packages/workflows/.gitignore b/products/workflows/packages/workflows/.gitignore
new file mode 100644
index 00000000000..3ab3adab836
--- /dev/null
+++ b/products/workflows/packages/workflows/.gitignore
@@ -0,0 +1,2 @@
+dist/
+.test-build/
diff --git a/products/workflows/packages/workflows/README.md b/products/workflows/packages/workflows/README.md
new file mode 100644
index 00000000000..733e21bd3f4
--- /dev/null
+++ b/products/workflows/packages/workflows/README.md
@@ -0,0 +1,99 @@
+# @posthog/workflows
+
+Declare a PostHog workflow in TypeScript, so a reviewer reads a change as a diff and CI deploys it.
+
+This package holds the authoring surface and the compiler that turns it into the workflow definition the PostHog API stores.
+The `posthog-workflows` CLI that loads a file and pushes it is not in this package yet.
+
+## Write a workflow
+
+```ts
+import { branch, delay, email, onEvent, path, person, secret, webhook, workflow } from '@posthog/workflows'
+
+const notifyCrm = webhook({
+  name: 'Tell the CRM to follow up',
+  url: 'https://example.com/hooks/onboarding',
+  body: { distinct_id: '{event.distinct_id}' },
+  signingSecret: secret('CRM_WEBHOOK_SECRET'),
+})
+
+const welcomeEmail = email({
+  name: 'Welcome the paid customer',
+  to: '{person.properties.email}',
+  subject: 'Welcome aboard',
+  text: 'Thanks for upgrading. Here is how to get started.',
+  html: '<p>Thanks for upgrading. Here is how to get started.</p>',
+})
+
+export const onboarding = workflow({
+  key: 'REPLACE-ME-onboarding-nudge',
+  name: 'Onboarding nudge',
+  on: onEvent({ event: 'user signed up' }),
+  steps: path(
+    delay('1d', { name: 'Wait a day' }),
+    branch({
+      name: 'Which plan?',
+      branches: [
+        {
+          name: 'Paid plan',
+          when: [person('plan', 'exact', ['pro'])],
+          then: path(welcomeEmail, notifyCrm),
+        },
+        {
+          name: 'Free plan',
+          when: [person('plan', 'exact', ['free'])],
+          then: path(delay('2d', { name: 'Give the free plan two days' }), notifyCrm),
+        },
+      ],
+    })
+  ),
+  exit: { reason: 'Onboarding nudge finished' },
+})
+```
+
+`key` is how PostHog finds the workflow again, and it must be unique in your project.
+Pick your own; the CLI refuses the `REPLACE-ME-` placeholder above.
+
+## What the compiler decides for you
+
+- **A step is a value.** It carries no id and no position, so the same value placed two times makes two steps in the graph.
+- **An action id is the slug of the step name.** It survives an insertion or a reorder, so live runs stay on the step they are on. Two steps that slug to the same id are refused. Pass `id` on a step to pin an id through a rename.
+- **Edges come from placement**, including the branch indexes, so a condition and the edge that runs it cannot disagree.
+- **A sub-path is a non-empty tuple**, so an empty branch does not compile.
+- **The status defaults to `draft`**, so a first push sends nothing to a real person. Set `status: 'active'` in the file to turn a workflow on.
+
+## Secrets
+
+`secret('NAME')` names an environment variable. The name lives in your repository, the value does not.
+`emit` reads the variable from the environment that runs the push and sends the value, so PostHog never has to recover a secret it was not sent.
+An unset or empty variable is refused before anything is sent.
+
+Pass `secret()` as the value of a whole input. A secret nested inside a larger value is refused, because only the name of the variable would reach PostHog.
+
+## Errors
+
+Every refusal carries four fields:
+
+```text
+status: missing_secret
+message: The environment variable CRM_WEBHOOK_SECRET is not set.
+why: Step "Tell the CRM to follow up" names CRM_WEBHOOK_SECRET for the secret input "signing_secret". A secret is always sent rather than read back from PostHog, so there is nothing to send.
+fix: Set CRM_WEBHOOK_SECRET in the environment that runs the push, then push again.
+```
+
+## v1 surface
+
+Actions: `delay`, `fn` (any CDP template by id), `webhook`, `email`, `branch`, and the trigger and exit the compiler adds.
+Triggers: `onEvent` and `onSchedule`.
+
+Email content is inline. There is no way to reference a saved template, because PostHog copies a referenced template into the workflow when it writes, and the stored workflow would then never match the one you pushed.
+
+## Develop
+
+```bash
+pnpm --filter=@posthog/workflows build
+pnpm --filter=@posthog/workflows test
+```
+
+`test` runs the type rules through `tsc` first, then the unit tests on `node --test`.
+`tests/types.test-d.ts` holds the rules that the compiler enforces rather than an assertion, so a rule that relaxes fails the build.
diff --git a/products/workflows/packages/workflows/package.json b/products/workflows/packages/workflows/package.json
new file mode 100644
index 00000000000..72879fd8cd3
--- /dev/null
+++ b/products/workflows/packages/workflows/package.json
@@ -0,0 +1,42 @@
+{
+    "name": "@posthog/workflows",
+    "version": "0.0.0",
+    "private": true,
+    "description": "Declare a PostHog workflow in TypeScript, review it as a diff, and deploy it from CI.",
+    "license": "MIT",
+    "repository": {
+        "type": "git",
+        "url": "https://github.com/PostHog/posthog.git",
+        "directory": "products/workflows/packages/workflows"
+    },
+    "bin": {
+        "posthog-workflows": "./dist/cli/index.js"
+    },
+    "files": [
+        "dist"
+    ],
+    "type": "module",
+    "main": "./dist/index.js",
+    "types": "./dist/index.d.ts",
+    "exports": {
+        ".": {
+            "types": "./dist/index.d.ts",
+            "import": "./dist/index.js",
+            "require": "./dist/index.js",
+            "default": "./dist/index.js"
+        },
+        "./package.json": "./package.json"
+    },
+    "scripts": {
+        "build": "tsc -p tsconfig.build.json",
+        "typecheck": "tsc -p tsconfig.json",
+        "test": "tsc -p tsconfig.test.json && node --test \".test-build/tests/**/*.test.js\""
+    },
+    "devDependencies": {
+        "@types/node": "^25.8.0",
+        "typescript": "catalog:"
+    },
+    "engines": {
+        "node": ">=22.12"
+    }
+}
diff --git a/products/workflows/packages/workflows/src/definition.ts b/products/workflows/packages/workflows/src/definition.ts
new file mode 100644
index 00000000000..de9363b47f3
--- /dev/null
+++ b/products/workflows/packages/workflows/src/definition.ts
@@ -0,0 +1,123 @@
+// The create/update body that POST/PATCH /api/projects/{id}/hog_flows/ accepts.
+
+/**
+ * A wait the API accepts: a number and a unit, matching `^\d*\.?\d+[dhms]$`.
+ * The template literal stops `'soon'` in the editor; `emit` re-checks the value,
+ * because the literal type also admits `-1d` and `1e3d`.
+ */
+export type Duration = `${number}d` | `${number}h` | `${number}m` | `${number}s`
+
+export type PropertyType = 'event' | 'person' | 'group'
+
+export type PropertyOperator =
+    | 'exact'
+    | 'is_not'
+    | 'icontains'
+    | 'not_icontains'
+    | 'is_set'
+    | 'is_not_set'
+    | 'gt'
+    | 'lt'
+
+/** One property condition. `bytecode` is compiled server-side and is never sent. */
+export interface PropertyCondition {
+    readonly key: string
+    readonly value?: readonly (string | number | boolean)[]
+    readonly operator: PropertyOperator
+    readonly type: PropertyType
+}
+
+export interface EventFilter {
+    readonly id: string
+    readonly name: string
+    readonly type: 'events'
+    readonly order: number
+    readonly properties: readonly PropertyCondition[]
+}
+
+export interface ActionFilters {
+    readonly events: readonly EventFilter[]
+    readonly properties: readonly PropertyCondition[]
+    readonly filter_test_accounts: boolean
+}
+
+export type TriggerConfig = { readonly type: 'event'; readonly filters: ActionFilters } | { readonly type: 'schedule' }
+
+export interface BranchCondition {
+    readonly name: string
+    readonly filters: { readonly properties: readonly PropertyCondition[] }
+}
+
+/** Function input values are wrapped so hog templating (`{person.x}`) resolves. */
+export type FunctionInputs = Readonly<Record<string, { readonly value: unknown }>>
+
+/** The inline email message: `template-email`'s single input, at `config.inputs.email.value`. */
+export interface EmailMessage {
+    readonly from: { readonly integrationId?: number }
+    readonly to: { readonly email: string }
+    readonly subject: string
+    readonly text: string
+    readonly html: string
+    readonly preheader?: string
+}
+
+interface ActionBase {
+    readonly id: string
+    readonly name: string
+}
+
+export type Action =
+    | (ActionBase & { readonly type: 'trigger'; readonly config: TriggerConfig })
+    | (ActionBase & { readonly type: 'delay'; readonly config: { readonly delay_duration: Duration } })
+    | (ActionBase & {
+          readonly type: 'conditional_branch'
+          readonly config: { readonly conditions: readonly BranchCondition[] }
+      })
+    | (ActionBase & {
+          readonly type: 'function'
+          readonly config: { readonly template_id: string; readonly inputs: FunctionInputs }
+      })
+    | (ActionBase & {
+          readonly type: 'function_email'
+          // The server coerces `template_id` to `template-email` whatever the client sends,
+          // so the SDK sends that literal and has no route to a saved template UUID.
+          readonly config: {
+              readonly template_id: 'template-email'
+              readonly inputs: { readonly email: { readonly value: EmailMessage } }
+          }
+      })
+    | (ActionBase & { readonly type: 'exit'; readonly config: { readonly reason: string } })
+
+export type Edge =
+    | { readonly from: string; readonly to: string; readonly type: 'continue' }
+    | { readonly from: string; readonly to: string; readonly type: 'branch'; readonly index: number }
+
+export type ExitCondition =
+    | 'exit_only_at_end'
+    | 'exit_on_conversion'
+    | 'exit_on_trigger_not_matched'
+    | 'exit_on_trigger_not_matched_or_conversion'
+
+export type WorkflowStatus = 'draft' | 'active' | 'archived'
+
+export interface WorkflowVariable {
+    readonly key: string
+    readonly type: 'string' | 'number' | 'boolean'
+    readonly default: string
+}
+
+/**
+ * The create/update request body. Deliberately narrow: `trigger`, `version`,
+ * `billable_action_types`, `abort_action`, `action_redirects` and the `draft*`
+ * fields are read-only on the serializer and must never be sent.
+ */
+export interface WorkflowDefinition {
+    readonly key: string
+    readonly name: string
+    readonly description: string
+    readonly status: WorkflowStatus
+    readonly exit_condition: ExitCondition
+    readonly variables: readonly WorkflowVariable[]
+    readonly actions: readonly Action[]
+    readonly edges: readonly Edge[]
+}
diff --git a/products/workflows/packages/workflows/src/emit.ts b/products/workflows/packages/workflows/src/emit.ts
new file mode 100644
index 00000000000..9d4adfc7f6a
--- /dev/null
+++ b/products/workflows/packages/workflows/src/emit.ts
@@ -0,0 +1,303 @@
+// Ids and edges are derived here and never written by an author, which is what keeps a
+// branch index and the edge that carries it from drifting apart.
+
+import type {
+    Action,
+    BranchCondition,
+    Duration,
+    Edge,
+    ExitCondition,
+    FunctionInputs,
+    TriggerConfig,
+    WorkflowDefinition,
+    WorkflowStatus,
+    WorkflowVariable,
+} from './definition.js'
+import { WorkflowError } from './errors.js'
+import { isSecretRef, type Path, type Step } from './steps.js'
+
+/** The trigger and the exit carry no author-written name, so their ids are fixed. */
+const TRIGGER_ID = 'trigger_node'
+const EXIT_ID = 'exit_node'
+const RESERVED_IDS = new Set([TRIGGER_ID, EXIT_ID])
+
+/** The serializer's rule for `delay_duration`. */
+const DURATION_PATTERN = /^\d*\.?\d+[dhms]$/
+
+/** The serializer caps the whole `variables` list at this many bytes. */
+const VARIABLES_MAX_BYTES = 5120
+
+export interface EmitOptions {
+    /** The deployer's environment, where `secret('NAME')` is read from. Defaults to `process.env`. */
+    readonly env?: Readonly<Record<string, string | undefined>>
+}
+
+/** One resolved secret, so a diff can exclude the keys PostHog reads back as a placeholder. */
+export interface SecretInput {
+    readonly actionId: string
+    readonly inputKey: string
+    readonly envName: string
+}
+
+export interface EmitResult {
+    readonly definition: WorkflowDefinition
+    readonly secretInputs: readonly SecretInput[]
+}
+
+export interface CompileOptions {
+    readonly key: string
+    readonly name: string
+    readonly description?: string
+    readonly status?: WorkflowStatus
+    readonly exitCondition?: ExitCondition
+    readonly variables?: readonly WorkflowVariable[]
+    readonly trigger: TriggerConfig
+    readonly steps: Path
+    readonly exit: { readonly reason: string }
+}
+
+function slug(name: string): string {
+    const cleaned = name
+        .toLowerCase()
+        .replace(/[^a-z0-9]+/g, '_')
+        .replace(/^_+|_+$/g, '')
+    return cleaned === '' ? 'step' : cleaned
+}
+
+/**
+ * The id is the slug of the step name, so it survives an insertion or a reorder and
+ * moves only on a rename, which a reviewer sees in the diff. PostHog keys a workflow's
+ * in-flight participants and its secrets on the action id, so a shared id is refused
+ * rather than made unique behind the author's back. One step value placed a second
+ * time is the exception, because it is the same step, so it takes a numbered id.
+ */
+class Ids {
+    private readonly baseOwner = new Map<string, Step>()
+    private readonly idOwner = new Map<string, Step>()
+    private readonly counts = new Map<string, number>()
+
+    next(step: Step): string {
+        const base = step.id ?? slug(step.name)
+        this.refuseReserved(base, step)
+        this.refuseTaken(this.baseOwner, base, base, step)
+        this.baseOwner.set(base, step)
+
+        const seen = (this.counts.get(base) ?? 0) + 1
+        this.counts.set(base, seen)
+        const id = seen === 1 ? base : `${base}_${seen}`
+
+        this.refuseReserved(id, step)
+        this.refuseTaken(this.idOwner, id, id, step)
+        this.idOwner.set(id, step)
+        return id
+    }
+
+    private refuseReserved(id: string, step: Step): void {
+        if (!RESERVED_IDS.has(id)) {
+            return
+        }
+        throw new WorkflowError({
+            status: 'reserved_action_id',
+            message: `Step "${step.name}" takes the action id "${id}", which is reserved.`,
+            why: `Every workflow has a trigger node and an exit node, and they always use the ids "${TRIGGER_ID}" and "${EXIT_ID}".`,
+            fix: 'Rename the step, or give it an explicit id.',
+        })
+    }
+
+    private refuseTaken(owners: Map<string, Step>, key: string, id: string, step: Step): void {
+        const owner = owners.get(key)
+        if (owner === undefined || owner === step) {
+            return
+        }
+        throw new WorkflowError({
+            status: 'duplicate_action_id',
+            message: `Two steps produce the action id "${id}".`,
+            why: `An action id is the slug of the step name, and the steps "${owner.name}" and "${step.name}" slug to the same id. PostHog keys a workflow's in-flight participants and its secrets on the action id, so two steps cannot share one.`,
+            fix: 'Rename one of the steps, or give one an explicit id.',
+        })
+    }
+}
+
+function checkDuration(duration: Duration, step: Step): void {
+    if (DURATION_PATTERN.test(duration)) {
+        return
+    }
+    throw new WorkflowError({
+        status: 'invalid_duration',
+        message: `Step "${step.name}" waits for "${duration}", which is not a duration.`,
+        why: 'A wait is a positive number and one of the units s, m, h or d, for example "30m" or "1.5d".',
+        fix: `Change "${duration}" to a number and a unit.`,
+    })
+}
+
+/**
+ * The byte length the serializer measures, which is Python's `json.dumps`: a space
+ * after every separator, and every non-ASCII character escaped. Counting the shorter
+ * JavaScript form here would pass a file that the API then refuses.
+ */
+function serializedSize(variable: WorkflowVariable): number {
+    const escape = (value: string): string =>
+        JSON.stringify(value).replace(
+            /[\u007f-￿]/g,
+            (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
+        )
+    const pairs = Object.entries(variable).map(([key, value]) => `${escape(key)}: ${escape(String(value))}`)
+    return `{${pairs.join(', ')}}`.length
+}
+
+function checkVariables(variables: readonly WorkflowVariable[]): void {
+    const seen = new Set<string>()
+    for (const variable of variables) {
+        if (seen.has(variable.key)) {
+            throw new WorkflowError({
+                status: 'duplicate_variable_key',
+                message: `The workflow declares the variable "${variable.key}" two times.`,
+                why: 'A run looks a variable up by its key, so two variables with one key have no defined value.',
+                fix: `Remove one of the "${variable.key}" entries, or rename it.`,
+            })
+        }
+        seen.add(variable.key)
+    }
+
+    const total = variables.reduce((size, variable) => size + serializedSize(variable), 0)
+    if (total > VARIABLES_MAX_BYTES) {
+        throw new WorkflowError({
+            status: 'variables_too_large',
+            message: `The variables add up to ${total} bytes, and the limit is ${VARIABLES_MAX_BYTES}.`,
+            why: 'PostHog carries the variables with every run of the workflow, so the whole list is capped.',
+            fix: 'Shorten the defaults, or move the long values into the step that uses them.',
+        })
+    }
+}
+
+interface Context {
+    readonly ids: Ids
+    readonly actions: Action[]
+    readonly edges: Edge[]
+    readonly secretInputs: SecretInput[]
+    readonly env: Readonly<Record<string, string | undefined>>
+}
+
+function resolveInputs(step: Step & { kind: 'function' }, actionId: string, context: Context): FunctionInputs {
+    const resolved: Record<string, { value: unknown }> = {}
+    for (const [key, raw] of Object.entries(step.inputs)) {
+        if (!isSecretRef(raw)) {
+            refuseNestedSecret(raw, key, step)
+            resolved[key] = { value: raw }
+            continue
+        }
+        const value = context.env[raw.__secret]
+        if (value === undefined || value === '') {
+            throw new WorkflowError({
+                status: 'missing_secret',
+                message: `The environment variable ${raw.__secret} is not set.`,
+                why: `Step "${step.name}" names ${raw.__secret} for the secret input "${key}". A secret is always sent rather than read back from PostHog, so there is nothing to send.`,
+                fix: `Set ${raw.__secret} in the environment that runs the push, then push again.`,
+            })
+        }
+        resolved[key] = { value }
+        context.secretInputs.push({ actionId, inputKey: key, envName: raw.__secret })
+    }
+    return resolved
+}
+
+/** A secret nested inside an input value would reach PostHog as the variable name. */
+function refuseNestedSecret(value: unknown, key: string, step: Step): void {
+    if (!JSON.stringify(value ?? null)?.includes('"__secret"')) {
+        return
+    }
+    throw new WorkflowError({
+        status: 'nested_secret',
+        message: `Step "${step.name}" puts a secret inside the input "${key}".`,
+        why: 'Only a whole input can be a secret. Inside a value the name of the environment variable, not its value, would reach PostHog.',
+        fix: `Pass secret('NAME') as the value of "${key}" itself, or move that part of the value into its own input.`,
+    })
+}
+
+/** Compiles a path and returns the id of its first node. */
+function compilePath(steps: readonly Step[], continuation: string, context: Context): string {
+    const ids = steps.map((step) => context.ids.next(step))
+
+    steps.forEach((step, position) => {
+        const id = ids[position]!
+        const next = ids[position + 1] ?? continuation
+
+        if (step.kind === 'delay') {
+            checkDuration(step.duration, step)
+            context.actions.push({ id, name: step.name, type: 'delay', config: { delay_duration: step.duration } })
+            context.edges.push({ from: id, to: next, type: 'continue' })
+            return
+        }
+
+        if (step.kind === 'function') {
+            context.actions.push({
+                id,
+                name: step.name,
+                type: 'function',
+                config: { template_id: step.templateId, inputs: resolveInputs(step, id, context) },
+            })
+            context.edges.push({ from: id, to: next, type: 'continue' })
+            return
+        }
+
+        if (step.kind === 'email') {
+            context.actions.push({
+                id,
+                name: step.name,
+                type: 'function_email',
+                config: { template_id: 'template-email', inputs: { email: { value: step.email } } },
+            })
+            context.edges.push({ from: id, to: next, type: 'continue' })
+            return
+        }
+
+        const conditions: BranchCondition[] = step.branches.map((spec) => ({
+            name: spec.name,
+            filters: { properties: [...spec.when] },
+        }))
+        context.actions.push({ id, name: step.name, type: 'conditional_branch', config: { conditions } })
+        // The fall-through edge is the no-match path out of the branch.
+        context.edges.push({ from: id, to: next, type: 'continue' })
+
+        step.branches.forEach((spec, index) => {
+            // The index and its edge come from the same array position, so they agree.
+            const entry = compilePath(spec.then, next, context)
+            context.edges.push({ from: id, to: entry, type: 'branch', index })
+        })
+    })
+
+    return ids[0] ?? continuation
+}
+
+export function compile(options: CompileOptions, emitOptions: EmitOptions = {}): EmitResult {
+    const variables = options.variables ?? []
+    checkVariables(variables)
+
+    const context: Context = {
+        ids: new Ids(),
+        actions: [],
+        edges: [],
+        secretInputs: [],
+        env: emitOptions.env ?? process.env,
+    }
+
+    const entry = compilePath(options.steps, EXIT_ID, context)
+
+    context.actions.unshift({ id: TRIGGER_ID, name: 'Trigger', type: 'trigger', config: options.trigger })
+    context.edges.unshift({ from: TRIGGER_ID, to: entry, type: 'continue' })
+    context.actions.push({ id: EXIT_ID, name: 'Exit', type: 'exit', config: { reason: options.exit.reason } })
+
+    return {
+        definition: {
+            key: options.key,
+            name: options.name,
+            description: options.description ?? '',
+            status: options.status ?? 'draft',
+            exit_condition: options.exitCondition ?? 'exit_only_at_end',
+            variables,
+            actions: context.actions,
+            edges: context.edges,
+        },
+        secretInputs: context.secretInputs,
+    }
+}
diff --git a/products/workflows/packages/workflows/src/errors.ts b/products/workflows/packages/workflows/src/errors.ts
new file mode 100644
index 00000000000..238b0c9d2aa
--- /dev/null
+++ b/products/workflows/packages/workflows/src/errors.ts
@@ -0,0 +1,31 @@
+/** The four fields every refusal carries, in the SDK and in the API alike. */
+export interface WorkflowErrorFields {
+    /** A stable machine-readable code, for example `missing_secret`. */
+    readonly status: string
+    /** What happened, in one sentence. */
+    readonly message: string
+    /** Why it is refused rather than accepted. */
+    readonly why: string
+    /** The next action the author takes. */
+    readonly fix: string
+}
+
+export class WorkflowError extends Error {
+    readonly fields: WorkflowErrorFields
+
+    constructor(fields: WorkflowErrorFields) {
+        super(fields.message)
+        this.name = 'WorkflowError'
+        this.fields = fields
+    }
+
+    /** The four fields as the CLI prints them. */
+    print(): string {
+        return [
+            `status: ${this.fields.status}`,
+            `message: ${this.fields.message}`,
+            `why: ${this.fields.why}`,
+            `fix: ${this.fields.fix}`,
+        ].join('\n')
+    }
+}
diff --git a/products/workflows/packages/workflows/src/index.ts b/products/workflows/packages/workflows/src/index.ts
new file mode 100644
index 00000000000..3c18f21fb7b
--- /dev/null
+++ b/products/workflows/packages/workflows/src/index.ts
@@ -0,0 +1,6 @@
+export * from './definition.js'
+export * from './emit.js'
+export * from './errors.js'
+export * from './steps.js'
+export * from './triggers.js'
+export * from './workflow.js'
diff --git a/products/workflows/packages/workflows/src/steps.ts b/products/workflows/packages/workflows/src/steps.ts
new file mode 100644
index 00000000000..a5cb2f88ead
--- /dev/null
+++ b/products/workflows/packages/workflows/src/steps.ts
@@ -0,0 +1,150 @@
+// A step is a frozen value with no id and no position, so one value can sit at two
+// places in one graph and `emit` derives the ids and the edges.
+
+import type { Duration, EmailMessage, PropertyCondition, PropertyOperator, PropertyType } from './definition.js'
+
+/**
+ * A named environment variable. The name travels in the source, the value never
+ * does: `emit` reads the variable from the deployer's environment and always sends
+ * the value, so PostHog never has to recover a secret it was not sent.
+ */
+export interface SecretRef {
+    readonly __secret: string
+}
+
+export function secret(envName: string): SecretRef {
+    return Object.freeze({ __secret: envName })
+}
+
+export function isSecretRef(value: unknown): value is SecretRef {
+    return typeof value === 'object' && value !== null && typeof (value as SecretRef).__secret === 'string'
+}
+
+export type Conditions = readonly [PropertyCondition, ...PropertyCondition[]]
+
+/**
+ * A sub-path is a non-empty tuple of step values. `readonly Step[]` would accept
+ * `[]`, and an empty branch path emits a branch edge aimed at the no-match target,
+ * which silently makes the branch decide nothing.
+ */
+export type Path = readonly [Step, ...Step[]]
+
+export interface BranchSpec {
+    readonly name: string
+    readonly when: Conditions
+    readonly then: Path
+}
+
+/** `id` pins the action id, so a rename does not move it. */
+interface StepBase {
+    readonly name: string
+    readonly id?: string
+}
+
+export type Step =
+    | Readonly<StepBase & { kind: 'delay'; duration: Duration }>
+    | Readonly<StepBase & { kind: 'function'; templateId: string; inputs: Readonly<Record<string, unknown>> }>
+    | Readonly<StepBase & { kind: 'email'; email: EmailMessage }>
+    | Readonly<StepBase & { kind: 'branch'; branches: readonly [BranchSpec, ...BranchSpec[]] }>
+
+function withId<T extends object>(options: { readonly id?: string }, step: T): Readonly<T & { id?: string }> {
+    return Object.freeze(options.id === undefined ? step : { ...step, id: options.id })
+}
+
+export function delay(duration: Duration, options: { name: string; id?: string }): Step {
+    return withId(options, { kind: 'delay' as const, name: options.name, duration })
+}
+
+/**
+ * The escape hatch: any CDP template by id. The compiler does not know the
+ * template's input schema, so PostHog validates the inputs when the push lands.
+ */
+export function fn(options: {
+    name: string
+    id?: string
+    templateId: string
+    inputs: Readonly<Record<string, unknown>>
+}): Step {
+    return withId(options, {
+        kind: 'function' as const,
+        name: options.name,
+        templateId: options.templateId,
+        inputs: options.inputs,
+    })
+}
+
+/** Its signing secret is the one secret in the v1 surface. */
+export function webhook(options: {
+    name: string
+    id?: string
+    url: string
+    method?: 'POST' | 'PUT' | 'PATCH' | 'GET' | 'DELETE'
+    body?: Record<string, unknown>
+    headers?: Record<string, string>
+    signingSecret?: SecretRef
+}): Step {
+    const inputs: Record<string, unknown> = {
+        url: options.url,
+        method: options.method ?? 'POST',
+        body: options.body ?? {},
+    }
+    if (options.headers !== undefined) {
+        inputs.headers = options.headers
+    }
+    if (options.signingSecret !== undefined) {
+        inputs.signing_secret = options.signingSecret
+    }
+    return fn({
+        ...(options.id === undefined ? {} : { id: options.id }),
+        name: options.name,
+        templateId: 'template-webhook',
+        inputs,
+    })
+}
+
+/**
+ * A typed email step. The content is inline, because PostHog materializes a
+ * referenced library template when it writes, and the stored definition would then
+ * never match the one the push sent.
+ */
+export function email(options: {
+    name: string
+    id?: string
+    to: string
+    subject: string
+    text: string
+    html: string
+    preheader?: string
+    fromIntegrationId?: number
+}): Step {
+    const message: EmailMessage = {
+        from: options.fromIntegrationId === undefined ? {} : { integrationId: options.fromIntegrationId },
+        to: { email: options.to },
+        subject: options.subject,
+        text: options.text,
+        html: options.html,
+        ...(options.preheader === undefined ? {} : { preheader: options.preheader }),
+    }
+    return withId(options, { kind: 'email' as const, name: options.name, email: message })
+}
+
+export function branch(options: { name: string; id?: string; branches: readonly [BranchSpec, ...BranchSpec[]] }): Step {
+    return withId(options, { kind: 'branch' as const, name: options.name, branches: options.branches })
+}
+
+/** Names a reusable sub-path. Identity is the tuple, so a path is a value like a step. */
+export function path(...steps: Path): Path {
+    return steps
+}
+
+function condition(type: PropertyType) {
+    return (
+        key: string,
+        operator: PropertyOperator,
+        value?: readonly (string | number | boolean)[]
+    ): PropertyCondition => (value === undefined ? { key, operator, type } : { key, operator, value, type })
+}
+
+export const person = condition('person')
+export const eventProperty = condition('event')
+export const group = condition('group')
diff --git a/products/workflows/packages/workflows/src/triggers.ts b/products/workflows/packages/workflows/src/triggers.ts
new file mode 100644
index 00000000000..6a384eef545
--- /dev/null
+++ b/products/workflows/packages/workflows/src/triggers.ts
@@ -0,0 +1,26 @@
+import type { PropertyCondition, TriggerConfig } from './definition.js'
+
+/** An event trigger. It fires on every matching occurrence. */
+export function onEvent(options: { event: string; properties?: readonly PropertyCondition[] }): TriggerConfig {
+    return {
+        type: 'event',
+        filters: {
+            events: [
+                {
+                    id: options.event,
+                    name: options.event,
+                    type: 'events',
+                    order: 0,
+                    properties: options.properties ?? [],
+                },
+            ],
+            properties: [],
+            filter_test_accounts: false,
+        },
+    }
+}
+
+/** A schedule trigger. The cadence is attached in PostHog and is not part of the definition. */
+export function onSchedule(): TriggerConfig {
+    return { type: 'schedule' }
+}
diff --git a/products/workflows/packages/workflows/src/workflow.ts b/products/workflows/packages/workflows/src/workflow.ts
new file mode 100644
index 00000000000..808ad334df7
--- /dev/null
+++ b/products/workflows/packages/workflows/src/workflow.ts
@@ -0,0 +1,49 @@
+import type { ExitCondition, TriggerConfig, WorkflowStatus, WorkflowVariable } from './definition.js'
+import { compile, type EmitOptions, type EmitResult } from './emit.js'
+import type { Path } from './steps.js'
+
+export interface WorkflowOptions {
+    /**
+     * The workflow's identity inside a project, unique for each team. `push` resolves
+     * it, then creates or updates, so one file can reach a staging and a production
+     * project. PostHog's own id never travels back into the source.
+     */
+    readonly key: string
+    readonly name: string
+    readonly description?: string
+    /** Defaults to `draft`, so a first push sends nothing to a real person. */
+    readonly status?: WorkflowStatus
+    readonly exitCondition?: ExitCondition
+    readonly variables?: readonly WorkflowVariable[]
+    readonly on: TriggerConfig
+    readonly steps: Path
+    readonly exit: { readonly reason: string }
+}
+
+export interface Workflow {
+    readonly key: string
+    /** Resolves the secrets, validates the graph, and returns the definition to push. */
+    emit(options?: EmitOptions): EmitResult
+}
+
+/** Declares one workflow. The file exports it, and `posthog-workflows push` sends it. */
+export function workflow(options: WorkflowOptions): Workflow {
+    return {
+        key: options.key,
+        emit: (emitOptions) =>
+            compile(
+                {
+                    key: options.key,
+                    name: options.name,
+                    ...(options.description === undefined ? {} : { description: options.description }),
+                    ...(options.status === undefined ? {} : { status: options.status }),
+                    ...(options.exitCondition === undefined ? {} : { exitCondition: options.exitCondition }),
+                    ...(options.variables === undefined ? {} : { variables: options.variables }),
+                    trigger: options.on,
+                    steps: options.steps,
+                    exit: options.exit,
+                },
+                emitOptions
+            ),
+    }
+}
diff --git a/products/workflows/packages/workflows/tests/emit.test.ts b/products/workflows/packages/workflows/tests/emit.test.ts
new file mode 100644
index 00000000000..fca3bb38e4b
--- /dev/null
+++ b/products/workflows/packages/workflows/tests/emit.test.ts
@@ -0,0 +1,404 @@
+import assert from 'node:assert/strict'
+import { describe, test } from 'node:test'
+
+import {
+    WorkflowError,
+    branch,
+    delay,
+    email,
+    fn,
+    onEvent,
+    onSchedule,
+    path,
+    person,
+    secret,
+    webhook,
+    workflow,
+} from '../src/index.js'
+import type { Action, Duration, WorkflowErrorFields, WorkflowVariable } from '../src/index.js'
+
+const notifyCrm = webhook({
+    name: 'Tell the CRM to follow up',
+    url: 'https://example.com/hooks/onboarding',
+    body: { distinct_id: '{event.distinct_id}' },
+    signingSecret: secret('CRM_TOKEN'),
+})
+
+const welcomeEmail = email({
+    name: 'Welcome the paid customer',
+    to: '{person.properties.email}',
+    subject: 'Welcome aboard',
+    text: 'Thanks for upgrading.',
+    html: '<p>Thanks for upgrading.</p>',
+})
+
+const onboarding = workflow({
+    key: 'onboarding-nudge',
+    name: 'Onboarding nudge',
+    on: onEvent({ event: 'user signed up' }),
+    steps: path(
+        delay('1d', { name: 'Wait a day' }),
+        branch({
+            name: 'Which plan?',
+            branches: [
+                {
+                    name: 'Paid plan',
+                    when: [person('plan', 'exact', ['pro'])],
+                    then: path(welcomeEmail, notifyCrm),
+                },
+                {
+                    name: 'Free plan',
+                    when: [person('plan', 'exact', ['free'])],
+                    then: path(delay('2d', { name: 'Give the free plan two days' }), notifyCrm),
+                },
+            ],
+        })
+    ),
+    exit: { reason: 'Onboarding nudge finished' },
+})
+
+const env = { CRM_TOKEN: 'shhh' }
+
+/** Runs `emit` expecting a refusal, and returns the four fields it carries. */
+function refusal(run: () => unknown): WorkflowErrorFields {
+    try {
+        run()
+    } catch (error) {
+        assert.ok(error instanceof WorkflowError, `expected a WorkflowError, got ${String(error)}`)
+        return error.fields
+    }
+    throw new Error('expected a WorkflowError, but nothing was thrown')
+}
+
+function webhookAction(id: string): Action {
+    return {
+        id,
+        name: 'Tell the CRM to follow up',
+        type: 'function',
+        config: {
+            template_id: 'template-webhook',
+            inputs: {
+                url: { value: 'https://example.com/hooks/onboarding' },
+                method: { value: 'POST' },
+                body: { value: { distinct_id: '{event.distinct_id}' } },
+                signing_secret: { value: 'shhh' },
+            },
+        },
+    }
+}
+
+describe('@posthog/workflows', () => {
+    test('emits the workflow definition the API accepts', () => {
+        const { definition } = onboarding.emit({ env })
+
+        assert.deepStrictEqual(definition, {
+            key: 'onboarding-nudge',
+            name: 'Onboarding nudge',
+            description: '',
+            status: 'draft',
+            exit_condition: 'exit_only_at_end',
+            variables: [],
+            actions: [
+                {
+                    id: 'trigger_node',
+                    name: 'Trigger',
+                    type: 'trigger',
+                    config: {
+                        type: 'event',
+                        filters: {
+                            events: [
+                                {
+                                    id: 'user signed up',
+                                    name: 'user signed up',
+                                    type: 'events',
+                                    order: 0,
+                                    properties: [],
+                                },
+                            ],
+                            properties: [],
+                            filter_test_accounts: false,
+                        },
+                    },
+                },
+                { id: 'wait_a_day', name: 'Wait a day', type: 'delay', config: { delay_duration: '1d' } },
+                {
+                    id: 'which_plan',
+                    name: 'Which plan?',
+                    type: 'conditional_branch',
+                    config: {
+                        conditions: [
+                            {
+                                name: 'Paid plan',
+                                filters: { properties: [person('plan', 'exact', ['pro'])] },
+                            },
+                            {
+                                name: 'Free plan',
+                                filters: { properties: [person('plan', 'exact', ['free'])] },
+                            },
+                        ],
+                    },
+                },
+                {
+                    id: 'welcome_the_paid_customer',
+                    name: 'Welcome the paid customer',
+                    type: 'function_email',
+                    config: {
+                        template_id: 'template-email',
+                        inputs: {
+                            email: {
+                                value: {
+                                    from: {},
+                                    to: { email: '{person.properties.email}' },
+                                    subject: 'Welcome aboard',
+                                    text: 'Thanks for upgrading.',
+                                    html: '<p>Thanks for upgrading.</p>',
+                                },
+                            },
+                        },
+                    },
+                },
+                webhookAction('tell_the_crm_to_follow_up'),
+                {
+                    id: 'give_the_free_plan_two_days',
+                    name: 'Give the free plan two days',
+                    type: 'delay',
+                    config: { delay_duration: '2d' },
+                },
+                webhookAction('tell_the_crm_to_follow_up_2'),
+                { id: 'exit_node', name: 'Exit', type: 'exit', config: { reason: 'Onboarding nudge finished' } },
+            ],
+            edges: [
+                { from: 'trigger_node', to: 'wait_a_day', type: 'continue' },
+                { from: 'wait_a_day', to: 'which_plan', type: 'continue' },
+                { from: 'which_plan', to: 'exit_node', type: 'continue' },
+                { from: 'welcome_the_paid_customer', to: 'tell_the_crm_to_follow_up', type: 'continue' },
+                { from: 'tell_the_crm_to_follow_up', to: 'exit_node', type: 'continue' },
+                { from: 'which_plan', to: 'welcome_the_paid_customer', type: 'branch', index: 0 },
+                { from: 'give_the_free_plan_two_days', to: 'tell_the_crm_to_follow_up_2', type: 'continue' },
+                { from: 'tell_the_crm_to_follow_up_2', to: 'exit_node', type: 'continue' },
+                { from: 'which_plan', to: 'give_the_free_plan_two_days', type: 'branch', index: 1 },
+            ],
+        })
+    })
+
+    test('emits the same definition every time, and the definition survives JSON', () => {
+        const first = onboarding.emit({ env }).definition
+        const second = onboarding.emit({ env }).definition
+
+        assert.strictEqual(JSON.stringify(second), JSON.stringify(first))
+        assert.deepStrictEqual(JSON.parse(JSON.stringify(first)), first)
+    })
+
+    test('makes one node per placement, so a reused step is not one shared node', () => {
+        const { definition } = onboarding.emit({ env })
+        const placements = definition.actions.filter((action) => action.name === 'Tell the CRM to follow up')
+
+        assert.deepStrictEqual(
+            placements.map((action) => action.id),
+            ['tell_the_crm_to_follow_up', 'tell_the_crm_to_follow_up_2']
+        )
+    })
+
+    test('sends the resolved secret at every placement and never the variable name', () => {
+        const { definition, secretInputs } = onboarding.emit({ env })
+
+        assert.ok(!JSON.stringify(definition).includes('CRM_TOKEN'))
+        assert.deepStrictEqual(secretInputs, [
+            { actionId: 'tell_the_crm_to_follow_up', inputKey: 'signing_secret', envName: 'CRM_TOKEN' },
+            { actionId: 'tell_the_crm_to_follow_up_2', inputKey: 'signing_secret', envName: 'CRM_TOKEN' },
+        ])
+    })
+
+    for (const [label, broken] of [
+        ['unset', {}],
+        ['set to an empty string', { CRM_TOKEN: '' }],
+    ] as const) {
+        test(`refuses to emit when the secret variable is ${label}`, () => {
+            assert.deepStrictEqual(
+                refusal(() => onboarding.emit({ env: broken })),
+                {
+                    status: 'missing_secret',
+                    message: 'The environment variable CRM_TOKEN is not set.',
+                    why: 'Step "Tell the CRM to follow up" names CRM_TOKEN for the secret input "signing_secret". A secret is always sent rather than read back from PostHog, so there is nothing to send.',
+                    fix: 'Set CRM_TOKEN in the environment that runs the push, then push again.',
+                }
+            )
+        })
+    }
+
+    test('refuses a secret nested inside an input, which would send the variable name', () => {
+        const nested = workflow({
+            key: 'nested-secret',
+            name: 'Nested secret',
+            on: onSchedule(),
+            steps: path(
+                fn({
+                    name: 'Call the API',
+                    templateId: 'template-webhook',
+                    inputs: { headers: { Authorization: secret('CRM_TOKEN') } },
+                })
+            ),
+            exit: { reason: 'Done' },
+        })
+
+        assert.strictEqual(refusal(() => nested.emit({ env })).status, 'nested_secret')
+    })
+
+    test('refuses two steps whose names produce the same action id', () => {
+        const collide = workflow({
+            key: 'collide',
+            name: 'Collide',
+            on: onSchedule(),
+            steps: path(delay('1d', { name: 'Wait!' }), delay('2d', { name: 'Wait' })),
+            exit: { reason: 'Done' },
+        })
+
+        assert.deepStrictEqual(
+            refusal(() => collide.emit({ env })),
+            {
+                status: 'duplicate_action_id',
+                message: 'Two steps produce the action id "wait".',
+                why: 'An action id is the slug of the step name, and the steps "Wait!" and "Wait" slug to the same id. PostHog keys a workflow\'s in-flight participants and its secrets on the action id, so two steps cannot share one.',
+                fix: 'Rename one of the steps, or give one an explicit id.',
+            }
+        )
+    })
+
+    for (const [label, name, taken] of [
+        ['the trigger', 'Trigger node', 'trigger_node'],
+        ['the exit', 'Exit node', 'exit_node'],
+    ] as const) {
+        test(`refuses a step name that takes the id of ${label}`, () => {
+            const collide = workflow({
+                key: 'collide',
+                name: 'Collide',
+                on: onSchedule(),
+                steps: path(delay('1d', { name })),
+                exit: { reason: 'Done' },
+            })
+
+            const fields = refusal(() => collide.emit({ env }))
+            assert.strictEqual(fields.status, 'reserved_action_id')
+            assert.ok(fields.message.includes(taken), fields.message)
+        })
+    }
+
+    test('pins an action id to the explicit id, so a rename keeps the old id', () => {
+        const renamed = workflow({
+            key: 'renamed',
+            name: 'Renamed',
+            on: onSchedule(),
+            steps: path(delay('1d', { name: 'Wait a whole day', id: 'wait_a_day' })),
+            exit: { reason: 'Done' },
+        })
+
+        assert.deepStrictEqual(renamed.emit({ env }).definition.actions[1], {
+            id: 'wait_a_day',
+            name: 'Wait a whole day',
+            type: 'delay',
+            config: { delay_duration: '1d' },
+        })
+    })
+
+    for (const [label, duration] of [
+        ['a negative duration', '-1d'],
+        ['an exponential duration', '1e3d'],
+        ['a duration that is not finite', 'Infinityd'],
+        ['a duration without a unit', '30'],
+    ] as const) {
+        test(`refuses ${label} that the type lets through`, () => {
+            const bad = workflow({
+                key: 'bad-duration',
+                name: 'Bad duration',
+                on: onSchedule(),
+                steps: path(delay(duration as Duration, { name: 'Wait' })),
+                exit: { reason: 'Done' },
+            })
+
+            assert.strictEqual(refusal(() => bad.emit({ env })).status, 'invalid_duration')
+        })
+    }
+
+    for (const [label, variables, status] of [
+        [
+            'duplicate keys',
+            [
+                { key: 'plan', type: 'string', default: 'free' },
+                { key: 'plan', type: 'string', default: 'pro' },
+            ],
+            'duplicate_variable_key',
+        ],
+        [
+            'more than 5120 bytes in total',
+            [{ key: 'blob', type: 'string', default: 'x'.repeat(5200) }],
+            'variables_too_large',
+        ],
+    ] as const) {
+        test(`refuses variables with ${label}`, () => {
+            const bad = workflow({
+                key: 'bad-variables',
+                name: 'Bad variables',
+                on: onSchedule(),
+                variables: variables as readonly WorkflowVariable[],
+                steps: path(delay('1d', { name: 'Wait' })),
+                exit: { reason: 'Done' },
+            })
+
+            assert.strictEqual(refusal(() => bad.emit({ env })).status, status)
+        })
+    }
+
+    test('defaults the status to draft, so a first push sends nothing to a real person', () => {
+        const flow = workflow({
+            key: 'status',
+            name: 'Status',
+            on: onSchedule(),
+            steps: path(delay('1d', { name: 'Wait' })),
+            exit: { reason: 'Done' },
+        })
+
+        assert.strictEqual(flow.emit({ env }).definition.status, 'draft')
+    })
+
+    test('carries the status and the variables the file declares', () => {
+        const flow = workflow({
+            key: 'with-variables',
+            name: 'With variables',
+            status: 'active',
+            on: onSchedule(),
+            variables: [{ key: 'plan', type: 'string', default: 'free' }],
+            steps: path(delay('1d', { name: 'Wait' })),
+            exit: { reason: 'Done' },
+        })
+
+        const { definition } = flow.emit({ env })
+        assert.strictEqual(definition.status, 'active')
+        assert.deepStrictEqual(definition.variables, [{ key: 'plan', type: 'string', default: 'free' }])
+    })
+
+    test('wraps every escape-hatch input value, so hog templating resolves', () => {
+        const flow = workflow({
+            key: 'escape-hatch',
+            name: 'Escape hatch',
+            on: onSchedule(),
+            steps: path(
+                fn({
+                    name: 'Post to Slack',
+                    templateId: 'template-slack',
+                    inputs: { text: 'Hello {person.properties.email}', blocks: [] },
+                })
+            ),
+            exit: { reason: 'Done' },
+        })
+
+        assert.deepStrictEqual(flow.emit({ env }).definition.actions[1], {
+            id: 'post_to_slack',
+            name: 'Post to Slack',
+            type: 'function',
+            config: {
+                template_id: 'template-slack',
+                inputs: { text: { value: 'Hello {person.properties.email}' }, blocks: { value: [] } },
+            },
+        })
+    })
+})
diff --git a/products/workflows/packages/workflows/tests/types.test-d.ts b/products/workflows/packages/workflows/tests/types.test-d.ts
new file mode 100644
index 00000000000..083f035c030
--- /dev/null
+++ b/products/workflows/packages/workflows/tests/types.test-d.ts
@@ -0,0 +1,57 @@
+// `tsc` fails this file when an `@ts-expect-error` line stops being an error, so a
+// type rule that relaxes breaks the build.
+
+import { branch, delay, email, onSchedule, path, person, workflow } from '../src/index.js'
+
+const wait = delay('1d', { name: 'Wait a day' })
+const onPaidPlan = [person('plan', 'exact', ['pro'])] as const
+
+// A duration is a number plus a unit, including where the value reaches the call through a const.
+const soon = 'soon'
+// @ts-expect-error - 'soon' is not a duration
+delay(soon, { name: 'Wait' })
+
+// A sub-path is a non-empty tuple, so an empty branch cannot compile.
+branch({
+    name: 'Which plan?',
+    branches: [
+        {
+            name: 'Paid plan',
+            when: onPaidPlan,
+            // @ts-expect-error - an empty branch path emits a branch edge aimed at the no-match target
+            then: [],
+        },
+    ],
+})
+
+// A branch needs at least one branch.
+branch({
+    name: 'Which plan?',
+    // @ts-expect-error - a branch with no branches is a conditional that decides nothing
+    branches: [],
+})
+
+// A path needs at least one step.
+// @ts-expect-error - an empty workflow has no first action for the trigger to point at
+path()
+
+// Email content is inline. A library template is materialized on write, so the stored
+// definition would never match the one we sent.
+email({
+    name: 'Welcome',
+    to: 'someone@example.com',
+    subject: 'Welcome',
+    text: 'Hello',
+    html: '<p>Hello</p>',
+    // @ts-expect-error - the SDK has no `templateUuid`
+    templateUuid: '0199d0c0-0000-7000-8000-000000000000',
+})
+
+// The workflow carries its own identity.
+// @ts-expect-error - `key` is how push finds the workflow again, so it is required
+workflow({
+    name: 'No key',
+    on: onSchedule(),
+    steps: path(wait),
+    exit: { reason: 'Done' },
+})
diff --git a/products/workflows/packages/workflows/tsconfig.base.json b/products/workflows/packages/workflows/tsconfig.base.json
new file mode 100644
index 00000000000..1b0b6b98eea
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.base.json
@@ -0,0 +1,17 @@
+{
+    "compilerOptions": {
+        "target": "ES2022",
+        "lib": ["ES2022"],
+        "types": ["node"],
+        "module": "NodeNext",
+        "moduleResolution": "NodeNext",
+        "strict": true,
+        "noUncheckedIndexedAccess": true,
+        "exactOptionalPropertyTypes": true,
+        "isolatedModules": true,
+        "skipLibCheck": true,
+        "declaration": true,
+        "declarationMap": true,
+        "sourceMap": true
+    }
+}
diff --git a/products/workflows/packages/workflows/tsconfig.build.json b/products/workflows/packages/workflows/tsconfig.build.json
new file mode 100644
index 00000000000..db3934746ae
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.build.json
@@ -0,0 +1,8 @@
+{
+    "extends": "./tsconfig.base.json",
+    "compilerOptions": {
+        "outDir": "dist",
+        "rootDir": "src"
+    },
+    "include": ["src"]
+}
diff --git a/products/workflows/packages/workflows/tsconfig.json b/products/workflows/packages/workflows/tsconfig.json
new file mode 100644
index 00000000000..e087af01d9f
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.json
@@ -0,0 +1,7 @@
+{
+    "extends": "./tsconfig.base.json",
+    "compilerOptions": {
+        "noEmit": true
+    },
+    "include": ["src", "tests"]
+}
diff --git a/products/workflows/packages/workflows/tsconfig.test.json b/products/workflows/packages/workflows/tsconfig.test.json
new file mode 100644
index 00000000000..ef41bbe8667
--- /dev/null
+++ b/products/workflows/packages/workflows/tsconfig.test.json
@@ -0,0 +1,8 @@
+{
+    "extends": "./tsconfig.base.json",
+    "compilerOptions": {
+        "outDir": ".test-build",
+        "rootDir": "."
+    },
+    "include": ["src", "tests"]
+}

```

## How to score

Score every diff (X, Y, Z, W, V) from 1 (poor) to 10 (excellent) on each dimension, and justify every score in one to three sentences that cite files or imports from the diff:

- `seams`: Seams and interfaces: does the change cross module boundaries through deliberate, narrow interfaces?
- `cohesion`: Cohesion and module placement: does each new piece of code live in the module that owns its concern?
- `coupling`: Coupling: does the change avoid new dependencies, and reaching into other modules' internals?
- `fit`: Repository architecture fit: does the change follow PostHog's documented product architecture (products/architecture.md)?
- `overall`: Overall architecture quality of the change, as a reviewer who owns this codebase would rate it.

Judge architecture, not completeness of features or test coverage. A diff that is truncated here was truncated for length; judge what you can see and its file list. Answer with JSON only, matching the schema you were given.