You are reviewing the architecture of independent implementations of the same task in the PostHog monorepo. Each implementation is a diff against the repository as it was before the change. You do not know who or what wrote them; judge only the diffs. Everything you need is in this prompt: do not run commands or read files.

## Task

Part of #68. Specified by #79 ([spec](https://github.com/Silthus/posthog/issues/79#issuecomment-5760343402)), locked by #72 ([resolution](https://github.com/Silthus/posthog/issues/72#issuecomment-5755808227)).

## What to build

A workflow carries a client-chosen `key`, unique for each team, which is how `push` finds the workflow it owns. `HogFlow` gains a nullable `key` with a unique constraint for each team, and a `validate_key` that follows the feature flag precedent: the charset check, the scoped pre-check, and the constraint violation re-raised as the same field error. `key` is writable on create and refused on update, because a PATCH that changes a key would be adoption by the back door. `key` joins the list filter, which is the whole resolve path. The `managed_by` list filter moves to the UI ticket (#94), because provenance itself (#76) is on hold. The UUID primary key does not change, and no key-based addressing reaches the detail route or MCP.

## Write scope

- `products/workflows/backend/models/hog_flow/hog_flow.py`
- `products/workflows/backend/api/hog_flow.py`
- `products/workflows/backend/migrations/0028_*` and `max_migration.txt`
- `products/workflows/backend/api/test/test_hog_flow.py` and one new test module
- `products/workflows/frontend/generated/**` (regenerated, never hand-edited)
- `services/mcp/src/api/generated.ts`

## Proof gate

- [ ] A create with a key echoes the key back
- [ ] A key that breaks the charset is a 400 with `code="invalid_key"`
- [ ] A key already taken in the team is a 400 with `code="unique"`, from the pre-check and from the database race
- [ ] A PATCH that changes a key is refused
- [ ] `?key=` resolves exactly one row, scoped to the team
- [ ] The unique index is built concurrently
- [ ] `hogli build:openapi` output is in the diff

## Blocked by

Nothing. Re-planned on 2026-09-21 after reviewer feedback on the read-only PR: the client side ships and is proven first, and this key column is the one backend change the CLI needs to find a workflow it owns. It no longer waits for the revisions ticket and does not stack on the read-only branch.

## Stack base and ship target

- Branch cut from `upstream/master`. Migration number: the next free one on `upstream/master` (`0026` if the read-only PR has not merged), and say so in the PR.
- A draft PR against upstream `PostHog/posthog`, opened with `--head Silthus:<branch>`. It stays a draft until Michael has tested the CLI against it and says so. Nothing merges into the fork's `master`.
- Invoke `/improving-drf-endpoints`, `/django-migrations`, `/writing-tests`, `/reviewing-with-coderabbit` and `/writing-pr-descriptions`.


Context that changed today: a PostHog reviewer pushed back on the read-only PR, and Michael reordered the map: the client side ships first, and this `key` column is the one backend change the CLI needs. The read-only PR (#76) is on hold. Your branch is cut from `upstream/master`, not stacked on anything. The PR stays a draft until Michael tests the CLI against it.

## Scope, exactly
Nullable `key` CharField(max_length=400) on `HogFlow` with `UniqueConstraint(fields=["team","key"], name="unique_key_for_team")`, migration adding the column and building the unique index concurrently (see `EventDefinition`'s `UniqueConstraintByExpression(concurrently=True, ...)` precedent, and `/django-migrations`). `"key"` in `HogFlowFilterSet.Meta.fields` and in `HogFlowSerializer.Meta.fields`, writable on create, refused on update with a clear field error, `validate_key` copying the feature flag precedent (`feature_flag.py` `validate_key`: charset `^[a-zA-Z0-9_-]+$` with `code="invalid_key"`, scoped `.exists()` pre-check with `code="unique"`, IntegrityError re-raised as the same field error). `help_text` on the field. Regenerate types with `hogli build:openapi` and include `products/workflows/frontend/generated/**` and `services/mcp/src/api/generated.ts` in the diff. Not in scope: `managed_by` filter, key-based addressing on the detail route or MCP, anything UI. Minimal diff, no overengineering, one-line comments.

- Red then green (`/tdd`): the ticket's proof gate cases as tests in a new module beside `test_hog_flow_code_managed.py` or in `test_hog_flow.py` where the fixtures already exist; parameterize the refusals. Show the failing run before and the passing run after, pasted on the ticket.

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
- products/workflows/backend/api/hog_flow.py (modified, +40 -3)
- products/workflows/backend/api/test/test_hog_flow.py (modified, +84 -0)
- products/workflows/backend/migrations/0026_hogflow_key.py (added, +43 -0)
- products/workflows/backend/migrations/max_migration.txt (modified, +1 -1)
- products/workflows/backend/models/hog_flow/hog_flow.py (modified, +9 -0)
- products/workflows/frontend/generated/api.schemas.ts (modified, +20 -0)
- products/workflows/frontend/generated/api.zod.ts (modified, +27 -0)
- services/mcp/src/api/generated.ts (modified, +20 -0)

```diff
diff --git a/products/workflows/backend/api/hog_flow.py b/products/workflows/backend/api/hog_flow.py
index bc7c11c3fbf..1b4bc4848e3 100644
--- a/products/workflows/backend/api/hog_flow.py
+++ b/products/workflows/backend/api/hog_flow.py
@@ -13,7 +13,7 @@ from django.conf import settings
 from django.core.cache import cache
 from django.core.exceptions import ValidationError as DjangoValidationError
 from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
-from django.db import models, transaction
+from django.db import IntegrityError, models, transaction
 from django.db.models import Q, QuerySet
 from django.db.models.expressions import RawSQL
 from django.http import Http404, HttpResponse
@@ -3097,6 +3097,7 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
             "id",
             "name",
             "description",
+            "key",
             "version",
             "status",
             "origin_product",
@@ -3304,6 +3305,22 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
             return
         validated_data["encrypted_inputs"] = strip_secrets_from_content(validated_data, template_cache={})
 
+    def validate_key(self, value: Optional[str]) -> Optional[str]:
+        if value is None:
+            return value
+        if not re.match(r"^[a-zA-Z0-9_-]+$", value):
+            raise serializers.ValidationError(
+                "Only letters, numbers, hyphens (-) & underscores (_) are allowed.", code="invalid_key"
+            )
+        # A test run nests this serializer with the saved workflow in context, and its own key isn't a clash.
+        instance = self.instance or self.context.get("instance")
+        taken = HogFlow.objects.filter(team_id=self.context["team_id"], key=value)
+        if instance is not None:
+            taken = taken.exclude(pk=instance.pk)
+        if taken.exists():
+            raise serializers.ValidationError("There is already a workflow with this key.", code="unique")
+        return value
+
     def create(self, validated_data: dict, *args, **kwargs) -> HogFlow:
         request = self.context["request"]
         team_id = self.context["team_id"]
@@ -3311,7 +3328,16 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
         validated_data["team_id"] = team_id
         self._strip_secret_inputs(validated_data)
 
-        return super().create(validated_data=validated_data)
+        try:
+            with transaction.atomic():
+                return super().create(validated_data=validated_data)
+        except IntegrityError as e:
+            # A concurrent create can take the key between validate_key and the write.
+            if "unique_key_for_team" in str(e):
+                raise serializers.ValidationError(
+                    {"key": [exceptions.ErrorDetail("There is already a workflow with this key.", code="unique")]}
+                ) from e
+            raise
 
     def update(self, instance, validated_data):
         self._strip_secret_inputs(validated_data)
@@ -3325,6 +3351,11 @@ class HogFlowUpdateSerializer(HogFlowSerializer):
         allow_null=True,
         help_text="Product surface that owns this workflow. This value cannot change after creation.",
     )
+    key = serializers.CharField(
+        read_only=True,
+        allow_null=True,
+        help_text="Client-chosen identifier for this workflow. This value cannot change after creation.",
+    )
 
     def validate(self, data: dict) -> dict:
         instance = cast(Optional[HogFlow], self.instance)
@@ -3335,6 +3366,10 @@ class HogFlowUpdateSerializer(HogFlowSerializer):
             and submitted_origin_product != instance.origin_product
         ):
             raise serializers.ValidationError({"origin_product": "origin_product is set on create and cannot change."})
+        # Changing a key would adopt another client's workflow, so the key is fixed at create.
+        submitted_key = self.initial_data.get("key", serializers.empty)
+        if instance is not None and submitted_key is not serializers.empty and submitted_key != instance.key:
+            raise serializers.ValidationError({"key": "key is set on create and cannot change."})
         return super().validate(data)
 
 
@@ -3747,11 +3782,13 @@ class CommaSeparatedListFilter(BaseInFilter, CharFilter):
 
 
 class HogFlowFilterSet(FilterSet):
+    key = CharFilter(help_text="Return the workflow with this exact key, if the team has one.")
+
     class Meta:
         model = HogFlow
         # `created_by` is filtered by uuid in safely_get_queryset (the list UI's member picker keys on
         # uuid, not pk), so it's deliberately not an exact-match field here.
-        fields = ["id", "created_at", "updated_at", "status"]
+        fields = ["id", "key", "created_at", "updated_at", "status"]
 
 
 class HogFlowPagination(LimitOffsetPagination):
diff --git a/products/workflows/backend/api/test/test_hog_flow.py b/products/workflows/backend/api/test/test_hog_flow.py
index 273339df41e..801277932cd 100644
--- a/products/workflows/backend/api/test/test_hog_flow.py
+++ b/products/workflows/backend/api/test/test_hog_flow.py
@@ -34,6 +34,7 @@ from products.cohorts.backend.models.cohort import Cohort
 from products.skills.backend.models.skills import LLMSkill
 from products.workflows.backend.api.hog_flow import (
     HogFlowActionSerializer,
+    HogFlowSerializer,
     _should_validate_strictly,
     mint_audience_confirm_token,
 )
@@ -459,6 +460,89 @@ class TestHogFlowAPI(APIBaseTest):
         assert response.status_code == 200, response.json()
         assert response.json()["origin_product"] == "loops"
 
+    def _create_payload_with_key(self, key: Any) -> dict:
+        hog_flow, _ = self._create_hog_flow_with_action(
+            {"template_id": "template-webhook", "inputs": {"url": {"value": "https://example.com"}}}
+        )
+        return {**hog_flow, "key": key}
+
+    def test_key_is_set_on_create_scoped_to_team(self):
+        other_team = Team.objects.create(organization=self.organization, name="Other")
+        HogFlow.objects.create(team=other_team, key="onboarding-v2")
+
+        response = self.client.post(
+            f"/api/projects/{self.team.id}/hog_flows", self._create_payload_with_key("onboarding-v2")
+        )
+        assert response.status_code == 201, response.json()
+        assert response.json()["key"] == "onboarding-v2"
+
+    @parameterized.expand(
+        [
+            ("space", "has space", "invalid_key"),
+            ("slash", "a/b", "invalid_key"),
+            ("taken", "taken-key", "unique"),
+        ]
+    )
+    def test_create_rejects_key(self, _name: str, key: str, code: str):
+        HogFlow.objects.create(team=self.team, key="taken-key")
+
+        response = self.client.post(f"/api/projects/{self.team.id}/hog_flows", self._create_payload_with_key(key))
+        assert response.status_code == 400, response.json()
+        assert (response.json()["attr"], response.json()["code"]) == ("key", code)
+
+    def test_create_key_race_on_constraint_is_the_same_field_error(self):
+        HogFlow.objects.create(team=self.team, key="taken-key")
+        # Skip the pre-check so the write reaches the database constraint, as a concurrent create would.
+        with patch.object(HogFlowSerializer, "validate_key", lambda self, value: value):
+            response = self.client.post(
+                f"/api/projects/{self.team.id}/hog_flows", self._create_payload_with_key("taken-key")
+            )
+        assert response.status_code == 400, response.json()
+        assert (response.json()["attr"], response.json()["code"]) == ("key", "unique")
+        assert HogFlow.objects.filter(team=self.team, key="taken-key").count() == 1
+
+    @parameterized.expand([("changed", "other-key"), ("cleared", None)])
+    def test_patch_refuses_key_change(self, _name: str, new_key: Optional[str]):
+        flow = HogFlow.objects.create(team=self.team, name="Owned", key="owned-key")
+
+        response = self.client.patch(f"/api/projects/{self.team.id}/hog_flows/{flow.id}", {"key": new_key})
+        assert response.status_code == 400, response.json()
+        assert response.json()["attr"] == "key"
+        flow.refresh_from_db()
+        assert flow.key == "owned-key"
+
+    def test_patch_accepts_unchanged_key(self):
+        flow = HogFlow.objects.create(team=self.team, name="Owned", key="owned-key")
+
+        response = self.client.patch(
+            f"/api/projects/{self.team.id}/hog_flows/{flow.id}", {"key": "owned-key", "name": "Renamed"}
+        )
+        assert response.status_code == 200, response.json()
+        assert response.json()["key"] == "owned-key"
+
+    def test_test_invocation_accepts_the_workflows_own_key_in_configuration(self):
+        create = self.client.post(f"/api/projects/{self.team.id}/hog_flows", self._create_payload_with_key("owned-key"))
+        assert create.status_code == 201, create.json()
+
+        with patch("products.workflows.backend.api.hog_flow.create_hog_flow_invocation_test") as mock_invoke:
+            mock_invoke.return_value = MagicMock(status_code=200, json=lambda: {"status": "success"})
+            response = self.client.post(
+                f"/api/projects/{self.team.id}/hog_flows/{create.json()['id']}/invocations/",
+                data={"configuration": create.json(), "globals": {"event": {"event": "$pageview"}}},
+                format="json",
+            )
+        assert response.status_code == status.HTTP_200_OK, response.json()
+
+    def test_list_filter_by_key_resolves_one_row_in_team(self):
+        other_team = Team.objects.create(organization=self.organization, name="Other")
+        HogFlow.objects.create(team=other_team, name="Theirs", key="onboarding")
+        mine = HogFlow.objects.create(team=self.team, name="Mine", key="onboarding")
+        HogFlow.objects.create(team=self.team, name="Unkeyed")
+
+        response = self.client.get(f"/api/projects/{self.team.id}/hog_flows?key=onboarding")
+        assert response.status_code == 200, response.json()
+        assert [flow["id"] for flow in response.json()["results"]] == [str(mine.id)]
+
     def test_mcp_list_is_metadata_only_and_hides_action_secrets(self):
         # A webhook action whose headers carry a bearer token — the kind of credential-like value
         # that must not leak from a workflow *listing*.
diff --git a/products/workflows/backend/migrations/0026_hogflow_key.py b/products/workflows/backend/migrations/0026_hogflow_key.py
new file mode 100644
index 00000000000..6a46fa2e875
--- /dev/null
+++ b/products/workflows/backend/migrations/0026_hogflow_key.py
@@ -0,0 +1,43 @@
+from django.db import migrations, models
+
+from posthog.migration_helpers import CreateIndexConcurrently
+
+
+class Migration(migrations.Migration):
+    # Required for CREATE INDEX CONCURRENTLY.
+    atomic = False
+
+    dependencies = [
+        ("workflows", "0025_hogflow_email_sending_paused_by"),
+    ]
+
+    operations = [
+        migrations.AddField(
+            model_name="hogflow",
+            name="key",
+            field=models.CharField(
+                blank=True,
+                help_text="Client-chosen identifier for this workflow, unique per team. Letters, numbers, hyphens (-) and "
+                "underscores (_) only. Set on create; it cannot change afterwards. Filter the list with `?key=`.",
+                max_length=400,
+                null=True,
+            ),
+        ),
+        # posthog_hogflow is populated, so build the unique index concurrently under the constraint's name.
+        migrations.SeparateDatabaseAndState(
+            state_operations=[
+                migrations.AddConstraint(
+                    model_name="hogflow",
+                    constraint=models.UniqueConstraint(fields=("team", "key"), name="unique_key_for_team"),
+                ),
+            ],
+            database_operations=[
+                CreateIndexConcurrently(
+                    index_name="unique_key_for_team",
+                    table_name="posthog_hogflow",
+                    columns="(team_id, key)",
+                    unique=True,
+                ),
+            ],
+        ),
+    ]
diff --git a/products/workflows/backend/migrations/max_migration.txt b/products/workflows/backend/migrations/max_migration.txt
index 4aa215fa754..bca6f52294d 100644
--- a/products/workflows/backend/migrations/max_migration.txt
+++ b/products/workflows/backend/migrations/max_migration.txt
@@ -1 +1 @@
-0025_hogflow_email_sending_paused_by
+0026_hogflow_key
diff --git a/products/workflows/backend/models/hog_flow/hog_flow.py b/products/workflows/backend/models/hog_flow/hog_flow.py
index 9c47602a2d4..8dc10d8ed3a 100644
--- a/products/workflows/backend/models/hog_flow/hog_flow.py
+++ b/products/workflows/backend/models/hog_flow/hog_flow.py
@@ -121,6 +121,7 @@ class HogFlow(UUIDTModel):
 
         constraints = [
             models.UniqueConstraint(fields=["team", "version", "id"], name="unique_version_per_flow"),
+            models.UniqueConstraint(fields=["team", "key"], name="unique_key_for_team"),
         ]
 
     class State(models.TextChoices):
@@ -139,6 +140,14 @@ class HogFlow(UUIDTModel):
 
     name = models.CharField(max_length=400, null=True, blank=True)
     description = models.TextField(blank=True, default="")
+    # Client-chosen handle so a client (e.g. the CLI's push) can find the workflow it owns.
+    key = models.CharField(
+        max_length=400,
+        null=True,
+        blank=True,
+        help_text="Client-chosen identifier for this workflow, unique per team. Letters, numbers, hyphens (-) and "
+        "underscores (_) only. Set on create; it cannot change afterwards. Filter the list with `?key=`.",
+    )
     version = models.IntegerField(default=1)
     team = models.ForeignKey("posthog.Team", on_delete=models.CASCADE)
     status = models.CharField(max_length=20, choices=State, default=State.DRAFT)
diff --git a/products/workflows/frontend/generated/api.schemas.ts b/products/workflows/frontend/generated/api.schemas.ts
index 9161204324f..dba9fc83738 100644
--- a/products/workflows/frontend/generated/api.schemas.ts
+++ b/products/workflows/frontend/generated/api.schemas.ts
@@ -586,6 +586,12 @@ export interface HogFlowApi {
     name?: string | null
     /** Optional description. */
     description?: string
+    /**
+     * Client-chosen identifier for this workflow, unique per team. Letters, numbers, hyphens (-) and underscores (_) only. Set on create; it cannot change afterwards. Filter the list with `?key=`.
+     * @maxLength 400
+     * @nullable
+     */
+    key?: string | null
     readonly version: number
     /** draft (no execution), active (live), archived (disabled).
      *
@@ -684,6 +690,11 @@ export interface HogFlowUpdateApi {
     name?: string | null
     /** Optional description. */
     description?: string
+    /**
+     * Client-chosen identifier for this workflow. This value cannot change after creation.
+     * @nullable
+     */
+    readonly key: string | null
     readonly version: number
     /** draft (no execution), active (live), archived (disabled).
      *
@@ -782,6 +793,11 @@ export interface PatchedHogFlowUpdateApi {
     name?: string | null
     /** Optional description. */
     description?: string
+    /**
+     * Client-chosen identifier for this workflow. This value cannot change after creation.
+     * @nullable
+     */
+    readonly key?: string | null
     readonly version?: number
     /** draft (no execution), active (live), archived (disabled).
      *
@@ -1781,6 +1797,10 @@ export type HogFlowsListParams = {
      */
     created_by?: string
     id?: string
+    /**
+     * Return the workflow with this exact key, if the team has one.
+     */
+    key?: string
     /**
      * Number of results to return per page.
      */
diff --git a/products/workflows/frontend/generated/api.zod.ts b/products/workflows/frontend/generated/api.zod.ts
index 00bfdd83373..74aeb84374f 100644
--- a/products/workflows/frontend/generated/api.zod.ts
+++ b/products/workflows/frontend/generated/api.zod.ts
@@ -403,6 +403,8 @@ export const HogFlowTemplatesPartialUpdateBody = /* @__PURE__ */ zod
 export const hogFlowsCreateBodyNameMax = 400
 
 export const hogFlowsCreateBodyDescriptionDefault = ``
+export const hogFlowsCreateBodyKeyMax = 400
+
 export const hogFlowsCreateBodyTriggerMaskingOneTtlMin = 60
 export const hogFlowsCreateBodyTriggerMaskingOneTtlMax = 94608000
 
@@ -425,6 +427,13 @@ export const HogFlowsCreateBody = /* @__PURE__ */ zod
     .object({
         name: zod.string().max(hogFlowsCreateBodyNameMax).nullish().describe('Workflow name.'),
         description: zod.string().default(hogFlowsCreateBodyDescriptionDefault).describe('Optional description.'),
+        key: zod
+            .string()
+            .max(hogFlowsCreateBodyKeyMax)
+            .nullish()
+            .describe(
+                'Client-chosen identifier for this workflow, unique per team. Letters, numbers, hyphens (-) and underscores (_) only. Set on create; it cannot change afterwards. Filter the list with `?key=`.'
+            ),
         status: zod
             .enum(['draft', 'active', 'archived'])
             .describe('\* `draft` - Draft\n\* `active` - Active\n\* `archived` - Archived')
@@ -1790,6 +1799,8 @@ export const HogFlowsGraphPartialUpdateBody = /* @__PURE__ */ zod.object({
 export const hogFlowsInvocationsCreateBodyConfigurationOneNameMax = 400
 
 export const hogFlowsInvocationsCreateBodyConfigurationOneDescriptionDefault = ``
+export const hogFlowsInvocationsCreateBodyConfigurationOneKeyMax = 400
+
 export const hogFlowsInvocationsCreateBodyConfigurationOneCreatedByOneDistinctIdMax = 200
 
 export const hogFlowsInvocationsCreateBodyConfigurationOneCreatedByOneFirstNameMax = 150
@@ -1835,6 +1846,13 @@ export const HogFlowsInvocationsCreateBody = /* @__PURE__ */ zod.object({
                 .string()
                 .default(hogFlowsInvocationsCreateBodyConfigurationOneDescriptionDefault)
                 .describe('Optional description.'),
+            key: zod
+                .string()
+                .max(hogFlowsInvocationsCreateBodyConfigurationOneKeyMax)
+                .nullish()
+                .describe(
+                    'Client-chosen identifier for this workflow, unique per team. Letters, numbers, hyphens (-) and underscores (_) only. Set on create; it cannot change afterwards. Filter the list with `?key=`.'
+                ),
             version: zod.number(),
             status: zod
                 .enum(['draft', 'active', 'archived'])
@@ -2587,6 +2605,8 @@ export const HogFlowsSchedulesPartialUpdateBody = /* @__PURE__ */ zod.object({
 export const hogFlowsBulkDeleteCreateBodyNameMax = 400
 
 export const hogFlowsBulkDeleteCreateBodyDescriptionDefault = ``
+export const hogFlowsBulkDeleteCreateBodyKeyMax = 400
+
 export const hogFlowsBulkDeleteCreateBodyTriggerMaskingOneTtlMin = 60
 export const hogFlowsBulkDeleteCreateBodyTriggerMaskingOneTtlMax = 94608000
 
@@ -2614,6 +2634,13 @@ export const HogFlowsBulkDeleteCreateBody = /* @__PURE__ */ zod
             .string()
             .default(hogFlowsBulkDeleteCreateBodyDescriptionDefault)
             .describe('Optional description.'),
+        key: zod
+            .string()
+            .max(hogFlowsBulkDeleteCreateBodyKeyMax)
+            .nullish()
+            .describe(
+                'Client-chosen identifier for this workflow, unique per team. Letters, numbers, hyphens (-) and underscores (_) only. Set on create; it cannot change afterwards. Filter the list with `?key=`.'
+            ),
         status: zod
             .enum(['draft', 'active', 'archived'])
             .describe('\* `draft` - Draft\n\* `active` - Active\n\* `archived` - Archived')
diff --git a/services/mcp/src/api/generated.ts b/services/mcp/src/api/generated.ts
index 9eed3723bc4..c7a7634c731 100644
--- a/services/mcp/src/api/generated.ts
+++ b/services/mcp/src/api/generated.ts
@@ -46201,6 +46201,12 @@ export namespace Schemas {
       name?: string | null;
       /** Optional description. */
       description?: string;
+      /**
+         * Client-chosen identifier for this workflow, unique per team. Letters, numbers, hyphens (-) and underscores (_) only. Set on create; it cannot change afterwards. Filter the list with `?key=`.
+         * @maxLength 400
+         * @nullable
+         */
+      key?: string | null;
       readonly version: number;
       /** draft (no execution), active (live), archived (disabled).
        *
@@ -46669,6 +46675,11 @@ export namespace Schemas {
       name?: string | null;
       /** Optional description. */
       description?: string;
+      /**
+         * Client-chosen identifier for this workflow. This value cannot change after creation.
+         * @nullable
+         */
+      readonly key: string | null;
       readonly version: number;
       /** draft (no execution), active (live), archived (disabled).
        *
@@ -69348,6 +69359,11 @@ export namespace Schemas {
       name?: string | null;
       /** Optional description. */
       description?: string;
+      /**
+         * Client-chosen identifier for this workflow. This value cannot change after creation.
+         * @nullable
+         */
+      readonly key?: string | null;
       readonly version?: number;
       /** draft (no execution), active (live), archived (disabled).
        *
@@ -104768,6 +104784,10 @@ export namespace Schemas {
      */
     created_by?: string;
     id?: string;
+    /**
+     * Return the workflow with this exact key, if the team has one.
+     */
+    key?: string;
     /**
      * Number of results to return per page.
      */

```

## Diff Y

Files:
- products/workflows/backend/api/hog_flow.py (modified, +40 -3)
- products/workflows/backend/api/test/test_hog_flow.py (modified, +54 -0)
- products/workflows/backend/migrations/0026_hogflow_key.py (added, +37 -0)
- products/workflows/backend/migrations/max_migration.txt (modified, +1 -1)
- products/workflows/backend/models/hog_flow/hog_flow.py (modified, +3 -0)

```diff
diff --git a/products/workflows/backend/api/hog_flow.py b/products/workflows/backend/api/hog_flow.py
index bc7c11c3fbf..5b0a5edba2e 100644
--- a/products/workflows/backend/api/hog_flow.py
+++ b/products/workflows/backend/api/hog_flow.py
@@ -13,7 +13,7 @@ from django.conf import settings
 from django.core.cache import cache
 from django.core.exceptions import ValidationError as DjangoValidationError
 from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
-from django.db import models, transaction
+from django.db import IntegrityError, models, transaction
 from django.db.models import Q, QuerySet
 from django.db.models.expressions import RawSQL
 from django.http import Http404, HttpResponse
@@ -2858,6 +2858,13 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
         help_text="Product surface that owns this workflow (e.g. `loops` for Desktop loops). Set only when "
         "creating a workflow. Filter the list with `?origin_product=`.",
     )
+    key = serializers.CharField(
+        max_length=400,
+        required=False,
+        allow_null=True,
+        help_text="Client-chosen identifier, unique within the project. Letters, numbers, hyphens (-) and "
+        "underscores (_) only. Set only when creating a workflow. Find a workflow by it with `?key=`.",
+    )
     name = serializers.CharField(
         max_length=400, required=False, allow_null=True, allow_blank=True, help_text="Workflow name."
     )
@@ -3100,6 +3107,7 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
             "version",
             "status",
             "origin_product",
+            "key",
             "created_at",
             "created_by",
             "updated_at",
@@ -3295,6 +3303,17 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
 
         return data
 
+    def validate_key(self, value: str | None) -> str | None:
+        if value is None:
+            return value
+        if not re.match(r"^[a-zA-Z0-9_-]+$", value):
+            raise serializers.ValidationError(
+                "Only letters, numbers, hyphens (-) & underscores (_) are allowed.", code="invalid_key"
+            )
+        if HogFlow.objects.filter(team_id=self.context["team_id"], key=value).exists():
+            raise serializers.ValidationError("There is already a workflow with this key.", code="unique")
+        return value
+
     def _strip_secret_inputs(self, validated_data: dict) -> None:
         # Move secret function inputs out of the live `actions` (and the derived `trigger`) into the
         # encrypted_inputs column before persisting. Only runs when this write carries actions - a
@@ -3311,7 +3330,16 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
         validated_data["team_id"] = team_id
         self._strip_secret_inputs(validated_data)
 
-        return super().create(validated_data=validated_data)
+        try:
+            with transaction.atomic():
+                return super().create(validated_data=validated_data)
+        except IntegrityError as e:
+            # A concurrent create can take the key between validate_key and the insert.
+            if "unique_key_for_team" in str(e):
+                raise serializers.ValidationError(
+                    {"key": [exceptions.ErrorDetail("There is already a workflow with this key.", code="unique")]}
+                ) from e
+            raise
 
     def update(self, instance, validated_data):
         self._strip_secret_inputs(validated_data)
@@ -3325,6 +3353,11 @@ class HogFlowUpdateSerializer(HogFlowSerializer):
         allow_null=True,
         help_text="Product surface that owns this workflow. This value cannot change after creation.",
     )
+    key = serializers.CharField(
+        read_only=True,
+        allow_null=True,
+        help_text="Client-chosen identifier, unique within the project. This value cannot change after creation.",
+    )
 
     def validate(self, data: dict) -> dict:
         instance = cast(Optional[HogFlow], self.instance)
@@ -3335,6 +3368,10 @@ class HogFlowUpdateSerializer(HogFlowSerializer):
             and submitted_origin_product != instance.origin_product
         ):
             raise serializers.ValidationError({"origin_product": "origin_product is set on create and cannot change."})
+        # Changing a key would let a client adopt a workflow it did not create.
+        submitted_key = self.initial_data.get("key", serializers.empty)
+        if instance is not None and submitted_key is not serializers.empty and submitted_key != instance.key:
+            raise serializers.ValidationError({"key": "key is set on create and cannot change."})
         return super().validate(data)
 
 
@@ -3751,7 +3788,7 @@ class HogFlowFilterSet(FilterSet):
         model = HogFlow
         # `created_by` is filtered by uuid in safely_get_queryset (the list UI's member picker keys on
         # uuid, not pk), so it's deliberately not an exact-match field here.
-        fields = ["id", "created_at", "updated_at", "status"]
+        fields = ["id", "key", "created_at", "updated_at", "status"]
 
 
 class HogFlowPagination(LimitOffsetPagination):
diff --git a/products/workflows/backend/api/test/test_hog_flow.py b/products/workflows/backend/api/test/test_hog_flow.py
index 273339df41e..73f3ac4109d 100644
--- a/products/workflows/backend/api/test/test_hog_flow.py
+++ b/products/workflows/backend/api/test/test_hog_flow.py
@@ -1,4 +1,5 @@
 import json
+from contextlib import nullcontext
 from copy import deepcopy
 from datetime import UTC, datetime, timedelta
 from io import StringIO
@@ -34,6 +35,7 @@ from products.cohorts.backend.models.cohort import Cohort
 from products.skills.backend.models.skills import LLMSkill
 from products.workflows.backend.api.hog_flow import (
     HogFlowActionSerializer,
+    HogFlowSerializer,
     _should_validate_strictly,
     mint_audience_confirm_token,
 )
@@ -459,6 +461,58 @@ class TestHogFlowAPI(APIBaseTest):
         assert response.status_code == 200, response.json()
         assert response.json()["origin_product"] == "loops"
 
+    def _create_keyed_flow(self, key: Any):
+        hog_flow, _ = self._create_hog_flow_with_action(
+            {"template_id": "template-webhook", "inputs": {"url": {"value": "https://example.com"}}}
+        )
+        return self.client.post(f"/api/projects/{self.team.id}/hog_flows", {**hog_flow, "key": key}, format="json")
+
+    def test_key_is_echoed_on_create(self):
+        response = self._create_keyed_flow("onboarding_drip-v2")
+        assert response.status_code == 201, response.json()
+        assert response.json()["key"] == "onboarding_drip-v2"
+
+    @parameterized.expand([("space", "has space"), ("slash", "a/b"), ("dot", "a.b")])
+    def test_key_outside_charset_is_rejected(self, _name, key):
+        response = self._create_keyed_flow(key)
+        assert response.status_code == 400, response.json()
+        assert response.json()["attr"] == "key"
+        assert response.json()["code"] == "invalid_key"
+
+    @parameterized.expand([("pre_check", False), ("database_race", True)])
+    def test_key_taken_in_team_is_rejected(self, _name, skip_pre_check):
+        HogFlow.objects.create(team=self.team, name="Owner", created_by=self.user, key="taken")
+        # Skipping the pre-check makes the constraint the only guard, as when a concurrent create wins.
+        bypass = patch.object(HogFlowSerializer, "validate_key", side_effect=lambda value: value)
+        with bypass if skip_pre_check else nullcontext():
+            response = self._create_keyed_flow("taken")
+        assert response.status_code == 400, response.json()
+        assert response.json()["attr"] == "key"
+        assert response.json()["code"] == "unique"
+
+    @parameterized.expand([("change", "other"), ("clear", None), ("set_on_unkeyed", "late")])
+    def test_patch_that_changes_key_is_refused(self, name, new_key):
+        response = self._create_keyed_flow(None if name == "set_on_unkeyed" else "original")
+        assert response.status_code == 201, response.json()
+        flow_id = response.json()["id"]
+
+        response = self.client.patch(
+            f"/api/projects/{self.team.id}/hog_flows/{flow_id}", {"key": new_key}, format="json"
+        )
+        assert response.status_code == 400, response.json()
+        assert response.json()["attr"] == "key"
+        assert HogFlow.objects.get(id=flow_id).key == (None if name == "set_on_unkeyed" else "original")
+
+    def test_list_filter_by_key_resolves_one_row_in_team(self):
+        other_team = Team.objects.create(organization=self.organization)
+        HogFlow.objects.create(team=other_team, name="Other team", created_by=self.user, key="shared")
+        HogFlow.objects.create(team=self.team, name="Unkeyed", created_by=self.user)
+        mine = HogFlow.objects.create(team=self.team, name="Mine", created_by=self.user, key="shared")
+
+        response = self.client.get(f"/api/projects/{self.team.id}/hog_flows?key=shared")
+        assert response.status_code == 200, response.json()
+        assert [flow["id"] for flow in response.json()["results"]] == [str(mine.id)]
+
     def test_mcp_list_is_metadata_only_and_hides_action_secrets(self):
         # A webhook action whose headers carry a bearer token — the kind of credential-like value
         # that must not leak from a workflow *listing*.
diff --git a/products/workflows/backend/migrations/0026_hogflow_key.py b/products/workflows/backend/migrations/0026_hogflow_key.py
new file mode 100644
index 00000000000..a3db50163b2
--- /dev/null
+++ b/products/workflows/backend/migrations/0026_hogflow_key.py
@@ -0,0 +1,37 @@
+from django.db import migrations, models
+
+from posthog.migration_helpers import CreateIndexConcurrently
+
+
+class Migration(migrations.Migration):
+    # Concurrent index builds cannot run inside a transaction.
+    atomic = False
+
+    dependencies = [
+        ("workflows", "0025_hogflow_email_sending_paused_by"),
+    ]
+
+    operations = [
+        migrations.AddField(
+            model_name="hogflow",
+            name="key",
+            field=models.CharField(blank=True, max_length=400, null=True),
+        ),
+        # Build the unique index concurrently so the table keeps taking writes while it builds.
+        migrations.SeparateDatabaseAndState(
+            state_operations=[
+                migrations.AddConstraint(
+                    model_name="hogflow",
+                    constraint=models.UniqueConstraint(fields=["team", "key"], name="unique_key_for_team"),
+                ),
+            ],
+            database_operations=[
+                CreateIndexConcurrently(
+                    index_name="unique_key_for_team",
+                    table_name="posthog_hogflow",
+                    columns='(team_id, "key")',
+                    unique=True,
+                ),
+            ],
+        ),
+    ]
diff --git a/products/workflows/backend/migrations/max_migration.txt b/products/workflows/backend/migrations/max_migration.txt
index 4aa215fa754..bca6f52294d 100644
--- a/products/workflows/backend/migrations/max_migration.txt
+++ b/products/workflows/backend/migrations/max_migration.txt
@@ -1 +1 @@
-0025_hogflow_email_sending_paused_by
+0026_hogflow_key
diff --git a/products/workflows/backend/models/hog_flow/hog_flow.py b/products/workflows/backend/models/hog_flow/hog_flow.py
index 9c47602a2d4..7e333aec9fe 100644
--- a/products/workflows/backend/models/hog_flow/hog_flow.py
+++ b/products/workflows/backend/models/hog_flow/hog_flow.py
@@ -121,6 +121,7 @@ class HogFlow(UUIDTModel):
 
         constraints = [
             models.UniqueConstraint(fields=["team", "version", "id"], name="unique_version_per_flow"),
+            models.UniqueConstraint(fields=["team", "key"], name="unique_key_for_team"),
         ]
 
     class State(models.TextChoices):
@@ -138,6 +139,8 @@ class HogFlow(UUIDTModel):
         LOOPS = "loops", "Loops"
 
     name = models.CharField(max_length=400, null=True, blank=True)
+    # Client-chosen handle, unique per team, so a CLI can find the workflow it owns.
+    key = models.CharField(max_length=400, null=True, blank=True)
     description = models.TextField(blank=True, default="")
     version = models.IntegerField(default=1)
     team = models.ForeignKey("posthog.Team", on_delete=models.CASCADE)

```

## Diff Z

Files:
- products/workflows/backend/api/hog_flow.py (modified, +47 -10)
- products/workflows/backend/api/test/test_hog_flow.py (modified, +69 -0)
- products/workflows/backend/migrations/0026_hogflow_key.py (added, +52 -0)
- products/workflows/backend/migrations/max_migration.txt (modified, +1 -1)
- products/workflows/backend/models/hog_flow/hog_flow.py (modified, +5 -0)

```diff
diff --git a/products/workflows/backend/api/hog_flow.py b/products/workflows/backend/api/hog_flow.py
index bc7c11c3fbf..45079941bba 100644
--- a/products/workflows/backend/api/hog_flow.py
+++ b/products/workflows/backend/api/hog_flow.py
@@ -13,7 +13,7 @@ from django.conf import settings
 from django.core.cache import cache
 from django.core.exceptions import ValidationError as DjangoValidationError
 from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
-from django.db import models, transaction
+from django.db import IntegrityError, models, transaction
 from django.db.models import Q, QuerySet
 from django.db.models.expressions import RawSQL
 from django.http import Http404, HttpResponse
@@ -2772,6 +2772,7 @@ class HogFlowMinimalSerializer(UserAccessControlSerializerMixin, serializers.Mod
         fields = [
             "id",
             "name",
+            "key",
             "description",
             "version",
             "status",
@@ -2861,6 +2862,13 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
     name = serializers.CharField(
         max_length=400, required=False, allow_null=True, allow_blank=True, help_text="Workflow name."
     )
+    key = serializers.CharField(
+        max_length=400,
+        required=False,
+        allow_null=True,
+        help_text="Client-chosen identifier, unique within the team. Letters, numbers, hyphens and underscores "
+        "only. Set only when creating a workflow. Find a workflow by it with `?key=`.",
+    )
     description = serializers.CharField(required=False, allow_blank=True, default="", help_text="Optional description.")
     status = serializers.ChoiceField(
         choices=HogFlow.State.choices,
@@ -3096,6 +3104,7 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
         fields = [
             "id",
             "name",
+            "key",
             "description",
             "version",
             "status",
@@ -3304,6 +3313,22 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
             return
         validated_data["encrypted_inputs"] = strip_secrets_from_content(validated_data, template_cache={})
 
+    def validate_key(self, value: str | None) -> str | None:
+        if value is None:
+            return value
+        if not re.match(r"^[a-zA-Z0-9_-]+$", value):
+            raise serializers.ValidationError(
+                "Only letters, numbers, hyphens (-) & underscores (_) are allowed.", code="invalid_key"
+            )
+        instance = cast(Optional[HogFlow], self.instance)
+        if instance is None or value != instance.key:
+            taken = HogFlow.objects.filter(team_id=self.context["team_id"], key=value)
+            if instance is not None:
+                taken = taken.exclude(pk=instance.pk)
+            if taken.exists():
+                raise serializers.ValidationError("There is already a workflow with this key.", code="unique")
+        return value
+
     def create(self, validated_data: dict, *args, **kwargs) -> HogFlow:
         request = self.context["request"]
         team_id = self.context["team_id"]
@@ -3311,7 +3336,16 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
         validated_data["team_id"] = team_id
         self._strip_secret_inputs(validated_data)
 
-        return super().create(validated_data=validated_data)
+        try:
+            with transaction.atomic():
+                return super().create(validated_data=validated_data)
+        except IntegrityError as e:
+            # A concurrent create can take the key between validate_key and the insert.
+            if "unique_key_for_team" in str(e):
+                raise serializers.ValidationError(
+                    {"key": [exceptions.ErrorDetail("There is already a workflow with this key.", code="unique")]}
+                ) from e
+            raise
 
     def update(self, instance, validated_data):
         self._strip_secret_inputs(validated_data)
@@ -3325,16 +3359,19 @@ class HogFlowUpdateSerializer(HogFlowSerializer):
         allow_null=True,
         help_text="Product surface that owns this workflow. This value cannot change after creation.",
     )
+    key = serializers.CharField(
+        read_only=True,
+        allow_null=True,
+        help_text="Client-chosen identifier, unique within the team. This value cannot change after creation.",
+    )
 
     def validate(self, data: dict) -> dict:
         instance = cast(Optional[HogFlow], self.instance)
-        submitted_origin_product = self.initial_data.get("origin_product", serializers.empty)
-        if (
-            instance is not None
-            and submitted_origin_product is not serializers.empty
-            and submitted_origin_product != instance.origin_product
-        ):
-            raise serializers.ValidationError({"origin_product": "origin_product is set on create and cannot change."})
+        # Changing the key on update would let a client adopt a workflow it didn't create.
+        for field in ("origin_product", "key"):
+            submitted = self.initial_data.get(field, serializers.empty)
+            if instance is not None and submitted is not serializers.empty and submitted != getattr(instance, field):
+                raise serializers.ValidationError({field: f"{field} is set on create and cannot change."})
         return super().validate(data)
 
 
@@ -3751,7 +3788,7 @@ class HogFlowFilterSet(FilterSet):
         model = HogFlow
         # `created_by` is filtered by uuid in safely_get_queryset (the list UI's member picker keys on
         # uuid, not pk), so it's deliberately not an exact-match field here.
-        fields = ["id", "created_at", "updated_at", "status"]
+        fields = ["id", "key", "created_at", "updated_at", "status"]
 
 
 class HogFlowPagination(LimitOffsetPagination):
diff --git a/products/workflows/backend/api/test/test_hog_flow.py b/products/workflows/backend/api/test/test_hog_flow.py
index 273339df41e..f99c5c6a1c0 100644
--- a/products/workflows/backend/api/test/test_hog_flow.py
+++ b/products/workflows/backend/api/test/test_hog_flow.py
@@ -459,6 +459,75 @@ class TestHogFlowAPI(APIBaseTest):
         assert response.status_code == 200, response.json()
         assert response.json()["origin_product"] == "loops"
 
+    def test_key_is_set_on_create_and_echoed(self):
+        hog_flow, _ = self._create_hog_flow_with_action(
+            {"template_id": "template-webhook", "inputs": {"url": {"value": "https://example.com"}}}
+        )
+        response = self.client.post(f"/api/projects/{self.team.id}/hog_flows", {**hog_flow, "key": "onboarding_v2"})
+        assert response.status_code == 201, response.json()
+        assert response.json()["key"] == "onboarding_v2"
+
+        # Resending the same key alongside other edits is not a change, so it's accepted.
+        flow_id = response.json()["id"]
+        response = self.client.patch(
+            f"/api/projects/{self.team.id}/hog_flows/{flow_id}", {"key": "onboarding_v2", "name": "Renamed"}
+        )
+        assert response.status_code == 200, response.json()
+        assert response.json()["key"] == "onboarding_v2"
+
+    @parameterized.expand(
+        [
+            ("charset", "not a key!", "invalid_key", False),
+            ("taken_pre_check", "taken", "unique", False),
+            ("taken_db_race", "taken", "unique", True),
+        ]
+    )
+    def test_create_refuses_bad_key(self, _name, key, expected_code, race_past_pre_check):
+        HogFlow.objects.create(team=self.team, name="Owner", key="taken")
+        hog_flow, _ = self._create_hog_flow_with_action(
+            {"template_id": "template-webhook", "inputs": {"url": {"value": "https://example.com"}}}
+        )
+        # A concurrent create can commit between the pre-check and the insert; skipping the pre-check
+        # leaves the database constraint to catch it.
+        race = patch.object(HogFlowSerializer, "validate_key", lambda self, value: value)
+        with race if race_past_pre_check else nullcontext():
+            response = self.client.post(f"/api/projects/{self.team.id}/hog_flows", {**hog_flow, "key": key})
+
+        assert response.status_code == 400, response.json()
+        assert response.json()["attr"] == "key"
+        assert response.json()["code"] == expected_code
+        assert HogFlow.objects.filter(team=self.team).count() == 1
+
+    @parameterized.expand(
+        [
+            ("change", "owned", "other"),
+            ("clear", "owned", None),
+            ("adopt", None, "claimed"),
+        ]
+    )
+    def test_update_refuses_key_change(self, _name, initial_key, new_key):
+        flow = HogFlow.objects.create(team=self.team, name="Flow", key=initial_key)
+
+        response = self.client.patch(f"/api/projects/{self.team.id}/hog_flows/{flow.id}", {"key": new_key})
+
+        assert response.status_code == 400, response.json()
+        assert response.json()["attr"] == "key"
+        flow.refresh_from_db()
+        assert flow.key == initial_key
+
+    def test_list_filter_by_key_resolves_one_row_in_team(self):
+        other_team = Team.objects.create(organization=self.organization, name="Other")
+        owned = HogFlow.objects.create(team=self.team, name="Owned", key="onboarding")
+        HogFlow.objects.create(team=self.team, name="Sibling", key="onboarding-v2")
+        HogFlow.objects.create(team=self.team, name="Keyless")
+        HogFlow.objects.create(team=other_team, name="Other team", key="onboarding")
+
+        response = self.client.get(f"/api/projects/{self.team.id}/hog_flows?key=onboarding")
+
+        assert response.status_code == 200, response.json()
+        assert [flow["id"] for flow in response.json()["results"]] == [str(owned.id)]
+        assert response.json()["results"][0]["key"] == "onboarding"
+
     def test_mcp_list_is_metadata_only_and_hides_action_secrets(self):
         # A webhook action whose headers carry a bearer token — the kind of credential-like value
         # that must not leak from a workflow *listing*.
diff --git a/products/workflows/backend/migrations/0026_hogflow_key.py b/products/workflows/backend/migrations/0026_hogflow_key.py
new file mode 100644
index 00000000000..b3e77714c62
--- /dev/null
+++ b/products/workflows/backend/migrations/0026_hogflow_key.py
@@ -0,0 +1,52 @@
+from django.db import migrations, models
+
+from posthog.migration_helpers import CreateIndexConcurrently
+
+TABLE = "posthog_hogflow"
+CONSTRAINT = "unique_key_for_team"
+
+
+class Migration(migrations.Migration):
+    # Build the unique index concurrently, then promote it to the constraint Django's state expects.
+    atomic = False
+
+    dependencies = [
+        ("workflows", "0025_hogflow_email_sending_paused_by"),
+    ]
+
+    operations = [
+        migrations.AddField(
+            model_name="hogflow",
+            name="key",
+            field=models.CharField(
+                blank=True, help_text="Client-chosen identifier, unique within the team.", max_length=400, null=True
+            ),
+        ),
+        migrations.SeparateDatabaseAndState(
+            state_operations=[
+                migrations.AddConstraint(
+                    model_name="hogflow",
+                    constraint=models.UniqueConstraint(fields=("team", "key"), name=CONSTRAINT),
+                ),
+            ],
+            database_operations=[
+                CreateIndexConcurrently(index_name=CONSTRAINT, table_name=TABLE, columns="(team_id, key)", unique=True),
+                migrations.RunSQL(
+                    # Catalog-only promotion; guarded so a bin/migrate retry is a no-op.
+                    sql=f"""
+                    DO $$
+                    BEGIN
+                        IF NOT EXISTS (
+                            SELECT 1 FROM pg_constraint
+                            WHERE conname = '{CONSTRAINT}' AND conrelid = '{TABLE}'::regclass
+                        ) THEN
+                            PERFORM set_config('lock_timeout', '5s', true);
+                            ALTER TABLE {TABLE} ADD CONSTRAINT {CONSTRAINT} UNIQUE USING INDEX {CONSTRAINT};
+                        END IF;
+                    END $$;
+                    """,
+                    reverse_sql=f"ALTER TABLE {TABLE} DROP CONSTRAINT IF EXISTS {CONSTRAINT};",
+                ),
+            ],
+        ),
+    ]
diff --git a/products/workflows/backend/migrations/max_migration.txt b/products/workflows/backend/migrations/max_migration.txt
index 4aa215fa754..bca6f52294d 100644
--- a/products/workflows/backend/migrations/max_migration.txt
+++ b/products/workflows/backend/migrations/max_migration.txt
@@ -1 +1 @@
-0025_hogflow_email_sending_paused_by
+0026_hogflow_key
diff --git a/products/workflows/backend/models/hog_flow/hog_flow.py b/products/workflows/backend/models/hog_flow/hog_flow.py
index 9c47602a2d4..cc950d12201 100644
--- a/products/workflows/backend/models/hog_flow/hog_flow.py
+++ b/products/workflows/backend/models/hog_flow/hog_flow.py
@@ -121,6 +121,7 @@ class HogFlow(UUIDTModel):
 
         constraints = [
             models.UniqueConstraint(fields=["team", "version", "id"], name="unique_version_per_flow"),
+            models.UniqueConstraint(fields=["team", "key"], name="unique_key_for_team"),
         ]
 
     class State(models.TextChoices):
@@ -138,6 +139,10 @@ class HogFlow(UUIDTModel):
         LOOPS = "loops", "Loops"
 
     name = models.CharField(max_length=400, null=True, blank=True)
+    # Client-chosen identifier, unique per team, so a client can find the workflow it owns. Set only on create.
+    key = models.CharField(
+        max_length=400, null=True, blank=True, help_text="Client-chosen identifier, unique within the team."
+    )
     description = models.TextField(blank=True, default="")
     version = models.IntegerField(default=1)
     team = models.ForeignKey("posthog.Team", on_delete=models.CASCADE)

```

## Diff W

Files:
- products/workflows/backend/api/hog_flow.py (modified, +43 -3)
- products/workflows/backend/api/test/test_hog_flow_key.py (added, +123 -0)
- products/workflows/backend/migrations/0026_hogflow_key.py (added, +35 -0)
- products/workflows/backend/migrations/max_migration.txt (modified, +1 -1)
- products/workflows/backend/models/hog_flow/hog_flow.py (modified, +3 -0)

```diff
diff --git a/products/workflows/backend/api/hog_flow.py b/products/workflows/backend/api/hog_flow.py
index bc7c11c3fbf..d3c58da2e2a 100644
--- a/products/workflows/backend/api/hog_flow.py
+++ b/products/workflows/backend/api/hog_flow.py
@@ -13,7 +13,7 @@ from django.conf import settings
 from django.core.cache import cache
 from django.core.exceptions import ValidationError as DjangoValidationError
 from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
-from django.db import models, transaction
+from django.db import IntegrityError, models, transaction
 from django.db.models import Q, QuerySet
 from django.db.models.expressions import RawSQL
 from django.http import Http404, HttpResponse
@@ -2858,6 +2858,13 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
         help_text="Product surface that owns this workflow (e.g. `loops` for Desktop loops). Set only when "
         "creating a workflow. Filter the list with `?origin_product=`.",
     )
+    key = serializers.CharField(
+        max_length=400,
+        required=False,
+        allow_null=True,
+        help_text="Client-chosen identifier, unique within the project. Letters, numbers, hyphens (-) and "
+        "underscores (_) only. Set only when creating a workflow. Find a workflow by it with `?key=`.",
+    )
     name = serializers.CharField(
         max_length=400, required=False, allow_null=True, allow_blank=True, help_text="Workflow name."
     )
@@ -3100,6 +3107,7 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
             "version",
             "status",
             "origin_product",
+            "key",
             "created_at",
             "created_by",
             "updated_at",
@@ -3147,6 +3155,22 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
             "email_sending_resumed_at",
         ]
 
+    def validate_key(self, value: Optional[str]) -> Optional[str]:
+        if value is None:
+            return value
+        if not re.match(r"^[a-zA-Z0-9_-]+$", value):
+            raise serializers.ValidationError(
+                "Only letters, numbers, hyphens (-) & underscores (_) are allowed.", code="invalid_key"
+            )
+        unique_qs = HogFlow.objects.filter(team_id=self.context["team_id"], key=value)
+        # A test invocation's nested `configuration` resends the flow's own key, with the flow in context.
+        instance = cast(Optional[HogFlow], self.instance) or self.context.get("instance")
+        if instance is not None:
+            unique_qs = unique_qs.exclude(pk=instance.pk)
+        if unique_qs.exists():
+            raise serializers.ValidationError("There is already a workflow with this key.", code="unique")
+        return value
+
     def validate(self, data):
         instance = cast(Optional[HogFlow], self.instance)
         is_draft = self.context.get("is_draft")
@@ -3311,7 +3335,17 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
         validated_data["team_id"] = team_id
         self._strip_secret_inputs(validated_data)
 
-        return super().create(validated_data=validated_data)
+        try:
+            # Savepoint so a lost race on the key doesn't poison the request's transaction.
+            with transaction.atomic():
+                return super().create(validated_data=validated_data)
+        except IntegrityError as e:
+            # A concurrent create can slip past validate_key's unlocked read; the unique index decides.
+            if "unique_key_for_team" in str(e):
+                raise serializers.ValidationError(
+                    {"key": [exceptions.ErrorDetail("There is already a workflow with this key.", code="unique")]}
+                ) from e
+            raise
 
     def update(self, instance, validated_data):
         self._strip_secret_inputs(validated_data)
@@ -3337,6 +3371,12 @@ class HogFlowUpdateSerializer(HogFlowSerializer):
             raise serializers.ValidationError({"origin_product": "origin_product is set on create and cannot change."})
         return super().validate(data)
 
+    def validate_key(self, value: Optional[str]) -> Optional[str]:
+        # Changing a key would adopt another workflow's identity, so it is fixed at create.
+        if value != cast(HogFlow, self.instance).key:
+            raise serializers.ValidationError("key is set on create and cannot change.", code="immutable")
+        return value
+
 
 GRAPH_OPERATION_TYPES = [
     "update_action",
@@ -3751,7 +3791,7 @@ class HogFlowFilterSet(FilterSet):
         model = HogFlow
         # `created_by` is filtered by uuid in safely_get_queryset (the list UI's member picker keys on
         # uuid, not pk), so it's deliberately not an exact-match field here.
-        fields = ["id", "created_at", "updated_at", "status"]
+        fields = ["id", "created_at", "updated_at", "status", "key"]
 
 
 class HogFlowPagination(LimitOffsetPagination):
diff --git a/products/workflows/backend/api/test/test_hog_flow_key.py b/products/workflows/backend/api/test/test_hog_flow_key.py
new file mode 100644
index 00000000000..8e809bf305c
--- /dev/null
+++ b/products/workflows/backend/api/test/test_hog_flow_key.py
@@ -0,0 +1,123 @@
+from posthog.test.base import APIBaseTest
+from unittest.mock import MagicMock, patch
+
+from parameterized import parameterized
+from rest_framework import status
+
+from posthog.models import Team
+
+from products.workflows.backend.api.hog_flow import HogFlowSerializer
+from products.workflows.backend.models.hog_flow.hog_flow import HogFlow
+
+TRIGGER_ACTION = {
+    "id": "trigger_node",
+    "name": "trigger_1",
+    "type": "trigger",
+    "config": {"type": "event", "filters": {"events": [{"id": "$pageview", "name": "$pageview", "type": "events"}]}},
+}
+
+
+class TestHogFlowKey(APIBaseTest):
+    def _create(self, **extra):
+        return self.client.post(
+            f"/api/projects/{self.team.id}/hog_flows", {"name": "Flow", "actions": [TRIGGER_ACTION], **extra}
+        )
+
+    def test_create_with_key_echoes_the_key(self):
+        response = self._create(key="onboarding-drip_v2")
+
+        assert response.status_code == status.HTTP_201_CREATED, response.json()
+        assert response.json()["key"] == "onboarding-drip_v2"
+        assert HogFlow.objects.get(id=response.json()["id"]).key == "onboarding-drip_v2"
+
+    @parameterized.expand(
+        [
+            ("space", "has space", "invalid_key"),
+            ("dot", "dotted.key", "invalid_key"),
+            ("slash", "a/b", "invalid_key"),
+            ("taken", "taken", "unique"),
+        ]
+    )
+    def test_create_refuses_bad_key(self, _name, key, code):
+        HogFlow.objects.create(team=self.team, name="Owner", key="taken")
+
+        response = self._create(key=key)
+
+        assert response.status_code == status.HTTP_400_BAD_REQUEST, response.json()
+        assert response.json()["attr"] == "key"
+        assert response.json()["code"] == code
+
+    def test_key_taken_in_another_team_is_free(self):
+        other_team = Team.objects.create(organization=self.organization, name="Other")
+        HogFlow.objects.create(team=other_team, name="Theirs", key="shared")
+
+        response = self._create(key="shared")
+
+        assert response.status_code == status.HTTP_201_CREATED, response.json()
+
+    def test_duplicate_key_that_races_past_the_pre_check_is_a_field_error(self):
+        HogFlow.objects.create(team=self.team, name="Owner", key="taken")
+
+        # Skip the pre-check so the real unique index is what refuses the write.
+        with patch.object(HogFlowSerializer, "validate_key", lambda self, value: value):
+            response = self._create(key="taken")
+
+        assert response.status_code == status.HTTP_400_BAD_REQUEST, response.json()
+        assert response.json()["attr"] == "key"
+        assert response.json()["code"] == "unique"
+        assert HogFlow.objects.filter(team=self.team, key="taken").count() == 1
+
+    @parameterized.expand(
+        [
+            ("rename", "owned", "renamed"),
+            ("clear", "owned", None),
+            ("adopt", None, "adopted"),
+        ]
+    )
+    def test_patch_that_changes_the_key_is_refused(self, _name, original, submitted):
+        flow = HogFlow.objects.create(team=self.team, name="Flow", key=original, actions=[TRIGGER_ACTION])
+
+        response = self.client.patch(f"/api/projects/{self.team.id}/hog_flows/{flow.id}", {"key": submitted})
+
+        assert response.status_code == status.HTTP_400_BAD_REQUEST, response.json()
+        assert response.json()["attr"] == "key"
+        flow.refresh_from_db()
+        assert flow.key == original
+
+    def test_patch_that_resends_the_same_key_is_accepted(self):
+        flow = HogFlow.objects.create(team=self.team, name="Flow", key="owned", actions=[TRIGGER_ACTION])
+
+        response = self.client.patch(
+            f"/api/projects/{self.team.id}/hog_flows/{flow.id}", {"key": "owned", "name": "Renamed"}
+        )
+
+        assert response.status_code == status.HTTP_200_OK, response.json()
+        assert response.json()["key"] == "owned"
+
+    def test_key_filter_resolves_exactly_one_row_in_the_team(self):
+        other_team = Team.objects.create(organization=self.organization, name="Other")
+        mine = HogFlow.objects.create(team=self.team, name="Mine", key="shared")
+        HogFlow.objects.create(team=self.team, name="Unkeyed")
+        HogFlow.objects.create(team=self.team, name="Sibling", key="shared-2")
+        HogFlow.objects.create(team=other_team, name="Theirs", key="shared")
+
+        response = self.client.get(f"/api/projects/{self.team.id}/hog_flows?key=shared")
+
+        assert response.status_code == status.HTTP_200_OK, response.json()
+        assert [flow["id"] for flow in response.json()["results"]] == [str(mine.id)]
+
+    def test_test_invocation_that_resends_the_flows_own_key_is_accepted(self):
+        flow = HogFlow.objects.create(team=self.team, name="Flow", key="owned", actions=[TRIGGER_ACTION])
+
+        with patch("products.workflows.backend.api.hog_flow.create_hog_flow_invocation_test") as mock_invoke:
+            mock_invoke.return_value = MagicMock(status_code=200, json=lambda: {"status": "success"})
+            response = self.client.post(
+                f"/api/projects/{self.team.id}/hog_flows/{flow.id}/invocations/",
+                data={
+                    "globals": {"event": {"event": "$pageview", "distinct_id": "d"}},
+                    "configuration": {"name": "Flow", "key": "owned", "actions": [TRIGGER_ACTION]},
+                },
+                format="json",
+            )
+
+        assert response.status_code == status.HTTP_200_OK, response.json()
diff --git a/products/workflows/backend/migrations/0026_hogflow_key.py b/products/workflows/backend/migrations/0026_hogflow_key.py
new file mode 100644
index 00000000000..a984ce92c2c
--- /dev/null
+++ b/products/workflows/backend/migrations/0026_hogflow_key.py
@@ -0,0 +1,35 @@
+from django.db import migrations, models
+
+from posthog.migration_helpers import CreateIndexConcurrently
+
+
+class Migration(migrations.Migration):
+    atomic = False
+
+    dependencies = [
+        ("workflows", "0025_hogflow_email_sending_paused_by"),
+    ]
+
+    operations = [
+        migrations.AddField(
+            model_name="hogflow",
+            name="key",
+            field=models.CharField(blank=True, max_length=400, null=True),
+        ),
+        migrations.SeparateDatabaseAndState(
+            database_operations=[
+                CreateIndexConcurrently(
+                    index_name="unique_key_for_team",
+                    table_name="posthog_hogflow",
+                    columns="(team_id, key)",
+                    unique=True,
+                ),
+            ],
+            state_operations=[
+                migrations.AddConstraint(
+                    model_name="hogflow",
+                    constraint=models.UniqueConstraint(fields=["team", "key"], name="unique_key_for_team"),
+                ),
+            ],
+        ),
+    ]
diff --git a/products/workflows/backend/migrations/max_migration.txt b/products/workflows/backend/migrations/max_migration.txt
index 4aa215fa754..bca6f52294d 100644
--- a/products/workflows/backend/migrations/max_migration.txt
+++ b/products/workflows/backend/migrations/max_migration.txt
@@ -1 +1 @@
-0025_hogflow_email_sending_paused_by
+0026_hogflow_key
diff --git a/products/workflows/backend/models/hog_flow/hog_flow.py b/products/workflows/backend/models/hog_flow/hog_flow.py
index 9c47602a2d4..7e333aec9fe 100644
--- a/products/workflows/backend/models/hog_flow/hog_flow.py
+++ b/products/workflows/backend/models/hog_flow/hog_flow.py
@@ -121,6 +121,7 @@ class HogFlow(UUIDTModel):
 
         constraints = [
             models.UniqueConstraint(fields=["team", "version", "id"], name="unique_version_per_flow"),
+            models.UniqueConstraint(fields=["team", "key"], name="unique_key_for_team"),
         ]
 
     class State(models.TextChoices):
@@ -138,6 +139,8 @@ class HogFlow(UUIDTModel):
         LOOPS = "loops", "Loops"
 
     name = models.CharField(max_length=400, null=True, blank=True)
+    # Client-chosen handle, unique per team, so a CLI can find the workflow it owns.
+    key = models.CharField(max_length=400, null=True, blank=True)
     description = models.TextField(blank=True, default="")
     version = models.IntegerField(default=1)
     team = models.ForeignKey("posthog.Team", on_delete=models.CASCADE)

```

## Diff V

Files:
- products/workflows/backend/api/hog_flow.py (modified, +38 -3)
- products/workflows/backend/api/test/test_hog_flow_key.py (added, +163 -0)
- products/workflows/backend/migrations/0026_hogflow_key.py (added, +20 -0)
- products/workflows/backend/migrations/0027_hogflow_unique_key_for_team.py (added, +35 -0)
- products/workflows/backend/migrations/max_migration.txt (modified, +1 -1)
- products/workflows/backend/models/hog_flow/hog_flow.py (modified, +11 -0)
- products/workflows/frontend/generated/api.schemas.ts (modified, +17 -0)
- products/workflows/frontend/generated/api.zod.ts (modified, +27 -0)
- services/mcp/src/api/generated.ts (modified, +17 -0)
- services/mcp/src/generated/workflows/api.ts (modified, +10 -0)
- services/mcp/src/tools/generated/workflows.ts (modified, +4 -0)

```diff
diff --git a/products/workflows/backend/api/hog_flow.py b/products/workflows/backend/api/hog_flow.py
index bc7c11c3fbf..458452f1c0d 100644
--- a/products/workflows/backend/api/hog_flow.py
+++ b/products/workflows/backend/api/hog_flow.py
@@ -13,7 +13,7 @@ from django.conf import settings
 from django.core.cache import cache
 from django.core.exceptions import ValidationError as DjangoValidationError
 from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
-from django.db import models, transaction
+from django.db import IntegrityError, models, transaction
 from django.db.models import Q, QuerySet
 from django.db.models.expressions import RawSQL
 from django.http import Http404, HttpResponse
@@ -3095,6 +3095,7 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
         model = HogFlow
         fields = [
             "id",
+            "key",
             "name",
             "description",
             "version",
@@ -3304,6 +3305,21 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
             return
         validated_data["encrypted_inputs"] = strip_secrets_from_content(validated_data, template_cache={})
 
+    def validate_key(self, value: str | None) -> str | None:
+        if value is None:
+            return value
+
+        if HogFlow.objects.filter(team_id=self.context["team_id"], key=value).exists():
+            raise serializers.ValidationError("There is already a workflow with this key.", code="unique")
+
+        if not re.match(r"^[a-zA-Z0-9_-]+$", value):
+            raise serializers.ValidationError(
+                "Only letters, numbers, hyphens (-) & underscores (_) are allowed.",
+                code="invalid_key",
+            )
+
+        return value
+
     def create(self, validated_data: dict, *args, **kwargs) -> HogFlow:
         request = self.context["request"]
         team_id = self.context["team_id"]
@@ -3311,7 +3327,16 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
         validated_data["team_id"] = team_id
         self._strip_secret_inputs(validated_data)
 
-        return super().create(validated_data=validated_data)
+        try:
+            return super().create(validated_data=validated_data)
+        except IntegrityError as exc:
+            # A concurrent create can slip past the unlocked validate_key read, so the constraint
+            # is the authoritative guard. Translate its violation into the same field error.
+            if "unique_key_for_team" in str(exc):
+                raise serializers.ValidationError(
+                    {"key": [exceptions.ErrorDetail("There is already a workflow with this key.", code="unique")]}
+                ) from exc
+            raise
 
     def update(self, instance, validated_data):
         self._strip_secret_inputs(validated_data)
@@ -3325,6 +3350,11 @@ class HogFlowUpdateSerializer(HogFlowSerializer):
         allow_null=True,
         help_text="Product surface that owns this workflow. This value cannot change after creation.",
     )
+    key = serializers.CharField(
+        read_only=True,
+        allow_null=True,
+        help_text="Client-chosen identifier, unique within the project. This value cannot change after creation.",
+    )
 
     def validate(self, data: dict) -> dict:
         instance = cast(Optional[HogFlow], self.instance)
@@ -3335,6 +3365,11 @@ class HogFlowUpdateSerializer(HogFlowSerializer):
             and submitted_origin_product != instance.origin_product
         ):
             raise serializers.ValidationError({"origin_product": "origin_product is set on create and cannot change."})
+        # A PATCH that moves a key would be adoption by the back door, so only a repeat of the
+        # stored value passes.
+        submitted_key = self.initial_data.get("key", serializers.empty)
+        if instance is not None and submitted_key is not serializers.empty and submitted_key != instance.key:
+            raise serializers.ValidationError({"key": "key is set on create and cannot change."})
         return super().validate(data)
 
 
@@ -3751,7 +3786,7 @@ class HogFlowFilterSet(FilterSet):
         model = HogFlow
         # `created_by` is filtered by uuid in safely_get_queryset (the list UI's member picker keys on
         # uuid, not pk), so it's deliberately not an exact-match field here.
-        fields = ["id", "created_at", "updated_at", "status"]
+        fields = ["id", "key", "created_at", "updated_at", "status"]
 
 
 class HogFlowPagination(LimitOffsetPagination):
diff --git a/products/workflows/backend/api/test/test_hog_flow_key.py b/products/workflows/backend/api/test/test_hog_flow_key.py
new file mode 100644
index 00000000000..e76d3ef432e
--- /dev/null
+++ b/products/workflows/backend/api/test/test_hog_flow_key.py
@@ -0,0 +1,163 @@
+from posthog.test.base import APIBaseTest
+from unittest.mock import patch
+
+from django.db.utils import IntegrityError
+
+from parameterized import parameterized
+
+from posthog.models import Organization, Team
+
+from products.workflows.backend.models.hog_flow.hog_flow import HogFlow
+
+TRIGGER_ACTION = {
+    "id": "trigger_node",
+    "name": "trigger_1",
+    "type": "trigger",
+    "config": {
+        "type": "event",
+        "filters": {"events": [{"id": "$pageview", "name": "$pageview", "type": "events", "order": 0}]},
+    },
+}
+
+
+class TestHogFlowKey(APIBaseTest):
+    def _payload(self, **overrides) -> dict:
+        return {"name": "Test Flow", "status": "draft", "actions": [TRIGGER_ACTION], **overrides}
+
+    def _create(self, **overrides):
+        return self.client.post(f"/api/projects/{self.team.id}/hog_flows", self._payload(**overrides))
+
+    def test_create_echoes_the_key_back(self):
+        response = self._create(key="onboarding-welcome")
+
+        assert response.status_code == 201, response.json()
+        assert response.json()["key"] == "onboarding-welcome"
+        assert HogFlow.objects.get(id=response.json()["id"]).key == "onboarding-welcome"
+
+    def test_create_without_a_key_leaves_it_null_and_never_collides(self):
+        # The column is nullable and the many existing key-less rows must stay creatable:
+        # NULLs are distinct under a Postgres unique index.
+        first = self._create()
+        second = self._create()
+
+        assert first.status_code == 201, first.json()
+        assert second.status_code == 201, second.json()
+        assert first.json()["key"] is None
+        assert second.json()["key"] is None
+
+    @parameterized.expand([("foo?bar=baz",), ("foo/bar",), ("foo\\bar",), ("foo.bar",), ("foo bar",)])
+    def test_create_with_an_invalid_charset_key_is_refused(self, key):
+        response = self._create(key=key)
+
+        assert response.status_code == 400
+        assert response.json() == {
+            "type": "validation_error",
+            "code": "invalid_key",
+            "detail": "Only letters, numbers, hyphens (-) & underscores (_) are allowed.",
+            "attr": "key",
+        }
+        assert not HogFlow.objects.filter(key=key).exists()
+
+    def test_create_with_a_key_already_taken_in_the_team_is_refused(self):
+        HogFlow.objects.create(team=self.team, name="Taken", created_by=self.user, key="onboarding-welcome")
+        count = HogFlow.objects.count()
+
+        response = self._create(key="onboarding-welcome")
+
+        assert response.status_code == 400
+        assert response.json() == {
+            "type": "validation_error",
+            "code": "unique",
+            "detail": "There is already a workflow with this key.",
+            "attr": "key",
+        }
+        assert HogFlow.objects.count() == count
+
+    def test_create_translates_a_concurrent_duplicate_key_into_the_same_field_error(self):
+        # A concurrent create can slip past the unlocked pre-check, so the constraint violation
+        # has to surface as the same 400 rather than a 500.
+        with patch(
+            "products.workflows.backend.api.hog_flow.HogFlow.objects.create",
+            side_effect=IntegrityError('duplicate key value violates unique constraint "unique_key_for_team"'),
+        ):
+            response = self._create(key="onboarding-welcome")
+
+        assert response.status_code == 400
+        assert response.json() == {
+            "type": "validation_error",
+            "code": "unique",
+            "detail": "There is already a workflow with this key.",
+            "attr": "key",
+        }
+
+    def test_a_key_taken_in_another_team_does_not_block_a_create(self):
+        other_team = Team.objects.create(organization=self.organization, name="Other")
+        HogFlow.objects.create(team=other_team, name="Theirs", key="onboarding-welcome")
+
+        response = self._create(key="onboarding-welcome")
+
+        assert response.status_code == 201, response.json()
+
+    def test_patch_that_changes_the_key_is_refused(self):
+        created = self._create(key="onboarding-welcome")
+        flow_id = created.json()["id"]
+
+        response = self.client.patch(f"/api/projects/{self.team.id}/hog_flows/{flow_id}", {"key": "something-else"})
+
+        assert response.status_code == 400
+        assert response.json()["attr"] == "key"
+        assert HogFlow.objects.get(id=flow_id).key == "onboarding-welcome"
+
+    def test_patch_that_clears_the_key_is_refused(self):
+        created = self._create(key="onboarding-welcome")
+        flow_id = created.json()["id"]
+
+        response = self.client.patch(f"/api/projects/{self.team.id}/hog_flows/{flow_id}", {"key": None})
+
+        assert response.status_code == 400
+        assert response.json()["attr"] == "key"
+        assert HogFlow.objects.get(id=flow_id).key == "onboarding-welcome"
+
+    def test_patch_that_sets_a_key_on_a_key_less_workflow_is_refused(self):
+        # Adoption is not in v1: a PATCH must not be a back door to claiming a key.
+        created = self._create()
+        flow_id = created.json()["id"]
+
+        response = self.client.patch(f"/api/projects/{self.team.id}/hog_flows/{flow_id}", {"key": "adopted"})
+
+        assert response.status_code == 400
+        assert response.json()["attr"] == "key"
+        assert HogFlow.objects.get(id=flow_id).key is None
+
+    def test_patch_that_repeats_the_stored_key_or_omits_it_is_allowed(self):
+        created = self._create(key="onboarding-welcome")
+        flow_id = created.json()["id"]
+
+        repeated = self.client.patch(
+            f"/api/projects/{self.team.id}/hog_flows/{flow_id}", {"key": "onboarding-welcome", "name": "Renamed"}
+        )
+        assert repeated.status_code == 200, repeated.json()
+
+        omitted = self.client.patch(f"/api/projects/{self.team.id}/hog_flows/{flow_id}", {"name": "Renamed again"})
+        assert omitted.status_code == 200, omitted.json()
+        assert HogFlow.objects.get(id=flow_id).key == "onboarding-welcome"
+
+    def test_list_filter_by_key_resolves_one_row_scoped_to_the_team(self):
+        mine = HogFlow.objects.create(team=self.team, name="Mine", created_by=self.user, key="onboarding-welcome")
+        HogFlow.objects.create(team=self.team, name="Other key", created_by=self.user, key="winback")
+        other_org = Organization.objects.create(name="Other org")
+        other_team = Team.objects.create(organization=other_org, name="Other")
+        HogFlow.objects.create(team=other_team, name="Theirs", key="onboarding-welcome")
+
+        response = self.client.get(f"/api/projects/{self.team.id}/hog_flows?key=onboarding-welcome")
+
+        assert response.status_code == 200, response.json()
+        assert [flow["id"] for flow in response.json()["results"]] == [str(mine.id)]
+
+    def test_list_filter_by_an_unknown_key_returns_nothing(self):
+        HogFlow.objects.create(team=self.team, name="Mine", created_by=self.user, key="onboarding-welcome")
+
+        response = self.client.get(f"/api/projects/{self.team.id}/hog_flows?key=not-here")
+
+        assert response.status_code == 200, response.json()
+        assert response.json()["results"] == []
diff --git a/products/workflows/backend/migrations/0026_hogflow_key.py b/products/workflows/backend/migrations/0026_hogflow_key.py
new file mode 100644
index 00000000000..0a8a68246e4
--- /dev/null
+++ b/products/workflows/backend/migrations/0026_hogflow_key.py
@@ -0,0 +1,20 @@
+from django.db import migrations, models
+
+
+class Migration(migrations.Migration):
+    dependencies = [
+        ("workflows", "0025_hogflow_email_sending_paused_by"),
+    ]
+
+    operations = [
+        migrations.AddField(
+            model_name="hogflow",
+            name="key",
+            field=models.CharField(
+                blank=True,
+                help_text="Client-chosen identifier, unique within the project. Set only when creating a workflow. Filter the list with `?key=`. Letters, numbers, hyphens (-) and underscores (_) only.",
+                max_length=400,
+                null=True,
+            ),
+        ),
+    ]
diff --git a/products/workflows/backend/migrations/0027_hogflow_unique_key_for_team.py b/products/workflows/backend/migrations/0027_hogflow_unique_key_for_team.py
new file mode 100644
index 00000000000..0bf02beb942
--- /dev/null
+++ b/products/workflows/backend/migrations/0027_hogflow_unique_key_for_team.py
@@ -0,0 +1,35 @@
+from django.db import migrations, models
+
+from posthog.migration_helpers import CreateIndexConcurrently
+
+
+class Migration(migrations.Migration):
+    # Required by CreateIndexConcurrently, and why the column it indexes is added in 0026 instead.
+    atomic = False
+
+    dependencies = [
+        ("workflows", "0026_hogflow_key"),
+    ]
+
+    operations = [
+        # A unique constraint compiles to a unique index, which Django's AddConstraint builds under
+        # an ACCESS EXCLUSIVE lock. Build the index concurrently instead and record only the
+        # constraint in Django's state. No WHERE clause: Postgres treats NULLs as distinct, so the
+        # existing key-less rows cannot collide with each other.
+        migrations.SeparateDatabaseAndState(
+            state_operations=[
+                migrations.AddConstraint(
+                    model_name="hogflow",
+                    constraint=models.UniqueConstraint(fields=("team", "key"), name="unique_key_for_team"),
+                ),
+            ],
+            database_operations=[
+                CreateIndexConcurrently(
+                    index_name="unique_key_for_team",
+                    table_name="posthog_hogflow",
+                    columns="(team_id, key)",
+                    unique=True,
+                ),
+            ],
+        ),
+    ]
diff --git a/products/workflows/backend/migrations/max_migration.txt b/products/workflows/backend/migrations/max_migration.txt
index 4aa215fa754..4adc93b62ff 100644
--- a/products/workflows/backend/migrations/max_migration.txt
+++ b/products/workflows/backend/migrations/max_migration.txt
@@ -1 +1 @@
-0025_hogflow_email_sending_paused_by
+0027_hogflow_unique_key_for_team
diff --git a/products/workflows/backend/models/hog_flow/hog_flow.py b/products/workflows/backend/models/hog_flow/hog_flow.py
index 9c47602a2d4..6871a6c24a7 100644
--- a/products/workflows/backend/models/hog_flow/hog_flow.py
+++ b/products/workflows/backend/models/hog_flow/hog_flow.py
@@ -121,6 +121,8 @@ class HogFlow(UUIDTModel):
 
         constraints = [
             models.UniqueConstraint(fields=["team", "version", "id"], name="unique_version_per_flow"),
+            # No condition: Postgres treats NULLs as distinct, so the key-less rows never collide.
+            models.UniqueConstraint(fields=["team", "key"], name="unique_key_for_team"),
         ]
 
     class State(models.TextChoices):
@@ -138,6 +140,15 @@ class HogFlow(UUIDTModel):
         LOOPS = "loops", "Loops"
 
     name = models.CharField(max_length=400, null=True, blank=True)
+    # The identity a source file carries, so a client can find the workflow it owns without
+    # knowing the server-minted UUID. Null for workflows built in the UI or over the API.
+    key = models.CharField(
+        max_length=400,
+        null=True,
+        blank=True,
+        help_text="Client-chosen identifier, unique within the project. Set only when creating a workflow. "
+        "Filter the list with `?key=`. Letters, numbers, hyphens (-) and underscores (_) only.",
+    )
     description = models.TextField(blank=True, default="")
     version = models.IntegerField(default=1)
     team = models.ForeignKey("posthog.Team", on_delete=models.CASCADE)
diff --git a/products/workflows/frontend/generated/api.schemas.ts b/products/workflows/frontend/generated/api.schemas.ts
index 9161204324f..3c261759d6c 100644
--- a/products/workflows/frontend/generated/api.schemas.ts
+++ b/products/workflows/frontend/generated/api.schemas.ts
@@ -578,6 +578,12 @@ export interface HogFlowScheduleApi {
  */
 export interface HogFlowApi {
     readonly id: string
+    /**
+     * Client-chosen identifier, unique within the project. Set only when creating a workflow. Filter the list with `?key=`. Letters, numbers, hyphens (-) and underscores (_) only.
+     * @maxLength 400
+     * @nullable
+     */
+    key?: string | null
     /**
      * Workflow name.
      * @maxLength 400
@@ -676,6 +682,11 @@ export type HogFlowUpdateApiActionRedirects = { [key: string]: string } | null
  */
 export interface HogFlowUpdateApi {
     readonly id: string
+    /**
+     * Client-chosen identifier, unique within the project. This value cannot change after creation.
+     * @nullable
+     */
+    readonly key: string | null
     /**
      * Workflow name.
      * @maxLength 400
@@ -774,6 +785,11 @@ export type PatchedHogFlowUpdateApiActionRedirects = { [key: string]: string } |
  */
 export interface PatchedHogFlowUpdateApi {
     readonly id?: string
+    /**
+     * Client-chosen identifier, unique within the project. This value cannot change after creation.
+     * @nullable
+     */
+    readonly key?: string | null
     /**
      * Workflow name.
      * @maxLength 400
@@ -1781,6 +1797,7 @@ export type HogFlowsListParams = {
      */
     created_by?: string
     id?: string
+    key?: string
     /**
      * Number of results to return per page.
      */
diff --git a/products/workflows/frontend/generated/api.zod.ts b/products/workflows/frontend/generated/api.zod.ts
index 00bfdd83373..efc476fcd75 100644
--- a/products/workflows/frontend/generated/api.zod.ts
+++ b/products/workflows/frontend/generated/api.zod.ts
@@ -400,6 +400,8 @@ export const HogFlowTemplatesPartialUpdateBody = /* @__PURE__ */ zod
         'Serializer for creating hog flow templates.\nValidates and sanitizes the workflow before creating it as a template.'
     )
 
+export const hogFlowsCreateBodyKeyMax = 400
+
 export const hogFlowsCreateBodyNameMax = 400
 
 export const hogFlowsCreateBodyDescriptionDefault = ``
@@ -423,6 +425,13 @@ export const hogFlowsCreateBodyActionsItemConfigTwoEventsItemFiltersOneSourceDef
 
 export const HogFlowsCreateBody = /* @__PURE__ */ zod
     .object({
+        key: zod
+            .string()
+            .max(hogFlowsCreateBodyKeyMax)
+            .nullish()
+            .describe(
+                'Client-chosen identifier, unique within the project. Set only when creating a workflow. Filter the list with `?key=`. Letters, numbers, hyphens (-) and underscores (_) only.'
+            ),
         name: zod.string().max(hogFlowsCreateBodyNameMax).nullish().describe('Workflow name.'),
         description: zod.string().default(hogFlowsCreateBodyDescriptionDefault).describe('Optional description.'),
         status: zod
@@ -1787,6 +1796,8 @@ export const HogFlowsGraphPartialUpdateBody = /* @__PURE__ */ zod.object({
         ),
 })
 
+export const hogFlowsInvocationsCreateBodyConfigurationOneKeyMax = 400
+
 export const hogFlowsInvocationsCreateBodyConfigurationOneNameMax = 400
 
 export const hogFlowsInvocationsCreateBodyConfigurationOneDescriptionDefault = ``
@@ -1826,6 +1837,13 @@ export const HogFlowsInvocationsCreateBody = /* @__PURE__ */ zod.object({
     configuration: zod
         .object({
             id: zod.uuid(),
+            key: zod
+                .string()
+                .max(hogFlowsInvocationsCreateBodyConfigurationOneKeyMax)
+                .nullish()
+                .describe(
+                    'Client-chosen identifier, unique within the project. Set only when creating a workflow. Filter the list with `?key=`. Letters, numbers, hyphens (-) and underscores (_) only.'
+                ),
             name: zod
                 .string()
                 .max(hogFlowsInvocationsCreateBodyConfigurationOneNameMax)
@@ -2584,6 +2602,8 @@ export const HogFlowsSchedulesPartialUpdateBody = /* @__PURE__ */ zod.object({
         .describe('Variable value overrides merged with the workflow defaults on each run.'),
 })
 
+export const hogFlowsBulkDeleteCreateBodyKeyMax = 400
+
 export const hogFlowsBulkDeleteCreateBodyNameMax = 400
 
 export const hogFlowsBulkDeleteCreateBodyDescriptionDefault = ``
@@ -2609,6 +2629,13 @@ export const hogFlowsBulkDeleteCreateBodyActionsItemConfigTwoEventsItemFiltersOn
 
 export const HogFlowsBulkDeleteCreateBody = /* @__PURE__ */ zod
     .object({
+        key: zod
+            .string()
+            .max(hogFlowsBulkDeleteCreateBodyKeyMax)
+            .nullish()
+            .describe(
+                'Client-chosen identifier, unique within the project. Set only when creating a workflow. Filter the list with `?key=`. Letters, numbers, hyphens (-) and underscores (_) only.'
+            ),
         name: zod.string().max(hogFlowsBulkDeleteCreateBodyNameMax).nullish().describe('Workflow name.'),
         description: zod
             .string()
diff --git a/services/mcp/src/api/generated.ts b/services/mcp/src/api/generated.ts
index 9eed3723bc4..3ff886a53d6 100644
--- a/services/mcp/src/api/generated.ts
+++ b/services/mcp/src/api/generated.ts
@@ -46193,6 +46193,12 @@ export namespace Schemas {
      */
     export interface HogFlow {
       readonly id: string;
+      /**
+         * Client-chosen identifier, unique within the project. Set only when creating a workflow. Filter the list with `?key=`. Letters, numbers, hyphens (-) and underscores (_) only.
+         * @maxLength 400
+         * @nullable
+         */
+      key?: string | null;
       /**
          * Workflow name.
          * @maxLength 400
@@ -46661,6 +46667,11 @@ export namespace Schemas {
      */
     export interface HogFlowUpdate {
       readonly id: string;
+      /**
+         * Client-chosen identifier, unique within the project. This value cannot change after creation.
+         * @nullable
+         */
+      readonly key: string | null;
       /**
          * Workflow name.
          * @maxLength 400
@@ -69340,6 +69351,11 @@ export namespace Schemas {
      */
     export interface PatchedHogFlowUpdate {
       readonly id?: string;
+      /**
+         * Client-chosen identifier, unique within the project. This value cannot change after creation.
+         * @nullable
+         */
+      readonly key?: string | null;
       /**
          * Workflow name.
          * @maxLength 400
@@ -104768,6 +104784,7 @@ export namespace Schemas {
      */
     created_by?: string;
     id?: string;
+    key?: string;
     /**
      * Number of results to return per page.
      */
diff --git a/services/mcp/src/generated/workflows/api.ts b/services/mcp/src/generated/workflows/api.ts
index 2d8ecd5321a..95047e3301d 100644
--- a/services/mcp/src/generated/workflows/api.ts
+++ b/services/mcp/src/generated/workflows/api.ts
@@ -20,6 +20,7 @@ export const HogFlowsListQueryParams = () => zod.object({
     created_at: zod.iso.datetime({ offset: true }).optional(),
     created_by: zod.string().optional().describe('Filter to workflows created by the user with this uuid.'),
     id: zod.string().optional(),
+    key: zod.string().optional(),
     limit: zod.number().optional().describe('Number of results to return per page.'),
     offset: zod.number().optional().describe('The initial index from which to return the results.'),
     origin_product: zod
@@ -59,6 +60,8 @@ export const HogFlowsCreateParams = () => zod.object({
         ),
 })
 
+export const hogFlowsCreateBodyKeyMax = 400
+
 export const hogFlowsCreateBodyNameMax = 400
 
 export const hogFlowsCreateBodyDescriptionDefault = ``
@@ -82,6 +85,13 @@ export const hogFlowsCreateBodyActionsItemConfigTwoEventsItemFiltersOneSourceDef
 
 export const HogFlowsCreateBody = () => zod
     .object({
+        key: zod
+            .string()
+            .max(hogFlowsCreateBodyKeyMax)
+            .nullish()
+            .describe(
+                'Client-chosen identifier, unique within the project. Set only when creating a workflow. Filter the list with `?key=`. Letters, numbers, hyphens (-) and underscores (_) only.'
+            ),
         name: zod.string().max(hogFlowsCreateBodyNameMax).nullish().describe('Workflow name.'),
         description: zod.string().default(hogFlowsCreateBodyDescriptionDefault).describe('Optional description.'),
         status: zod
diff --git a/services/mcp/src/tools/generated/workflows.ts b/services/mcp/src/tools/generated/workflows.ts
index a54deace522..e73ee77e18a 100644
--- a/services/mcp/src/tools/generated/workflows.ts
+++ b/services/mcp/src/tools/generated/workflows.ts
@@ -20,6 +20,9 @@ const workflowsCreate = (): ToolBase<ReturnType<typeof WorkflowsCreateSchema>, W
         handler: async (context: Context, params: z.infer<ReturnType<typeof WorkflowsCreateSchema>>) => {
             const projectId = await context.stateManager.getProjectId()
             const body: Record<string, unknown> = {}
+            if (params.key !== undefined) {
+                body['key'] = params.key
+            }
             if (params.name !== undefined) {
                 body['name'] = params.name
             }
@@ -185,6 +188,7 @@ const workflowsList = (): ToolBase<
                     created_at: params.created_at,
                     created_by: params.created_by,
                     id: params.id,
+                    key: params.key,
                     limit: params.limit,
                     offset: params.offset,
                     origin_product: params.origin_product,

```

## How to score

Score every diff (X, Y, Z, W, V) from 1 (poor) to 10 (excellent) on each dimension, and justify every score in one to three sentences that cite files or imports from the diff:

- `seams`: Seams and interfaces: does the change cross module boundaries through deliberate, narrow interfaces?
- `cohesion`: Cohesion and module placement: does each new piece of code live in the module that owns its concern?
- `coupling`: Coupling: does the change avoid new dependencies, and reaching into other modules' internals?
- `fit`: Repository architecture fit: does the change follow PostHog's documented product architecture (products/architecture.md)?
- `overall`: Overall architecture quality of the change, as a reviewer who owns this codebase would rate it.

Judge architecture, not completeness of features or test coverage. A diff that is truncated here was truncated for length; judge what you can see and its file list. Answer with JSON only, matching the schema you were given.