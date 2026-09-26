You are reviewing the architecture of independent implementations of the same task in the PostHog monorepo. Each implementation is a diff against the repository as it was before the change. You do not know who or what wrote them; judge only the diffs. Everything you need is in this prompt: do not run commands or read files.

## Task

![image.png](t3-context://v1/image/image_fd0a47cc-4bd9-4139-b4be-163b45289f9e) 
Add a workflows quick button under the home screen search box, and let's also brainstorm some suggestions here, which you could query for:
- Getting a list of existing workflows
- Maybe last email runs
- Creating new workflows
We give a new entry point for users and potentially increase growth and onboarding to our workflows product.

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
- frontend/src/scenes/max/suggestionTopics.tsx (modified, +29 -0)

```diff
diff --git a/frontend/src/scenes/max/suggestionTopics.tsx b/frontend/src/scenes/max/suggestionTopics.tsx
index f732cf76d2de..36434d1745a0 100644
--- a/frontend/src/scenes/max/suggestionTopics.tsx
+++ b/frontend/src/scenes/max/suggestionTopics.tsx
@@ -293,5 +293,34 @@ export const HOMEPAGE_SUGGESTION_TOPICS: SuggestionTopic[] = [
             },
         ],
     },
+    {
+        key: 'workflows',
+        label: 'Workflows',
+        iconType: 'workflows',
+        suggestions: [
+            {
+                title: 'List your workflows',
+                description: 'See what is running and what is still a draft',
+                content: 'List my workflows and show which ones are active',
+            },
+            {
+                title: 'Review recent email runs',
+                description: 'Sends, opens, and failures from the last week',
+                content: 'How did my workflow emails perform over the last 7 days, and did any runs fail?',
+            },
+            {
+                title: 'Create a workflow',
+                description: 'Automate messages and actions from your events',
+                content: 'Create a workflow that',
+                requiresUserInput: true,
+                hint: 'describe what should trigger it and what should happen',
+            },
+            {
+                title: 'Send a welcome email',
+                description: 'Onboard new users the moment they sign up',
+                content: 'Create a workflow that sends a welcome email when a user signs up',
+            },
+        ],
+    },
     LEARN_TOPIC,
 ]

```

## Diff Y

Files:
- frontend/src/scenes/max/suggestionTopics.tsx (modified, +29 -0)

```diff
diff --git a/frontend/src/scenes/max/suggestionTopics.tsx b/frontend/src/scenes/max/suggestionTopics.tsx
index f732cf76d2de..347736c44562 100644
--- a/frontend/src/scenes/max/suggestionTopics.tsx
+++ b/frontend/src/scenes/max/suggestionTopics.tsx
@@ -293,5 +293,34 @@ export const HOMEPAGE_SUGGESTION_TOPICS: SuggestionTopic[] = [
             },
         ],
     },
+    {
+        key: 'workflows',
+        label: 'Workflows',
+        iconType: 'workflows',
+        suggestions: [
+            {
+                title: 'See your workflows',
+                description: "What's live, what's in draft, and what each one does",
+                content: 'List my workflows and summarize what each one does',
+            },
+            {
+                title: 'Review recent email runs',
+                description: 'Sends and failures from the last 7 days',
+                content: 'How did my workflows and their emails perform over the last 7 days? Flag any that are failing',
+            },
+            {
+                title: 'Create a workflow',
+                description: 'Automate messages triggered by user behavior',
+                content: 'Create a workflow that',
+                requiresUserInput: true,
+                hint: 'describe who it should reach and what it should send',
+            },
+            {
+                title: 'Send a welcome email',
+                description: 'Onboard new users the moment they sign up',
+                content: 'Create a draft workflow that sends a welcome email to new users when they sign up',
+            },
+        ],
+    },
     LEARN_TOPIC,
 ]

```

## Diff Z

Files:
- frontend/src/scenes/max/suggestionTopics.tsx (modified, +29 -0)

```diff
diff --git a/frontend/src/scenes/max/suggestionTopics.tsx b/frontend/src/scenes/max/suggestionTopics.tsx
index f732cf76d2de..e956038caac3 100644
--- a/frontend/src/scenes/max/suggestionTopics.tsx
+++ b/frontend/src/scenes/max/suggestionTopics.tsx
@@ -293,5 +293,34 @@ export const HOMEPAGE_SUGGESTION_TOPICS: SuggestionTopic[] = [
             },
         ],
     },
+    {
+        key: 'workflows',
+        label: 'Workflows',
+        iconType: 'workflows',
+        suggestions: [
+            {
+                title: 'Review your workflows',
+                description: "What's live, what's a draft, and what each one does",
+                content: 'List my workflows, whether each one is live or a draft, and summarize what each one does',
+            },
+            {
+                title: 'Check recent email runs',
+                description: 'Latest sends and anything that failed',
+                content: 'Show me the most recent email runs from my workflows and flag any that failed',
+            },
+            {
+                title: 'Create a workflow',
+                description: 'Automate emails and actions from user behavior',
+                content: 'Create a workflow that',
+                requiresUserInput: true,
+                hint: 'type who it targets and what it should do',
+            },
+            {
+                title: 'Set up onboarding emails',
+                description: 'Welcome new users with a drip sequence',
+                content: 'Create a workflow that sends a welcome email series to new users after they sign up',
+            },
+        ],
+    },
     LEARN_TOPIC,
 ]

```

## Diff W

Files:
- frontend/src/scenes/max/suggestionTopics.tsx (modified, +29 -0)
- frontend/src/scenes/project-homepage/ai-first/homepageSuggestions.test.ts (modified, +23 -1)

```diff
diff --git a/frontend/src/scenes/max/suggestionTopics.tsx b/frontend/src/scenes/max/suggestionTopics.tsx
index f732cf76d2de..899bb757d690 100644
--- a/frontend/src/scenes/max/suggestionTopics.tsx
+++ b/frontend/src/scenes/max/suggestionTopics.tsx
@@ -293,5 +293,34 @@ export const HOMEPAGE_SUGGESTION_TOPICS: SuggestionTopic[] = [
             },
         ],
     },
+    {
+        key: 'workflows',
+        label: 'Workflows',
+        iconType: 'workflows',
+        suggestions: [
+            {
+                title: 'See your workflows',
+                description: "What's live, what's in draft, and what each one does",
+                content: 'List my workflows and summarize which are active and what each one does',
+            },
+            {
+                title: 'Check recent email sends',
+                description: 'The latest messages your workflows sent',
+                content: 'Show me the most recent email sends from my workflows and whether any failed',
+            },
+            {
+                title: 'Create a workflow',
+                description: 'Automate emails and actions for your users',
+                content: 'Create a workflow that',
+                requiresUserInput: true,
+                hint: 'describe who it should reach and what it should do',
+            },
+            {
+                title: 'Review workflow performance',
+                description: 'Sends, failures, and trends across workflows',
+                content: 'How are my workflows performing? Summarize sends and failures over the last 30 days',
+            },
+        ],
+    },
     LEARN_TOPIC,
 ]
diff --git a/frontend/src/scenes/project-homepage/ai-first/homepageSuggestions.test.ts b/frontend/src/scenes/project-homepage/ai-first/homepageSuggestions.test.ts
index 7e3f3ec77565..da40747a9d4b 100644
--- a/frontend/src/scenes/project-homepage/ai-first/homepageSuggestions.test.ts
+++ b/frontend/src/scenes/project-homepage/ai-first/homepageSuggestions.test.ts
@@ -1,7 +1,9 @@
+import { HOMEPAGE_SUGGESTION_TOPICS } from 'scenes/max/suggestionTopics'
+
 import { FileSystemEntry } from '~/queries/schema/schema-general'
 import { Conversation, ConversationStatus, ConversationType } from '~/types'
 
-import { SUGGESTIONS_LIMIT, buildSuggestionItems } from './homepageSuggestions'
+import { SUGGESTIONS_LIMIT, buildSuggestionItems, topicSuggestionItems } from './homepageSuggestions'
 
 const conversation: Conversation = {
     id: 'conv-1',
@@ -52,3 +54,23 @@ describe('buildSuggestionItems', () => {
         expect(items.every((item) => item.source === 'static')).toBe(true)
     })
 })
+
+describe('topicSuggestionItems', () => {
+    it('offers the Workflows badge with its prompts, the create prompt as a fill-in', () => {
+        const topic = HOMEPAGE_SUGGESTION_TOPICS.find((t) => t.key === 'workflows')
+        expect(topic).toBeDefined()
+
+        const items = topicSuggestionItems(topic!)
+
+        expect(items).toHaveLength(SUGGESTIONS_LIMIT)
+        expect(items.every((item) => item.itemType === 'workflows')).toBe(true)
+        expect(items.map((item) => item.label)).toEqual([
+            'See your workflows',
+            'Check recent email sends',
+            'Create a workflow',
+            'Review workflow performance',
+        ])
+        expect(items[2]).toMatchObject({ prompt: 'Create a workflow that', fillInHint: expect.any(String) })
+        expect(items.filter((item) => item.fillInHint)).toHaveLength(1)
+    })
+})

```

## Diff V

Files:
- ee/hogai/context/entity_search/context.py (modified, +12 -0)
- ee/hogai/context/entity_search/test/test_context.py (modified, +25 -0)
- ee/hogai/tools/search.py (modified, +2 -2)
- frontend/src/scenes/max/suggestionTopics.test.ts (added, +17 -0)
- frontend/src/scenes/max/suggestionTopics.tsx (modified, +27 -0)

```diff
diff --git a/ee/hogai/context/entity_search/context.py b/ee/hogai/context/entity_search/context.py
index be22d05c21f3..3d1f8656d509 100644
--- a/ee/hogai/context/entity_search/context.py
+++ b/ee/hogai/context/entity_search/context.py
@@ -38,6 +38,7 @@ from products.feature_flags.backend.models.feature_flag import FeatureFlag
 from products.notebooks.backend.models import Notebook
 from products.product_analytics.backend.facade.models import Insight
 from products.surveys.backend.models import Survey
+from products.workflows.backend.models import HogFlow
 
 from ee.hogai.artifacts.handlers.base import get_handler_for_content_type
 from ee.hogai.context.context import AssistantContextManager
@@ -54,6 +55,7 @@ class EntityKind(StrEnum):
     SURVEYS = "surveys"
     ALERTS = "alerts"
     ACCOUNTS = "accounts"
+    WORKFLOWS = "workflows"
     ALL = "all"
 
 
@@ -68,6 +70,7 @@ SEARCH_KIND_TO_DATABASE_ENTITY_TYPE: dict[EntityKind, str] = {
     EntityKind.SURVEYS: "survey",
     EntityKind.ALERTS: "alert_configuration",
     EntityKind.ACCOUNTS: "account",
+    EntityKind.WORKFLOWS: "hog_flow",
 }
 
 ENTITY_MAP: dict[str, EntityConfig] = {
@@ -120,6 +123,13 @@ ENTITY_MAP: dict[str, EntityConfig] = {
         "extra_fields": ["title", "text_content"],
         "filters": {"deleted": False},
     },
+    "hog_flow": {
+        "klass": HogFlow,
+        "search_fields": {"name": "A", "description": "C"},
+        "extra_fields": ["name", "description", "status"],
+        # Archived is the workflow equivalent of deleted; drafts stay visible so the agent can tell them apart
+        "filters": {"status__in": [HogFlow.State.DRAFT, HogFlow.State.ACTIVE]},
+    },
 }
 """
 Map of entity names to their class, search_fields and extra_fields.
@@ -546,6 +556,8 @@ class EntitySearchContext:
                 return f"{base_url}/error_tracking/{result_id}"
             case "alert_configuration":
                 return f"{base_url}/alerts?alert_id={result_id}"
+            case "hog_flow":
+                return f"{base_url}/workflows/{result_id}/workflow"
             case "account":
                 # Deep-link to the specific account (filtered + expanded) rather than the bare list.
                 return f"{base_url}{build_account_deeplink(account_id=result_id)}"
diff --git a/ee/hogai/context/entity_search/test/test_context.py b/ee/hogai/context/entity_search/test/test_context.py
index 630a337ebaff..3cdb4fe8b388 100644
--- a/ee/hogai/context/entity_search/test/test_context.py
+++ b/ee/hogai/context/entity_search/test/test_context.py
@@ -24,6 +24,7 @@ from products.feature_flags.backend.models.feature_flag import FeatureFlag
 from products.product_analytics.backend.facade.api import record_insight_views
 from products.product_analytics.backend.facade.models import Insight
 from products.surveys.backend.models import Survey
+from products.workflows.backend.models import HogFlow
 
 from ee.hogai.context import AssistantContextManager
 from ee.hogai.context.entity_search import EntitySearchContext
@@ -59,6 +60,7 @@ class TestEntitySearchContext(NonAtomicBaseTest):
             ("notebook", "test_notebook_id", "/project/{team_id}/notebooks/test_notebook_id"),
             ("alert_configuration", "test_alert_id", "/project/{team_id}/alerts?alert_id=test_alert_id"),
             ("account", "test_account_id", "/project/{team_id}/customer_analytics/accounts/test_account_id"),
+            ("hog_flow", "test_flow_id", "/project/{team_id}/workflows/test_flow_id/workflow"),
         ]
     )
     def test_build_url(self, entity_type, result_id, expected_path):
@@ -332,6 +334,9 @@ class TestEntitySearchContext(NonAtomicBaseTest):
             created_by=self.user,
             type=Survey.SurveyType.POPOVER,
         )
+        await HogFlow.objects.acreate(
+            team=self.team, name="deleted workflow", status=HogFlow.State.ARCHIVED, created_by=self.user
+        )
 
         results, _ = await self.context.search_entities("all", "deleted")
 
@@ -341,6 +346,7 @@ class TestEntitySearchContext(NonAtomicBaseTest):
         assert "deleted action" not in result_names
         assert "deleted cohort" not in result_names
         assert "archived survey" not in result_names
+        assert "deleted workflow" not in result_names
 
     async def test_list_entities_insight(self):
         insight1 = await Insight.objects.acreate(
@@ -403,6 +409,25 @@ class TestEntitySearchContext(NonAtomicBaseTest):
         assert total == 1
         assert entities[0]["extra_fields"]["name"] == "List Dashboard"
 
+    async def test_list_entities_workflow_surfaces_status_and_hides_archived(self):
+        await HogFlow.objects.acreate(
+            team=self.team, name="welcome email", status=HogFlow.State.ACTIVE, created_by=self.user
+        )
+        await HogFlow.objects.acreate(
+            team=self.team, name="win-back draft", status=HogFlow.State.DRAFT, created_by=self.user
+        )
+        await HogFlow.objects.acreate(
+            team=self.team, name="old campaign", status=HogFlow.State.ARCHIVED, created_by=self.user
+        )
+
+        results, total_count = await self.context.list_entities("hog_flow")
+
+        assert total_count == 2
+        assert {(r["extra_fields"]["name"], r["extra_fields"]["status"]) for r in results} == {
+            ("welcome email", "active"),
+            ("win-back draft", "draft"),
+        }
+
     async def test_list_entities_account(self):
         account = await Account.objects.unscoped().acreate(team=self.team, name="Acme Corp", external_id="acme-1")
 
diff --git a/ee/hogai/tools/search.py b/ee/hogai/tools/search.py
index b1aa8b51a840..0058b3c22c72 100644
--- a/ee/hogai/tools/search.py
+++ b/ee/hogai/tools/search.py
@@ -26,7 +26,7 @@ from ee.hogai.utils.helpers import sanitize_for_system_reminder
 logger = structlog.get_logger(__name__)
 
 SEARCH_TOOL_PROMPT = """
-Use this tool to search docs, insights, dashboards, cohorts, actions, experiments, feature flags, notebooks, and surveys in PostHog.
+Use this tool to search docs, insights, dashboards, cohorts, actions, experiments, feature flags, notebooks, surveys, and workflows in PostHog.
 
 If the user's question mentions multiple topics, search for each topic separately and combine the results.
 
@@ -118,7 +118,7 @@ class InkeepResponse(BaseModel):
 class SearchTool(MaxTool):
     name: Literal["search"] = "search"
     description: str = SEARCH_TOOL_PROMPT
-    context_prompt_template: str = "Searches documentation, insights, dashboards, cohorts, actions, experiments, feature flags, notebooks, and surveys in PostHog"
+    context_prompt_template: str = "Searches documentation, insights, dashboards, cohorts, actions, experiments, feature flags, notebooks, surveys, and workflows in PostHog"
     args_schema: type[BaseModel] = SearchToolArgs
 
     _has_business_knowledge: bool = False
diff --git a/frontend/src/scenes/max/suggestionTopics.test.ts b/frontend/src/scenes/max/suggestionTopics.test.ts
new file mode 100644
index 000000000000..030b05f15efd
--- /dev/null
+++ b/frontend/src/scenes/max/suggestionTopics.test.ts
@@ -0,0 +1,17 @@
+import { HOMEPAGE_SUGGESTION_TOPICS } from './suggestionTopics'
+
+describe('HOMEPAGE_SUGGESTION_TOPICS', () => {
+    const cardTopics = HOMEPAGE_SUGGESTION_TOPICS.filter((topic) => (topic.variant ?? 'cards') === 'cards')
+
+    // Every card topic renders the same number of cards, so toggling a badge never changes the grid height
+    it.each(cardTopics.map((topic) => [topic.key, topic]))('%s has exactly 4 card suggestions', (_, topic) => {
+        expect(topic.suggestions).toHaveLength(4)
+    })
+
+    it('pairs every fill-in prompt with a hint and gives every complete prompt none', () => {
+        const suggestions = HOMEPAGE_SUGGESTION_TOPICS.flatMap((topic) => topic.suggestions)
+        for (const suggestion of suggestions) {
+            expect(!!suggestion.requiresUserInput).toBe(!!suggestion.hint)
+        }
+    })
+})
diff --git a/frontend/src/scenes/max/suggestionTopics.tsx b/frontend/src/scenes/max/suggestionTopics.tsx
index f732cf76d2de..707bd8030fc9 100644
--- a/frontend/src/scenes/max/suggestionTopics.tsx
+++ b/frontend/src/scenes/max/suggestionTopics.tsx
@@ -293,5 +293,32 @@ export const HOMEPAGE_SUGGESTION_TOPICS: SuggestionTopic[] = [
             },
         ],
     },
+    {
+        key: 'workflows',
+        label: 'Workflows',
+        iconType: 'workflows',
+        suggestions: [
+            {
+                title: 'Build your first workflow',
+                description: 'What workflows do and how to set one up',
+                content: 'How do I create my first workflow in PostHog?',
+            },
+            {
+                title: 'Review your workflows',
+                description: 'What each active and draft workflow does',
+                content: 'List my workflows and summarize what each active one does',
+            },
+            {
+                title: 'Send an email from a workflow',
+                description: 'Add an email step and a template',
+                content: 'How do I send an email from a PostHog workflow?',
+            },
+            {
+                title: 'Test before you publish',
+                description: 'Run a workflow against a test event first',
+                content: 'How do I test a workflow before publishing it?',
+            },
+        ],
+    },
     LEARN_TOPIC,
 ]

```

## How to score

Score every diff (X, Y, Z, W, V) from 1 (poor) to 10 (excellent) on each dimension, and justify every score in one to three sentences that cite files or imports from the diff:

- `seams`: Seams and interfaces: does the change cross module boundaries through deliberate, narrow interfaces?
- `cohesion`: Cohesion and module placement: does each new piece of code live in the module that owns its concern?
- `coupling`: Coupling: does the change avoid new dependencies, and reaching into other modules' internals?
- `fit`: Repository architecture fit: does the change follow PostHog's documented product architecture (products/architecture.md)?
- `overall`: Overall architecture quality of the change, as a reviewer who owns this codebase would rate it.

Judge architecture, not completeness of features or test coverage. A diff that is truncated here was truncated for length; judge what you can see and its file list. Answer with JSON only, matching the schema you were given.