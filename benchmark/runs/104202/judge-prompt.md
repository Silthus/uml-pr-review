You are reviewing the architecture of independent implementations of the same task in the PostHog monorepo. Each implementation is a diff against the repository as it was before the change. You do not know who or what wrote them; judge only the diffs. Everything you need is in this prompt: do not run commands or read files.

## Task

Part of #68. Locked by Michael on 2026-09-22 after the research on #104: v1 pushes from CI with the project secret API key (PSAK) that already exists on the project, not with a personal API key.

## What to build

`HogFlowViewSet` accepts a project secret API key (`phs_...`, `Authorization: Bearer`) for the actions a push needs: `list` (the `?key=` resolve), `retrieve`, `create`, `update` and `partial_update`. Nothing else: no delete, no bulk delete, no publish or invocation actions. Follow the skill `adding-project-secret-api-key-auth` exactly: the `hog_flow` scope joins the PSAK scope allowlist, the viewset gets the PSAK authenticator, `psak_allowed_actions`, and a PSAK-aware throttle, in the shape `products/feature_flags/backend/api/feature_flag.py` and `products/endpoints/backend/presentation/views/api.py` already use.

A PSAK request carries a synthetic user (`ProjectSecretAPIKeyUser`). Find every place the create and update paths assume a real user and make them hold: `created_by` on `HogFlow`, `created_by` on `HogFlowRevision`, `log_activity_from_viewset`, `_report_workflow_action`, and the `_emit_resource_edited` call. Store `None` where the model allows it and say so in the activity detail; never crash and never invent a user.

Compatibility with the read-only PR ([PostHog/posthog#103540](https://github.com/PostHog/posthog/pull/103540)): its guard `is_code_managed_writer` classifies by `User-Agent` event source, so a PSAK request from the CLI (`posthog-workflows/<version>`, event source `api`) passes unchanged. State this in the PR body; do not touch that branch.

## Write scope

- `products/workflows/backend/api/hog_flow.py`
- The PSAK scope allowlist module the skill names
- `products/workflows/backend/api/test/test_hog_flow_psak_auth.py` (new)
- `products/workflows/CONTRIBUTING.md` (one paragraph on which key a CI push may use)

## Proof gate

- [ ] Red: `POST`, `PATCH` and `GET ?key=` with a `phs_` key return 401 or 403 before the change; green after, with the key echoed and the row created with `created_by` null
- [ ] A PSAK `DELETE` and a PSAK `POST .../bulk_delete` stay refused
- [ ] A PSAK for team A cannot read or write team B's workflow
- [ ] Revision 1 is written on a PSAK create with `created_by` null (depends on PostHog/posthog#104156; if that is not on `upstream/master` yet, assert the update path's revision instead and say so)
- [ ] `hogli test products/workflows/backend/api/test/` green, `ruff`, repo-wide `mypy`
- [ ] `hogli build:openapi` output in the diff if the schema changed
- [ ] `hogli ci:preflight --strict` on push

## Blocked by

Nothing.

## Stack base and ship target

- Branch `feat/workflows-psak-auth` cut from `upstream/master`.
- A draft PR against upstream `PostHog/posthog`, `--head Silthus:feat/workflows-psak-auth`. It stays a draft until Michael says otherwise. Nothing merges into the fork's `master`.
- Invoke `adding-project-secret-api-key-auth`, `improving-drf-endpoints`, `writing-tests`, `writing-code-comments`, `reviewing-with-coderabbit` and `writing-pr-descriptions`.


Exactly the ticket: PSAK on `HogFlowViewSet` for `list`, `retrieve`, `create`, `update`, `partial_update` only, the scope allowlist entry, the authenticator, `psak_allowed_actions`, the throttle, and every user assumption on the create and update paths made safe for the synthetic user.

Keep the entrypoint thin.

No migration is expected; if one turns out to be needed, stop and park with the question.

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
- frontend/src/lib/scopes.tsx (modified, +1 -0)
- posthog/scopes.py (modified, +3 -0)
- products/workflows/CONTRIBUTING.md (modified, +6 -0)
- products/workflows/backend/api/hog_flow.py (modified, +79 -8)
- products/workflows/backend/api/test/test_hog_flow_psak_auth.py (added, +178 -0)

```diff
diff --git a/frontend/src/lib/scopes.tsx b/frontend/src/lib/scopes.tsx
index e993b96d912..a2de4a10886 100644
--- a/frontend/src/lib/scopes.tsx
+++ b/frontend/src/lib/scopes.tsx
@@ -292,6 +292,7 @@ export const PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION = [
     'account:read',
     'loop:write',
     'experiment:read',
+    'hog_flow:write',
 ] as const
 
 export type ProjectSecretAPIKeyAllowedScope = (typeof PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION)[number]
diff --git a/posthog/scopes.py b/posthog/scopes.py
index 9c6099c182a..92b70a3e28a 100644
--- a/posthog/scopes.py
+++ b/posthog/scopes.py
@@ -236,6 +236,9 @@ PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION: list[tuple[APIScopeObject, APIS
     # Read-only export of experiment definitions (list/retrieve), so services syncing
     # experiments into a warehouse don't need a credential tied to one person's account.
     ("experiment", "read"),
+    # Workflows-as-code pushes from CI: resolve, read, create and update workflows. Delete,
+    # publish and invocation actions stay session/PAT/OAuth-only (HogFlowViewSet.psak_allowed_actions).
+    ("hog_flow", "write"),
 ]
 
 # Server-side scope assignment string-set constants (see RFC: server-side scope
diff --git a/products/workflows/CONTRIBUTING.md b/products/workflows/CONTRIBUTING.md
index 45a376779c4..216efe67b69 100644
--- a/products/workflows/CONTRIBUTING.md
+++ b/products/workflows/CONTRIBUTING.md
@@ -342,6 +342,12 @@ For anything emitted after the run has ended — a webhook, a callback — the v
 
 Building a version picker? The list of versions that have metrics is `{flow.version} ∪ {revision versions}`, not just the revisions endpoint. A workflow that has never been edited has zero `HogFlowRevision` rows but still reports metrics under `<flow id>/1`.
 
+## Pushing workflows from CI
+
+A CI job that pushes workflows authenticates with a project secret API key (`phs_...`, sent as `Authorization: Bearer`) carrying the `hog_flow:write` scope, not a personal API key, so the push keeps working when the person who set it up leaves the project.
+The key can list (including the `?key=` resolve), retrieve, create and update workflows in its own project, and nothing else: delete, bulk delete, publish and the invocation actions refuse it (`psak_allowed_actions` on `HogFlowViewSet`).
+A key has no user behind it, so a workflow it creates, and each revision it writes, has `created_by` null, and its activity log rows are system writes whose `trigger` names the key's id, label and mask.
+
 ## Common pitfalls
 
 - **Forgot the side-effect import**: triggers/actions must be imported by their `index.ts`, and async functions must be imported by nodejs/src/cdp/async-functions/index.ts.
diff --git a/products/workflows/backend/api/hog_flow.py b/products/workflows/backend/api/hog_flow.py
index 4969d7f148e..39012d3a883 100644
--- a/products/workflows/backend/api/hog_flow.py
+++ b/products/workflows/backend/api/hog_flow.py
@@ -71,7 +71,7 @@ from posthog.api.log_entries import LogEntryMixin
 from posthog.api.routing import TeamAndOrgViewSetMixin
 from posthog.api.shared import UserBasicSerializer
 from posthog.api.utils import log_activity_from_viewset
-from posthog.auth import InternalAPIAuthentication
+from posthog.auth import InternalAPIAuthentication, ProjectSecretAPIKeyAuthentication
 from posthog.cdp.filters import compile_filters_expr
 from posthog.cdp.flag_gated_templates import FLAG_GATED_TEMPLATE_IDS, gated_template_enabled
 from posthog.cdp.validation import (
@@ -85,9 +85,10 @@ from posthog.clickhouse.query_tagging import Feature, tag_queries
 from posthog.dataclasses import frozen
 from posthog.event_usage import AGENT_EVENT_SOURCES, EventSource, get_event_source, report_user_action
 from posthog.models import Team
+from posthog.models.activity_logging.activity_log import Detail, Trigger, log_activity
 from posthog.models.filters import Filter
 from posthog.models.integration import Integration
-from posthog.permissions import posthog_feature_flag_enabled
+from posthog.permissions import is_authenticated_via_project_secret_api_key, posthog_feature_flag_enabled
 from posthog.plugins.plugin_server_api import (
     cancel_hog_flow_batch_job,
     cancel_hog_flow_invocations,
@@ -96,6 +97,7 @@ from posthog.plugins.plugin_server_api import (
     get_hog_flow_in_flight_count,
     rerun_hog_invocations,
 )
+from posthog.rate_limit import PersonalOrProjectSecretApiKeyRateThrottle, ProjectSecretApiKeyTeamRateThrottle
 from posthog.synthetic_user import SyntheticUser
 from posthog.user_permissions import UserPermissions
 from posthog.utils import relative_date_parse_with_delta_mapping
@@ -3042,12 +3044,13 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
 
         # Who a "Create AI task" step runs as: the existing creator for an update, or the
         # requesting user for a brand-new flow (matches the `created_by` a create() actually
-        # writes). None outside a request (internal re-saves), where the skills check is skipped.
+        # writes). None outside a request (internal re-saves) and for a project secret API key,
+        # which has no user row; the skills check is skipped then.
         owner = instance.created_by if instance else None
         if owner is None:
             request = self.context.get("request")
             user = getattr(request, "user", None)
-            if user is not None and getattr(user, "is_authenticated", False):
+            if user is not None and getattr(user, "is_authenticated", False) and not isinstance(user, SyntheticUser):
                 owner = user
         self.context["workflow_owner_id"] = owner.id if owner else None
 
@@ -3344,7 +3347,8 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
     def create(self, validated_data: dict, *args, **kwargs) -> HogFlow:
         request = self.context["request"]
         team_id = self.context["team_id"]
-        validated_data["created_by"] = request.user
+        # A project secret API key authenticates as a synthetic user with no row to point at.
+        validated_data["created_by"] = None if isinstance(request.user, SyntheticUser) else request.user
         validated_data["team_id"] = team_id
         self._strip_secret_inputs(validated_data)
 
@@ -3897,6 +3901,29 @@ def mint_audience_confirm_token(
 WRITABLE_DRAFT_CONTENT_FIELDS = frozenset(DRAFT_CONTENT_FIELDS) - frozenset(HogFlowSerializer.Meta.read_only_fields)
 
 
+class HogFlowBurstRateThrottle(PersonalOrProjectSecretApiKeyRateThrottle):
+    # Same scope and rate as the default BurstRateThrottle, so session and personal-key callers
+    # are unchanged; the base also throttles project secret API keys, which the default skips.
+    scope = "burst"
+    rate = "480/minute"
+
+
+class HogFlowSustainedRateThrottle(PersonalOrProjectSecretApiKeyRateThrottle):
+    scope = "sustained"
+    rate = "4800/hour"
+
+
+class HogFlowProjectSecretApiKeyTeamBurstThrottle(ProjectSecretApiKeyTeamRateThrottle):
+    # Caps a project's total key traffic, so minting more keys doesn't multiply its budget.
+    scope = "hog_flow_psak_team_burst"
+    rate = "480/minute"
+
+
+class HogFlowProjectSecretApiKeyTeamSustainedThrottle(ProjectSecretApiKeyTeamRateThrottle):
+    scope = "hog_flow_psak_team_sustained"
+    rate = "4800/hour"
+
+
 @extend_schema(extensions={"x-product": "workflows"})
 @extend_schema_view(
     list=extend_schema(
@@ -3935,6 +3962,17 @@ class HogFlowViewSet(
     TeamAndOrgViewSetMixin, AccessControlViewSetMixin, LogEntryMixin, AppMetricsMixin, viewsets.ModelViewSet
 ):
     scope_object = "hog_flow"
+    # Extends the default authenticators (TeamAndOrgViewSetMixin appends session/PAT/OAuth).
+    authentication_classes = [ProjectSecretAPIKeyAuthentication]
+    # A project secret API key with hog_flow:write can push workflows from CI: resolve, read,
+    # create and update. Deletes, publish and invocation actions stay session/PAT/OAuth-only.
+    psak_allowed_actions = ["list", "retrieve", "create", "update", "partial_update"]
+    throttle_classes = [
+        HogFlowBurstRateThrottle,
+        HogFlowSustainedRateThrottle,
+        HogFlowProjectSecretApiKeyTeamBurstThrottle,
+        HogFlowProjectSecretApiKeyTeamSustainedThrottle,
+    ]
     scope_object_read_actions = [
         "list",
         "retrieve",
@@ -4258,6 +4296,36 @@ class HogFlowViewSet(
             ac_resource_type=self.scope_object,
         )
 
+    def _log_workflow_activity(
+        self, instance: HogFlow, *, previous: Optional[HogFlow] = None, detail_type: Optional[str] = None
+    ) -> None:
+        if not is_authenticated_via_project_secret_api_key(self.request):
+            log_activity_from_viewset(self, instance, name=instance.name, previous=previous, detail_type=detail_type)
+            return
+        # log_activity_from_viewset writes request.user as the actor, which a key's synthetic user
+        # can't be, so the row would be dropped. Log it as a system write and name the key instead.
+        # The row carries no field diff, so force_save keeps an update log_activity would otherwise drop.
+        psak = cast(ProjectSecretAPIKeyAuthentication, self.request.successful_authenticator).project_secret_api_key
+        log_activity(
+            organization_id=self.organization.id,
+            team_id=self.team_id,
+            user=None,
+            was_impersonated=False,
+            item_id=str(instance.id),
+            scope="HogFlow",
+            activity="created" if self.action == "create" else "updated",
+            detail=Detail(
+                name=instance.name,
+                type=detail_type,
+                trigger=Trigger(
+                    job_type="project_secret_api_key",
+                    job_id=str(psak.id),
+                    payload={"label": psak.label, "mask_value": psak.mask_value},
+                ),
+            ),
+            force_save=True,
+        )
+
     def _report_workflow_action(self, event: str, instance: HogFlow, extra_properties: Optional[dict] = None) -> None:
         # report_user_action injects source and MCP-client properties from the request, so usage is
         # attributable per channel (web builder vs MCP vs raw API). Capture must never break the request.
@@ -4286,7 +4354,7 @@ class HogFlowViewSet(
             )
 
         serializer.save()
-        log_activity_from_viewset(self, serializer.instance, name=serializer.instance.name, detail_type="standard")
+        self._log_workflow_activity(serializer.instance, detail_type="standard")
         self._emit_resource_edited(serializer.instance)
 
         self._report_workflow_action(
@@ -4427,7 +4495,7 @@ class HogFlowViewSet(
         if not route_to_draft:
             self._maybe_reschedule_timing_edits(before_update, serializer.instance)
             self._pause_schedules_on_audience_change(before_update, serializer.instance)
-        log_activity_from_viewset(self, serializer.instance, name=serializer.instance.name, previous=before_update)
+        self._log_workflow_activity(serializer.instance, previous=before_update)
         self._emit_resource_edited(serializer.instance)
 
         # PostHog capture for hog_flow activated (draft -> active)
@@ -4508,7 +4576,10 @@ class HogFlowViewSet(
             hog_flow=instance,
             version=instance.version,
             content=snapshot_flow_content(instance),
-            created_by=self.request.user if self.request.user.is_authenticated else None,
+            # A project secret API key authenticates as a synthetic user with no row to point at.
+            created_by=self.request.user
+            if self.request.user.is_authenticated and not is_authenticated_via_project_secret_api_key(self.request)
+            else None,
         )
 
     def _write_draft(self, instance: HogFlow, locked: HogFlow, validated_data: dict) -> None:
diff --git a/products/workflows/backend/api/test/test_hog_flow_psak_auth.py b/products/workflows/backend/api/test/test_hog_flow_psak_auth.py
new file mode 100644
index 00000000000..c8558050cfb
--- /dev/null
+++ b/products/workflows/backend/api/test/test_hog_flow_psak_auth.py
@@ -0,0 +1,178 @@
+from posthog.test.base import APIBaseTest
+from unittest.mock import patch
+
+from parameterized import parameterized
+from rest_framework import status
+from rest_framework.test import APIClient
+
+from posthog.cdp.templates.hog_function_template import sync_template_to_db
+from posthog.models import ProjectSecretAPIKey, Team
+from posthog.models.activity_logging.activity_log import ActivityLog
+from posthog.models.personal_api_key import hash_key_value
+from posthog.models.utils import generate_random_token_secret
+
+from products.cdp.backend.api.test.test_hog_function_templates import MOCK_NODE_TEMPLATES
+from products.workflows.backend.models.hog_flow.hog_flow import HogFlow
+from products.workflows.backend.models.hog_flow_revision import HogFlowRevision
+
+
+def _actions(url: str = "https://example.com") -> list[dict]:
+    return [
+        {
+            "id": "trigger_node",
+            "name": "trigger_1",
+            "type": "trigger",
+            "config": {
+                "type": "event",
+                "filters": {"events": [{"id": "$pageview", "name": "$pageview", "type": "events", "order": 0}]},
+            },
+        },
+        {
+            "id": "action_1",
+            "name": "action_1",
+            "type": "function",
+            "config": {"template_id": "template-webhook", "inputs": {"url": {"value": url}}},
+        },
+    ]
+
+
+class TestHogFlowProjectSecretAPIKeyAuth(APIBaseTest):
+    def setUp(self):
+        super().setUp()
+        sync_template_to_db(MOCK_NODE_TEMPLATES[0])
+        self.psak, self.token = self._psak(self.team, ["hog_flow:write"])
+
+    def _psak(self, team: Team, scopes: list[str]) -> tuple[ProjectSecretAPIKey, str]:
+        raw_token = generate_random_token_secret()
+        psak = ProjectSecretAPIKey.objects.create(
+            team=team,
+            label="ci push",
+            secure_value=hash_key_value(raw_token),
+            scopes=scopes,
+            mask_value=f"{raw_token[:4]}...{raw_token[-4:]}",
+        )
+        return psak, raw_token
+
+    def _psak_client(self, token: str | None = None) -> APIClient:
+        client = APIClient()
+        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token or self.token}")
+        return client
+
+    def _flow(self, team: Team | None = None) -> HogFlow:
+        return HogFlow.objects.create(
+            team=team or self.team, name="Existing", actions=_actions(), created_by=self.user, status="draft"
+        )
+
+    def _url(self, team: Team | None = None, flow_id: str | None = None) -> str:
+        base = f"/api/projects/{(team or self.team).id}/hog_flows"
+        return f"{base}/{flow_id}" if flow_id else base
+
+    def test_create_stores_no_creator_and_attributes_activity_to_the_key(self):
+        with patch("posthog.event_usage.posthoganalytics.capture") as capture:
+            response = self._psak_client().post(
+                self._url(), {"name": "Pushed from CI", "actions": _actions()}, format="json"
+            )
+
+        assert response.status_code == status.HTTP_201_CREATED, response.json()
+        body = response.json()
+        assert body["name"] == "Pushed from CI"
+        assert body["created_by"] is None
+        assert HogFlow.objects.get(id=body["id"]).created_by is None
+
+        log = ActivityLog.objects.get(scope="HogFlow", item_id=body["id"], activity="created")
+        assert log.user is None
+        assert log.is_system
+        assert log.detail is not None
+        assert log.detail["trigger"] == {
+            "job_type": "project_secret_api_key",
+            "job_id": str(self.psak.id),
+            "payload": {"label": "ci push", "mask_value": self.psak.mask_value},
+        }
+
+        created_events = [c for c in capture.call_args_list if c.kwargs["event"] == "hog_flow_created"]
+        assert len(created_events) == 1
+        assert created_events[0].kwargs["distinct_id"] == f"psak-{self.team.id}-{self.psak.id}"
+
+    @parameterized.expand(
+        [
+            # `?key=` is how the CLI resolves a code-managed workflow to its row.
+            ("list_by_key", "get", False, "?key=welcome-email", None),
+            ("retrieve", "get", True, "", None),
+            ("partial_update", "patch", True, "", {"name": "Renamed by CI"}),
+            ("update", "put", True, "", {"name": "Replaced by CI", "actions": _actions()}),
+        ]
+    )
+    def test_push_actions_accept_the_key(self, _name, method, detail, query, payload):
+        flow = self._flow()
+        url = (self._url(flow_id=str(flow.id)) if detail else self._url()) + query
+
+        response = getattr(self._psak_client(), method)(url, payload, format="json")
+
+        assert response.status_code == status.HTTP_200_OK, response.json()
+        if payload:
+            assert response.json()["name"] == payload["name"]
+            flow.refresh_from_db()
+            assert flow.name == payload["name"]
+            assert flow.created_by == self.user
+
+    def test_update_writes_a_revision_with_no_creator(self):
+        flow = self._flow()
+
+        response = self._psak_client().patch(
+            self._url(flow_id=str(flow.id)), {"actions": _actions("https://changed.example.com")}, format="json"
+        )
+
+        assert response.status_code == status.HTTP_200_OK, response.json()
+        latest = HogFlowRevision.objects.filter(hog_flow=flow).order_by("-version").first()
+        assert latest is not None
+        assert latest.version == 2
+        assert latest.created_by is None
+
+    @parameterized.expand(
+        [
+            ("destroy", "delete", "{flow_id}", False),
+            ("bulk_delete", "post", "bulk_delete", True),
+            ("publish", "post", "{flow_id}/publish", False),
+        ]
+    )
+    def test_actions_outside_a_push_refuse_the_key(self, _name, method, path, sends_ids):
+        # Archived, so bulk_delete would really delete it if the key got through.
+        flow = self._flow()
+        flow.status = "archived"
+        flow.save()
+        payload = {"ids": [str(flow.id)]} if sends_ids else {}
+
+        response = getattr(self._psak_client(), method)(
+            f"{self._url()}/{path.format(flow_id=flow.id)}", payload, format="json"
+        )
+
+        assert response.status_code == status.HTTP_403_FORBIDDEN, response.content
+        assert HogFlow.objects.filter(id=flow.id).exists()
+
+    @parameterized.expand(
+        [
+            ("list", "get", False, None),
+            ("retrieve", "get", True, None),
+            ("partial_update", "patch", True, {"name": "Hijacked"}),
+            ("create", "post", False, {"name": "Planted", "actions": _actions()}),
+        ]
+    )
+    def test_key_cannot_reach_another_teams_workflows(self, _name, method, detail, payload):
+        other_team = Team.objects.create(organization=self.organization, name="Other")
+        other_flow = self._flow(other_team)
+        url = self._url(other_team, str(other_flow.id) if detail else None)
+
+        response = getattr(self._psak_client(), method)(url, payload, format="json")
+
+        assert response.status_code == status.HTTP_403_FORBIDDEN, response.content
+        other_flow.refresh_from_db()
+        assert other_flow.name == "Existing"
+        assert HogFlow.objects.filter(team=other_team).count() == 1
+
+    def test_key_without_the_hog_flow_scope_is_refused(self):
+        _, token = self._psak(self.team, ["feature_flag:read"])
+
+        response = self._psak_client(token).post(self._url(), {"name": "Nope", "actions": _actions()}, format="json")
+
+        assert response.status_code == status.HTTP_403_FORBIDDEN, response.content
+        assert not HogFlow.objects.filter(name="Nope").exists()

```

## Diff Y

Files:
- frontend/src/lib/scopes.tsx (modified, +2 -0)
- posthog/scopes.py (modified, +4 -0)
- products/workflows/CONTRIBUTING.md (modified, +4 -0)
- products/workflows/backend/api/hog_flow.py (modified, +91 -7)
- products/workflows/backend/api/test/test_hog_flow_psak_auth.py (added, +207 -0)

```diff
diff --git a/frontend/src/lib/scopes.tsx b/frontend/src/lib/scopes.tsx
index e993b96d912..976c79e9e07 100644
--- a/frontend/src/lib/scopes.tsx
+++ b/frontend/src/lib/scopes.tsx
@@ -292,6 +292,8 @@ export const PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION = [
     'account:read',
     'loop:write',
     'experiment:read',
+    'hog_flow:read',
+    'hog_flow:write',
 ] as const
 
 export type ProjectSecretAPIKeyAllowedScope = (typeof PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION)[number]
diff --git a/posthog/scopes.py b/posthog/scopes.py
index 9c6099c182a..8d18db67da4 100644
--- a/posthog/scopes.py
+++ b/posthog/scopes.py
@@ -236,6 +236,10 @@ PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION: list[tuple[APIScopeObject, APIS
     # Read-only export of experiment definitions (list/retrieve), so services syncing
     # experiments into a warehouse don't need a credential tied to one person's account.
     ("experiment", "read"),
+    # Workflows as code: a CI job pushes workflow definitions (list/retrieve/create/update only,
+    # see HogFlowViewSet.psak_allowed_actions). Read alone serves a CI diff that never writes.
+    ("hog_flow", "read"),
+    ("hog_flow", "write"),
 ]
 
 # Server-side scope assignment string-set constants (see RFC: server-side scope
diff --git a/products/workflows/CONTRIBUTING.md b/products/workflows/CONTRIBUTING.md
index 45a376779c4..6577b766d4a 100644
--- a/products/workflows/CONTRIBUTING.md
+++ b/products/workflows/CONTRIBUTING.md
@@ -342,6 +342,10 @@ For anything emitted after the run has ended — a webhook, a callback — the v
 
 Building a version picker? The list of versions that have metrics is `{flow.version} ∪ {revision versions}`, not just the revisions endpoint. A workflow that has never been edited has zero `HogFlowRevision` rows but still reports metrics under `<flow id>/1`.
 
+## Pushing workflows from CI
+
+A CI push authenticates with a project secret API key (`phs_...`, sent as `Authorization: Bearer`) carrying `hog_flow:write`, not with a personal API key, so the pipeline keeps working when the person who set it up leaves the project. The key reaches only what a push needs on `/api/projects/:id/hog_flows/`: `list`, `retrieve`, `create`, `update` and `partial_update`. Delete, bulk delete, publish and every invocation action refuse it with a 403, and a key only works against its own project. A key has no user behind it, so a workflow it creates has no `created_by`, a revision it writes has no author, and the activity log records the change with no user and names the key (id, label, mask) in `detail.trigger`. A key with only `hog_flow:read` can list and read, which is enough for a CI diff that never writes.
+
 ## Common pitfalls
 
 - **Forgot the side-effect import**: triggers/actions must be imported by their `index.ts`, and async functions must be imported by nodejs/src/cdp/async-functions/index.ts.
diff --git a/products/workflows/backend/api/hog_flow.py b/products/workflows/backend/api/hog_flow.py
index 4969d7f148e..46cef152d3d 100644
--- a/products/workflows/backend/api/hog_flow.py
+++ b/products/workflows/backend/api/hog_flow.py
@@ -70,8 +70,8 @@ from posthog.api.hog_invocation_results import (
 from posthog.api.log_entries import LogEntryMixin
 from posthog.api.routing import TeamAndOrgViewSetMixin
 from posthog.api.shared import UserBasicSerializer
-from posthog.api.utils import log_activity_from_viewset
-from posthog.auth import InternalAPIAuthentication
+from posthog.api.utils import ACTIVITY_TYPES, log_activity_from_viewset
+from posthog.auth import InternalAPIAuthentication, ProjectSecretAPIKeyAuthentication
 from posthog.cdp.filters import compile_filters_expr
 from posthog.cdp.flag_gated_templates import FLAG_GATED_TEMPLATE_IDS, gated_template_enabled
 from posthog.cdp.validation import (
@@ -85,9 +85,10 @@ from posthog.clickhouse.query_tagging import Feature, tag_queries
 from posthog.dataclasses import frozen
 from posthog.event_usage import AGENT_EVENT_SOURCES, EventSource, get_event_source, report_user_action
 from posthog.models import Team
+from posthog.models.activity_logging.activity_log import Detail, Trigger, changes_between, log_activity
 from posthog.models.filters import Filter
 from posthog.models.integration import Integration
-from posthog.permissions import posthog_feature_flag_enabled
+from posthog.permissions import is_authenticated_via_project_secret_api_key, posthog_feature_flag_enabled
 from posthog.plugins.plugin_server_api import (
     cancel_hog_flow_batch_job,
     cancel_hog_flow_invocations,
@@ -96,6 +97,12 @@ from posthog.plugins.plugin_server_api import (
     get_hog_flow_in_flight_count,
     rerun_hog_invocations,
 )
+from posthog.rate_limit import (
+    BurstRateThrottle,
+    PersonalOrProjectSecretApiKeyRateThrottle,
+    ProjectSecretApiKeyTeamRateThrottle,
+    SustainedRateThrottle,
+)
 from posthog.synthetic_user import SyntheticUser
 from posthog.user_permissions import UserPermissions
 from posthog.utils import relative_date_parse_with_delta_mapping
@@ -3344,7 +3351,9 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
     def create(self, validated_data: dict, *args, **kwargs) -> HogFlow:
         request = self.context["request"]
         team_id = self.context["team_id"]
-        validated_data["created_by"] = request.user
+        # A project secret API key authenticates as a synthetic user with no User row, so a
+        # CI-pushed workflow has no creator. The activity log names the key instead.
+        validated_data["created_by"] = None if isinstance(request.user, SyntheticUser) else request.user
         validated_data["team_id"] = team_id
         self._strip_secret_inputs(validated_data)
 
@@ -3836,6 +3845,30 @@ def _action_content_matches(regex_pattern: str) -> RawSQL:
     return RawSQL(" OR ".join(clauses), params, output_field=models.BooleanField())
 
 
+# Drop-in replacements for the default burst/sustained throttles: same scopes and rates, but a
+# project secret API key gets its own per-key bucket instead of bypassing throttling entirely.
+class HogFlowBurstRateThrottle(PersonalOrProjectSecretApiKeyRateThrottle):
+    scope = BurstRateThrottle.scope
+    rate = BurstRateThrottle.rate
+
+
+class HogFlowSustainedRateThrottle(PersonalOrProjectSecretApiKeyRateThrottle):
+    scope = SustainedRateThrottle.scope
+    rate = SustainedRateThrottle.rate
+
+
+# Per-project caps across all of a project's secret keys, the same size as one key's budget, so
+# minting more keys never multiplies what a project can push.
+class HogFlowProjectSecretApiKeyTeamBurstThrottle(ProjectSecretApiKeyTeamRateThrottle):
+    scope = "hog_flow_psak_team_burst"
+    rate = BurstRateThrottle.rate
+
+
+class HogFlowProjectSecretApiKeyTeamSustainedThrottle(ProjectSecretApiKeyTeamRateThrottle):
+    scope = "hog_flow_psak_team_sustained"
+    rate = SustainedRateThrottle.rate
+
+
 class StaleWorkflowUpdateError(exceptions.APIException):
     status_code = status.HTTP_409_CONFLICT
     default_detail = (
@@ -3935,6 +3968,16 @@ class HogFlowViewSet(
     TeamAndOrgViewSetMixin, AccessControlViewSetMixin, LogEntryMixin, AppMetricsMixin, viewsets.ModelViewSet
 ):
     scope_object = "hog_flow"
+    authentication_classes = [ProjectSecretAPIKeyAuthentication]
+    # Exactly what a CI push needs: resolve by list, read, create, update. Delete, publish and
+    # every invocation action stay with people and personal keys.
+    psak_allowed_actions = ["list", "retrieve", "create", "update", "partial_update"]
+    throttle_classes = [
+        HogFlowBurstRateThrottle,
+        HogFlowSustainedRateThrottle,
+        HogFlowProjectSecretApiKeyTeamBurstThrottle,
+        HogFlowProjectSecretApiKeyTeamSustainedThrottle,
+    ]
     scope_object_read_actions = [
         "list",
         "retrieve",
@@ -4254,10 +4297,47 @@ class HogFlowViewSet(
             resource_type="HogFlow",
             resource_id=str(instance.id),
             updated_at=edited_at.isoformat(),
+            # None for a project secret API key, so the edit reaches every open builder.
             actor_user_id=getattr(self.request.user, "id", None),
             ac_resource_type=self.scope_object,
         )
 
+    def _log_write_activity(
+        self, instance: HogFlow, *, previous: Optional[HogFlow] = None, detail_type: Optional[str] = None
+    ) -> None:
+        if not is_authenticated_via_project_secret_api_key(self.request):
+            log_activity_from_viewset(self, instance, name=instance.name, previous=previous, detail_type=detail_type)
+            return
+        # log_activity_from_viewset would pass the synthetic user as the actor, which cannot be saved,
+        # so the row would be dropped. Log it as a write with no user and name the key in the trigger.
+        try:
+            psak = self.request.successful_authenticator.project_secret_api_key
+            log_activity(
+                organization_id=self.organization.id,
+                team_id=self.team_id,
+                user=None,
+                was_impersonated=False,
+                item_id=str(instance.id),
+                scope="HogFlow",
+                activity=ACTIVITY_TYPES.get(self.action, ACTIVITY_TYPES["default"]),
+                detail=Detail(
+                    name=instance.name,
+                    type=detail_type,
+                    changes=(
+                        changes_between("HogFlow", previous=previous, current=instance)
+                        if previous is not None
+                        else None
+                    ),
+                    trigger=Trigger(
+                        job_type="project_secret_api_key",
+                        job_id=str(psak.id),
+                        payload={"label": psak.label, "mask_value": psak.mask_value},
+                    ),
+                ),
+            )
+        except Exception as e:
+            logger.warning("Failed to log workflow activity", error=str(e))
+
     def _report_workflow_action(self, event: str, instance: HogFlow, extra_properties: Optional[dict] = None) -> None:
         # report_user_action injects source and MCP-client properties from the request, so usage is
         # attributable per channel (web builder vs MCP vs raw API). Capture must never break the request.
@@ -4286,7 +4366,7 @@ class HogFlowViewSet(
             )
 
         serializer.save()
-        log_activity_from_viewset(self, serializer.instance, name=serializer.instance.name, detail_type="standard")
+        self._log_write_activity(serializer.instance, detail_type="standard")
         self._emit_resource_edited(serializer.instance)
 
         self._report_workflow_action(
@@ -4427,7 +4507,7 @@ class HogFlowViewSet(
         if not route_to_draft:
             self._maybe_reschedule_timing_edits(before_update, serializer.instance)
             self._pause_schedules_on_audience_change(before_update, serializer.instance)
-        log_activity_from_viewset(self, serializer.instance, name=serializer.instance.name, previous=before_update)
+        self._log_write_activity(serializer.instance, previous=before_update)
         self._emit_resource_edited(serializer.instance)
 
         # PostHog capture for hog_flow activated (draft -> active)
@@ -4508,7 +4588,11 @@ class HogFlowViewSet(
             hog_flow=instance,
             version=instance.version,
             content=snapshot_flow_content(instance),
-            created_by=self.request.user if self.request.user.is_authenticated else None,
+            created_by=(
+                self.request.user
+                if self.request.user.is_authenticated and not isinstance(self.request.user, SyntheticUser)
+                else None
+            ),
         )
 
     def _write_draft(self, instance: HogFlow, locked: HogFlow, validated_data: dict) -> None:
diff --git a/products/workflows/backend/api/test/test_hog_flow_psak_auth.py b/products/workflows/backend/api/test/test_hog_flow_psak_auth.py
new file mode 100644
index 00000000000..2c84436c833
--- /dev/null
+++ b/products/workflows/backend/api/test/test_hog_flow_psak_auth.py
@@ -0,0 +1,207 @@
+from posthog.test.base import APIBaseTest
+from unittest.mock import patch
+
+from django.core.cache import cache
+
+from parameterized import parameterized
+from rest_framework import status
+from rest_framework.test import APIClient
+
+from posthog.cdp.templates.hog_function_template import sync_template_to_db
+from posthog.models import Team
+from posthog.models.activity_logging.activity_log import ActivityLog
+from posthog.models.project_secret_api_key import ProjectSecretAPIKey
+from posthog.models.utils import generate_random_token_secret, hash_key_value
+
+from products.cdp.backend.api.test.test_hog_function_templates import MOCK_NODE_TEMPLATES
+from products.workflows.backend.api.hog_flow import (
+    HogFlowBurstRateThrottle,
+    HogFlowProjectSecretApiKeyTeamBurstThrottle,
+)
+from products.workflows.backend.models.hog_flow.hog_flow import HogFlow
+from products.workflows.backend.models.hog_flow_revision import HogFlowRevision
+
+
+def _actions(url: str = "https://example.com") -> list[dict]:
+    return [
+        {
+            "id": "trigger_node",
+            "name": "trigger_1",
+            "type": "trigger",
+            "config": {
+                "type": "event",
+                "filters": {"events": [{"id": "$pageview", "name": "$pageview", "type": "events", "order": 0}]},
+            },
+        },
+        {
+            "id": "action_1",
+            "name": "action_1",
+            "type": "function",
+            "config": {"template_id": "template-webhook", "inputs": {"url": {"value": url}}},
+        },
+    ]
+
+
+class TestHogFlowProjectSecretAPIKeyAuth(APIBaseTest):
+    def setUp(self):
+        super().setUp()
+        cache.clear()
+        sync_template_to_db(MOCK_NODE_TEMPLATES[0])
+        self.token, self.psak = self._make_psak(self.team, ["hog_flow:write"])
+
+    def _make_psak(self, team: Team, scopes: list[str], label: str = "ci push") -> tuple[str, ProjectSecretAPIKey]:
+        token = generate_random_token_secret()
+        psak = ProjectSecretAPIKey.objects.create(
+            team=team,
+            label=label,
+            secure_value=hash_key_value(token),
+            scopes=scopes,
+            mask_value=f"{token[:4]}...{token[-4:]}",
+        )
+        return token, psak
+
+    def _psak_client(self, token: str | None = None) -> APIClient:
+        client = APIClient()
+        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token or self.token}")
+        return client
+
+    def _url(self, suffix: str = "", team: Team | None = None) -> str:
+        return f"/api/projects/{(team or self.team).id}/hog_flows/{suffix}"
+
+    def _session_flow(self, team: Team | None = None) -> HogFlow:
+        response = self.client.post(
+            self._url(team=team), {"name": "Session flow", "actions": _actions()}, format="json"
+        )
+        assert response.status_code == status.HTTP_201_CREATED, response.json()
+        return HogFlow.objects.get(id=response.json()["id"])
+
+    def test_psak_push_creates_and_resolves_a_workflow_without_a_creator(self):
+        client = self._psak_client()
+
+        with patch("posthog.event_usage.posthoganalytics.capture") as capture:
+            created = client.post(self._url(), {"name": "Pushed from CI", "actions": _actions()}, format="json")
+        assert created.status_code == status.HTTP_201_CREATED, created.json()
+        flow_id = created.json()["id"]
+
+        assert created.json()["created_by"] is None
+        assert HogFlow.objects.get(id=flow_id).created_by is None
+
+        # The CLI resolves a workflow through list, then reads it back.
+        listed = client.get(self._url())
+        assert listed.status_code == status.HTTP_200_OK, listed.json()
+        assert [row["id"] for row in listed.json()["results"]] == [flow_id]
+        retrieved = client.get(self._url(f"{flow_id}/"))
+        assert retrieved.status_code == status.HTTP_200_OK, retrieved.json()
+        assert retrieved.json()["name"] == "Pushed from CI"
+
+        log = ActivityLog.objects.get(scope="HogFlow", item_id=flow_id, activity="created")
+        assert log.user is None
+        assert log.detail["trigger"] == {
+            "job_type": "project_secret_api_key",
+            "job_id": self.psak.id,
+            "payload": {"label": "ci push", "mask_value": self.psak.mask_value},
+        }
+
+        created_events = [c.kwargs for c in capture.call_args_list if c.kwargs.get("event") == "hog_flow_created"]
+        assert len(created_events) == 1
+        assert created_events[0]["distinct_id"] == f"psak-{self.team.id}-{self.psak.id}"
+
+    @parameterized.expand([("patch",), ("put",)])
+    def test_psak_live_edit_writes_a_revision_and_activity_without_a_creator(self, method: str):
+        # Revision 1 on create (PostHog/posthog#104156) is not on master yet, so this pins the
+        # update path: the revision a live content edit appends must not carry the synthetic user.
+        flow = self._session_flow()
+        client = self._psak_client()
+        activated = client.patch(self._url(f"{flow.id}/"), {"status": "active"}, format="json")
+        assert activated.status_code == status.HTTP_200_OK, activated.json()
+
+        body = {"actions": _actions(url="https://changed.example.com")}
+        if method == "put":
+            body["name"] = flow.name
+        edited = getattr(client, method)(self._url(f"{flow.id}/"), body, format="json")
+        assert edited.status_code == status.HTTP_200_OK, edited.json()
+
+        latest = HogFlowRevision.objects.filter(hog_flow_id=flow.id).order_by("-version").first()
+        assert latest is not None and latest.version == edited.json()["version"]
+        assert latest.created_by is None
+
+        log = (
+            ActivityLog.objects.filter(scope="HogFlow", item_id=str(flow.id), activity="updated")
+            .order_by("-created_at")
+            .first()
+        )
+        assert log is not None and log.user is None
+        assert log.detail["trigger"]["job_type"] == "project_secret_api_key"
+        assert any(change["field"] == "actions" for change in log.detail["changes"])
+
+    @parameterized.expand(
+        [
+            ("destroy", "delete", "{id}/"),
+            ("bulk_delete", "post", "bulk_delete/"),
+            ("publish", "post", "{id}/publish/"),
+            ("invocations", "post", "{id}/invocations/"),
+        ]
+    )
+    def test_psak_is_refused_on_actions_outside_the_push(self, _name, method, suffix):
+        flow = self._session_flow()
+
+        response = getattr(self._psak_client(), method)(
+            self._url(suffix.format(id=flow.id)), {"ids": [str(flow.id)]}, format="json"
+        )
+
+        assert response.status_code == status.HTTP_403_FORBIDDEN, response.content
+        assert HogFlow.objects.filter(id=flow.id).exists()
+
+    @parameterized.expand(
+        [
+            ("unrelated_scope_list", ["feature_flag:read"], "get", status.HTTP_403_FORBIDDEN),
+            ("read_scope_list", ["hog_flow:read"], "get", status.HTTP_200_OK),
+            ("read_scope_create", ["hog_flow:read"], "post", status.HTTP_403_FORBIDDEN),
+        ]
+    )
+    def test_psak_needs_the_hog_flow_scope_for_the_action(self, _name, scopes, method, expected):
+        token, _ = self._make_psak(self.team, scopes, label="scoped")
+
+        response = getattr(self._psak_client(token), method)(
+            self._url(), {"name": "x", "actions": _actions()}, format="json"
+        )
+
+        assert response.status_code == expected, response.content
+
+    @parameterized.expand([("get",), ("patch",)])
+    def test_psak_cannot_reach_another_projects_workflow(self, method):
+        other_team = Team.objects.create(organization=self.organization, name="Other project")
+        other_flow = self._session_flow(team=other_team)
+
+        response = getattr(self._psak_client(), method)(
+            self._url(f"{other_flow.id}/", team=other_team), {"name": "hijacked"}, format="json"
+        )
+
+        assert response.status_code == status.HTTP_403_FORBIDDEN, response.content
+        other_flow.refresh_from_db()
+        assert other_flow.name == "Session flow"
+
+    def test_session_auth_still_creates_with_the_user_as_creator(self):
+        response = self.client.post(self._url(), {"name": "From the UI", "actions": _actions()}, format="json")
+
+        assert response.status_code == status.HTTP_201_CREATED, response.json()
+        assert HogFlow.objects.get(id=response.json()["id"]).created_by == self.user
+
+    @parameterized.expand(
+        [
+            # The default burst throttle skips PSAK requests, so a key would push unthrottled.
+            ("per_key", HogFlowBurstRateThrottle, False),
+            # Minting a second key must not double a project's budget.
+            ("per_project", HogFlowProjectSecretApiKeyTeamBurstThrottle, True),
+        ]
+    )
+    @patch("posthog.rate_limit.is_rate_limit_enabled", return_value=True)
+    def test_psak_requests_are_throttled(self, _name, throttle_class, second_key, _enabled):
+        second_token = self._make_psak(self.team, ["hog_flow:write"], label="second")[0] if second_key else None
+
+        with patch.object(throttle_class, "rate", "1/minute"):
+            first = self._psak_client().get(self._url())
+            second = self._psak_client(second_token).get(self._url())
+
+        assert first.status_code == status.HTTP_200_OK, first.content
+        assert second.status_code == status.HTTP_429_TOO_MANY_REQUESTS, second.content

```

## Diff Z

Files:
- frontend/src/lib/scopes.tsx (modified, +1 -0)
- posthog/scopes.py (modified, +4 -0)
- products/workflows/CONTRIBUTING.md (modified, +6 -0)
- products/workflows/backend/api/hog_flow.py (modified, +96 -9)
- products/workflows/backend/api/test/test_hog_flow_psak_auth.py (added, +192 -0)

```diff
diff --git a/frontend/src/lib/scopes.tsx b/frontend/src/lib/scopes.tsx
index e993b96d912..a2de4a10886 100644
--- a/frontend/src/lib/scopes.tsx
+++ b/frontend/src/lib/scopes.tsx
@@ -292,6 +292,7 @@ export const PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION = [
     'account:read',
     'loop:write',
     'experiment:read',
+    'hog_flow:write',
 ] as const
 
 export type ProjectSecretAPIKeyAllowedScope = (typeof PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION)[number]
diff --git a/posthog/scopes.py b/posthog/scopes.py
index 9c6099c182a..663d20ac836 100644
--- a/posthog/scopes.py
+++ b/posthog/scopes.py
@@ -236,6 +236,10 @@ PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION: list[tuple[APIScopeObject, APIS
     # Read-only export of experiment definitions (list/retrieve), so services syncing
     # experiments into a warehouse don't need a credential tied to one person's account.
     ("experiment", "read"),
+    # CI pushes of workflow definitions: resolve, read, create and update (HogFlowViewSet.psak_allowed_actions).
+    # Deletes, publishing and runs stay person-only, so a leaked key can overwrite a project's workflows but
+    # cannot remove or fire them.
+    ("hog_flow", "write"),
 ]
 
 # Server-side scope assignment string-set constants (see RFC: server-side scope
diff --git a/products/workflows/CONTRIBUTING.md b/products/workflows/CONTRIBUTING.md
index 45a376779c4..d1b18110b3c 100644
--- a/products/workflows/CONTRIBUTING.md
+++ b/products/workflows/CONTRIBUTING.md
@@ -342,6 +342,12 @@ For anything emitted after the run has ended — a webhook, a callback — the v
 
 Building a version picker? The list of versions that have metrics is `{flow.version} ∪ {revision versions}`, not just the revisions endpoint. A workflow that has never been edited has zero `HogFlowRevision` rows but still reports metrics under `<flow id>/1`.
 
+## Pushing workflows from CI
+
+A CI job that pushes workflow definitions authenticates with a project secret API key (`phs_...`, sent as `Authorization: Bearer`) that carries the `hog_flow:write` scope, not with a personal API key, so the push keeps working after the person who set it up leaves the project.
+The key can list, retrieve, create and update workflows (`psak_allowed_actions` on `HogFlowViewSet`) and nothing else: deleting, publishing a draft, running and invoking stay tied to a person.
+The key has no user, so a workflow it creates has no `created_by`, a revision it writes has no `created_by`, and its activity log rows have no user but name the key in `detail.trigger` (`job_type: "project_secret_api_key"`, with the key id and label).
+
 ## Common pitfalls
 
 - **Forgot the side-effect import**: triggers/actions must be imported by their `index.ts`, and async functions must be imported by nodejs/src/cdp/async-functions/index.ts.
diff --git a/products/workflows/backend/api/hog_flow.py b/products/workflows/backend/api/hog_flow.py
index 4969d7f148e..ef2b48bac30 100644
--- a/products/workflows/backend/api/hog_flow.py
+++ b/products/workflows/backend/api/hog_flow.py
@@ -70,8 +70,8 @@ from posthog.api.hog_invocation_results import (
 from posthog.api.log_entries import LogEntryMixin
 from posthog.api.routing import TeamAndOrgViewSetMixin
 from posthog.api.shared import UserBasicSerializer
-from posthog.api.utils import log_activity_from_viewset
-from posthog.auth import InternalAPIAuthentication
+from posthog.api.utils import ACTIVITY_TYPES, log_activity_from_viewset
+from posthog.auth import InternalAPIAuthentication, ProjectSecretAPIKeyAuthentication, ProjectSecretAPIKeyUser
 from posthog.cdp.filters import compile_filters_expr
 from posthog.cdp.flag_gated_templates import FLAG_GATED_TEMPLATE_IDS, gated_template_enabled
 from posthog.cdp.validation import (
@@ -81,13 +81,14 @@ from posthog.cdp.validation import (
     InputsSerializer,
     generate_template_bytecode,
 )
-from posthog.clickhouse.query_tagging import Feature, tag_queries
+from posthog.clickhouse.query_tagging import AccessMethod, Feature, tag_queries
 from posthog.dataclasses import frozen
 from posthog.event_usage import AGENT_EVENT_SOURCES, EventSource, get_event_source, report_user_action
-from posthog.models import Team
+from posthog.models import Team, User
+from posthog.models.activity_logging.activity_log import Detail, Trigger, changes_between, log_activity
 from posthog.models.filters import Filter
 from posthog.models.integration import Integration
-from posthog.permissions import posthog_feature_flag_enabled
+from posthog.permissions import is_authenticated_via_project_secret_api_key, posthog_feature_flag_enabled
 from posthog.plugins.plugin_server_api import (
     cancel_hog_flow_batch_job,
     cancel_hog_flow_invocations,
@@ -96,6 +97,12 @@ from posthog.plugins.plugin_server_api import (
     get_hog_flow_in_flight_count,
     rerun_hog_invocations,
 )
+from posthog.rate_limit import (
+    BurstRateThrottle,
+    PersonalOrProjectSecretApiKeyRateThrottle,
+    ProjectSecretApiKeyTeamRateThrottle,
+    SustainedRateThrottle,
+)
 from posthog.synthetic_user import SyntheticUser
 from posthog.user_permissions import UserPermissions
 from posthog.utils import relative_date_parse_with_delta_mapping
@@ -772,6 +779,15 @@ def _apply_email_template_content(config: dict, team: Team, strict: bool, contex
     inputs["email"] = merged_input
 
 
+def _acting_user(request: Request) -> Optional[User]:
+    # A project secret API key authenticates as a synthetic user with no User row, so a write it makes
+    # records no user rather than failing the foreign key.
+    user = request.user
+    if not user.is_authenticated or isinstance(user, SyntheticUser):
+        return None
+    return cast(User, user)
+
+
 def _describe_unknown_template(action: dict, template_id: str) -> str:
     if action.get("type") == "trigger":
         trigger_type = (action.get("config") or {}).get("type", "")
@@ -3344,7 +3360,7 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
     def create(self, validated_data: dict, *args, **kwargs) -> HogFlow:
         request = self.context["request"]
         team_id = self.context["team_id"]
-        validated_data["created_by"] = request.user
+        validated_data["created_by"] = _acting_user(request)
         validated_data["team_id"] = team_id
         self._strip_secret_inputs(validated_data)
 
@@ -3897,6 +3913,30 @@ def mint_audience_confirm_token(
 WRITABLE_DRAFT_CONTENT_FIELDS = frozenset(DRAFT_CONTENT_FIELDS) - frozenset(HogFlowSerializer.Meta.read_only_fields)
 
 
+class HogFlowBurstRateThrottle(PersonalOrProjectSecretApiKeyRateThrottle):
+    # Same scope and rate as the default BurstRateThrottle, so personal-key and session requests keep
+    # their budget. The subclass adds a per-key budget for PSAK requests, which the default skips.
+    scope = BurstRateThrottle.scope
+    rate = BurstRateThrottle.rate
+
+
+class HogFlowSustainedRateThrottle(PersonalOrProjectSecretApiKeyRateThrottle):
+    scope = SustainedRateThrottle.scope
+    rate = SustainedRateThrottle.rate
+
+
+class HogFlowProjectSecretApiKeyTeamBurstThrottle(ProjectSecretApiKeyTeamRateThrottle):
+    """Caps the sum of a project's PSAK requests at one key's budget, so extra keys add no capacity."""
+
+    scope = "hog_flow_psak_team_burst"
+    rate = BurstRateThrottle.rate
+
+
+class HogFlowProjectSecretApiKeyTeamSustainedThrottle(ProjectSecretApiKeyTeamRateThrottle):
+    scope = "hog_flow_psak_team_sustained"
+    rate = SustainedRateThrottle.rate
+
+
 @extend_schema(extensions={"x-product": "workflows"})
 @extend_schema_view(
     list=extend_schema(
@@ -3935,6 +3975,18 @@ class HogFlowViewSet(
     TeamAndOrgViewSetMixin, AccessControlViewSetMixin, LogEntryMixin, AppMetricsMixin, viewsets.ModelViewSet
 ):
     scope_object = "hog_flow"
+    # Extends the default authenticators, which TeamAndOrgViewSetMixin appends.
+    authentication_classes = [ProjectSecretAPIKeyAuthentication]
+    # A CI push resolves a workflow, reads it, then creates or updates it with a project secret API key.
+    # Deletes, publishing, runs and invocations stay tied to a person, so a leaked key cannot remove or
+    # fire workflows. A PSAK holds project-wide hog_flow scope and skips per-workflow access control.
+    psak_allowed_actions = ["list", "retrieve", "create", "update", "partial_update"]
+    throttle_classes = [
+        HogFlowBurstRateThrottle,
+        HogFlowSustainedRateThrottle,
+        HogFlowProjectSecretApiKeyTeamBurstThrottle,
+        HogFlowProjectSecretApiKeyTeamSustainedThrottle,
+    ]
     scope_object_read_actions = [
         "list",
         "retrieve",
@@ -4240,6 +4292,41 @@ class HogFlowViewSet(
             )
         return Response(data)
 
+    def _log_write_activity(
+        self, instance: HogFlow, *, previous: Optional[HogFlow] = None, detail_type: Optional[str] = None
+    ) -> None:
+        if not is_authenticated_via_project_secret_api_key(self.request):
+            log_activity_from_viewset(self, instance, name=instance.name, previous=previous, detail_type=detail_type)
+            return
+        # log_activity_from_viewset puts the synthetic user on the row, which fails the user foreign key and
+        # silently drops the audit entry. Write the row with no user, and name the key in the trigger so the
+        # entry still records which credential made the change.
+        try:
+            psak = cast(ProjectSecretAPIKeyUser, self.request.user).project_secret_api_key
+            log_activity(
+                organization_id=self.organization.id,
+                team_id=self.team_id,
+                user=None,
+                was_impersonated=False,
+                item_id=str(instance.id),
+                scope="HogFlow",
+                activity=ACTIVITY_TYPES.get(self.action, ACTIVITY_TYPES["default"]),
+                detail=Detail(
+                    name=instance.name,
+                    type=detail_type,
+                    changes=changes_between("HogFlow", previous=previous, current=instance)
+                    if previous is not None
+                    else None,
+                    trigger=Trigger(
+                        job_type=AccessMethod.PROJECT_SECRET_API_KEY.value,
+                        job_id=str(psak.id),
+                        payload={"label": psak.label},
+                    ),
+                ),
+            )
+        except Exception:
+            logger.exception("Failed to log workflow activity for a project secret API key", hog_flow_id=instance.id)
+
     def _emit_resource_edited(self, instance: HogFlow) -> None:
         # Realtime "edited elsewhere" signal so an open builder (or another tab) can refresh instead of
         # clobbering edits made via a different channel (UI/MCP/API). Fires for every channel; the
@@ -4286,7 +4373,7 @@ class HogFlowViewSet(
             )
 
         serializer.save()
-        log_activity_from_viewset(self, serializer.instance, name=serializer.instance.name, detail_type="standard")
+        self._log_write_activity(serializer.instance, detail_type="standard")
         self._emit_resource_edited(serializer.instance)
 
         self._report_workflow_action(
@@ -4427,7 +4514,7 @@ class HogFlowViewSet(
         if not route_to_draft:
             self._maybe_reschedule_timing_edits(before_update, serializer.instance)
             self._pause_schedules_on_audience_change(before_update, serializer.instance)
-        log_activity_from_viewset(self, serializer.instance, name=serializer.instance.name, previous=before_update)
+        self._log_write_activity(serializer.instance, previous=before_update)
         self._emit_resource_edited(serializer.instance)
 
         # PostHog capture for hog_flow activated (draft -> active)
@@ -4508,7 +4595,7 @@ class HogFlowViewSet(
             hog_flow=instance,
             version=instance.version,
             content=snapshot_flow_content(instance),
-            created_by=self.request.user if self.request.user.is_authenticated else None,
+            created_by=_acting_user(self.request),
         )
 
     def _write_draft(self, instance: HogFlow, locked: HogFlow, validated_data: dict) -> None:
diff --git a/products/workflows/backend/api/test/test_hog_flow_psak_auth.py b/products/workflows/backend/api/test/test_hog_flow_psak_auth.py
new file mode 100644
index 00000000000..dc45431e9bd
--- /dev/null
+++ b/products/workflows/backend/api/test/test_hog_flow_psak_auth.py
@@ -0,0 +1,192 @@
+import uuid
+
+from posthog.test.base import APIBaseTest
+from unittest.mock import patch
+
+from django.core.cache import cache
+
+from parameterized import parameterized
+from rest_framework import status
+
+from posthog.cdp.templates.hog_function_template import sync_template_to_db
+from posthog.models.activity_logging.activity_log import ActivityLog
+from posthog.models.project_secret_api_key import ProjectSecretAPIKey
+from posthog.models.team import Team
+from posthog.models.utils import hash_key_value
+
+from products.cdp.backend.api.test.test_hog_function_templates import MOCK_NODE_TEMPLATES
+from products.workflows.backend.models.hog_flow.hog_flow import HogFlow
+from products.workflows.backend.models.hog_flow_revision import HogFlowRevision
+
+webhook_template = MOCK_NODE_TEMPLATES[0]
+
+
+def _make_psak(team: Team, label: str, scopes: list[str]) -> tuple[str, ProjectSecretAPIKey]:
+    # The token must match r"^phs_[a-zA-Z0-9]+$", so only alphanumerics follow the prefix.
+    suffix = "".join(c for c in label if c.isalnum())
+    token = "phs_" + ("a" * 35) + suffix
+    psak = ProjectSecretAPIKey.objects.create(
+        team=team,
+        label=label,
+        mask_value=f"phs_...{suffix[:4]}",
+        secure_value=hash_key_value(token),
+        scopes=scopes,
+    )
+    return token, psak
+
+
+def _flow_payload(url: str = "https://example.com") -> dict:
+    return {
+        "name": "CI Flow",
+        "actions": [
+            {
+                "id": "trigger_node",
+                "name": "trigger_1",
+                "type": "trigger",
+                "config": {
+                    "type": "event",
+                    "filters": {"events": [{"id": "$pageview", "name": "$pageview", "type": "events", "order": 0}]},
+                },
+            },
+            {
+                "id": "action_1",
+                "name": "action_1",
+                "type": "function",
+                "config": {"template_id": "template-webhook", "inputs": {"url": {"value": url}}},
+            },
+        ],
+    }
+
+
+class TestHogFlowPSAKAuth(APIBaseTest):
+    def setUp(self):
+        super().setUp()
+        sync_template_to_db(webhook_template)
+        self.token, self.psak = _make_psak(self.team, "ci-push", ["hog_flow:write"])
+
+    def _session_flow(self, team: Team | None = None) -> str:
+        team = team or self.team
+        response = self.client.post(f"/api/projects/{team.id}/hog_flows", _flow_payload(), format="json")
+        assert response.status_code == status.HTTP_201_CREATED, response.json()
+        return response.json()["id"]
+
+    def _psak_request(self, method: str, path: str, data: dict | None = None, token: str | None = None):
+        # Log the test client out so only the Bearer header can authenticate the request.
+        self.client.logout()
+        send = getattr(self.client, method)
+        auth = {"HTTP_AUTHORIZATION": f"Bearer {token or self.token}"}
+        if data is None:
+            return send(path, **auth)
+        return send(path, data, format="json", **auth)
+
+    def test_psak_create_stores_no_creator_and_attributes_the_key_in_activity(self):
+        response = self._psak_request("post", f"/api/projects/{self.team.id}/hog_flows", _flow_payload())
+
+        assert response.status_code == status.HTTP_201_CREATED, response.json()
+        assert response.json()["created_by"] is None
+        flow = HogFlow.objects.get(id=response.json()["id"])
+        assert flow.team_id == self.team.id
+        assert flow.created_by is None
+
+        log = ActivityLog.objects.get(scope="HogFlow", item_id=str(flow.id), activity="created")
+        assert log.user is None
+        assert log.detail["trigger"] == {
+            "job_type": "project_secret_api_key",
+            "job_id": str(self.psak.id),
+            "payload": {"label": "ci-push"},
+        }
+
+    def test_psak_can_list_and_retrieve_flows(self):
+        flow_id = self._session_flow()
+
+        listed = self._psak_request("get", f"/api/projects/{self.team.id}/hog_flows")
+        assert listed.status_code == status.HTTP_200_OK, listed.json()
+        assert [row["id"] for row in listed.json()["results"]] == [flow_id]
+
+        retrieved = self._psak_request("get", f"/api/projects/{self.team.id}/hog_flows/{flow_id}")
+        assert retrieved.status_code == status.HTTP_200_OK, retrieved.json()
+        assert retrieved.json()["name"] == "CI Flow"
+
+    @parameterized.expand([("patch",), ("put",)])
+    def test_psak_update_writes_a_revision_and_activity_without_a_user(self, method):
+        flow_id = self._session_flow()
+
+        response = self._psak_request(
+            method, f"/api/projects/{self.team.id}/hog_flows/{flow_id}", _flow_payload("https://changed.example.com")
+        )
+
+        assert response.status_code == status.HTTP_200_OK, response.json()
+        flow = HogFlow.objects.get(id=flow_id)
+        assert flow.created_by == self.user
+        revision = HogFlowRevision.objects.get(hog_flow=flow, version=flow.version)
+        assert revision.created_by is None
+
+        log = ActivityLog.objects.get(scope="HogFlow", item_id=flow_id, activity="updated")
+        assert log.user is None
+        assert log.detail["trigger"]["job_type"] == "project_secret_api_key"
+
+    @parameterized.expand(
+        [
+            ("destroy", "delete", "{flow_id}", False, ["hog_flow:write"]),
+            ("bulk_delete", "post", "bulk_delete", True, ["hog_flow:write"]),
+            ("create_with_read_scope", "post", "", False, ["hog_flow:read"]),
+        ]
+    )
+    def test_psak_is_refused(self, _name, method, path, sends_ids, scopes):
+        flow_id = self._session_flow()
+        # Archived so that bulk_delete would remove the flow if the key got past the permission check.
+        HogFlow.objects.filter(id=flow_id).update(status=HogFlow.State.ARCHIVED)
+        token, _ = _make_psak(self.team, "refused", scopes)
+        data = {"ids": [flow_id]} if sends_ids else _flow_payload()
+
+        response = self._psak_request(
+            method, f"/api/projects/{self.team.id}/hog_flows/{path.format(flow_id=flow_id)}", data, token=token
+        )
+
+        assert response.status_code == status.HTTP_403_FORBIDDEN, response.content
+        assert list(HogFlow.objects.filter(team=self.team).values_list("id", flat=True)) == [uuid.UUID(flow_id)]
+
+    @parameterized.expand([("get", None), ("patch", {"name": "Hijacked"})])
+    def test_psak_cannot_reach_another_projects_flow(self, method, data):
+        other_team = Team.objects.create(organization=self.organization, name="Other project")
+        other_flow_id = self._session_flow(other_team)
+
+        response = self._psak_request(method, f"/api/projects/{other_team.id}/hog_flows/{other_flow_id}", data)
+
+        assert response.status_code == status.HTTP_403_FORBIDDEN, response.content
+        assert HogFlow.objects.get(id=other_flow_id).name == "CI Flow"
+
+
+@patch("posthog.rate_limit.is_rate_limit_enabled", return_value=True)
+class TestHogFlowPSAKRateLimit(APIBaseTest):
+    def setUp(self):
+        super().setUp()
+        self.client.logout()
+        cache.clear()
+
+    def tearDown(self):
+        cache.clear()
+        super().tearDown()
+
+    def _list(self, token: str):
+        return self.client.get(f"/api/projects/{self.team.id}/hog_flows", HTTP_AUTHORIZATION=f"Bearer {token}")
+
+    @patch("products.workflows.backend.api.hog_flow.HogFlowBurstRateThrottle.rate", new="2/minute")
+    def test_psak_requests_are_throttled_per_key(self, *_args):
+        token_a, _ = _make_psak(self.team, "key-a", ["hog_flow:read"])
+        token_b, _ = _make_psak(self.team, "key-b", ["hog_flow:read"])
+
+        for _ in range(2):
+            assert self._list(token_a).status_code == status.HTTP_200_OK
+        assert self._list(token_a).status_code == status.HTTP_429_TOO_MANY_REQUESTS
+        assert self._list(token_b).status_code == status.HTTP_200_OK
+
+    @patch("products.workflows.backend.api.hog_flow.HogFlowProjectSecretApiKeyTeamBurstThrottle.rate", new="3/minute")
+    def test_psak_keys_share_a_project_budget(self, *_args):
+        token_a, _ = _make_psak(self.team, "team-key-a", ["hog_flow:read"])
+        token_b, _ = _make_psak(self.team, "team-key-b", ["hog_flow:read"])
+
+        assert self._list(token_a).status_code == status.HTTP_200_OK
+        assert self._list(token_a).status_code == status.HTTP_200_OK
+        assert self._list(token_b).status_code == status.HTTP_200_OK
+        assert self._list(token_b).status_code == status.HTTP_429_TOO_MANY_REQUESTS

```

## Diff W

Files:
- frontend/src/lib/scopes.tsx (modified, +2 -0)
- posthog/scopes.py (modified, +5 -0)
- products/workflows/CONTRIBUTING.md (modified, +10 -0)
- products/workflows/backend/api/hog_flow.py (modified, +94 -8)
- products/workflows/backend/api/test/test_hog_flow_psak_auth.py (added, +211 -0)

```diff
diff --git a/frontend/src/lib/scopes.tsx b/frontend/src/lib/scopes.tsx
index e993b96d912..976c79e9e07 100644
--- a/frontend/src/lib/scopes.tsx
+++ b/frontend/src/lib/scopes.tsx
@@ -292,6 +292,8 @@ export const PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION = [
     'account:read',
     'loop:write',
     'experiment:read',
+    'hog_flow:read',
+    'hog_flow:write',
 ] as const
 
 export type ProjectSecretAPIKeyAllowedScope = (typeof PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION)[number]
diff --git a/posthog/scopes.py b/posthog/scopes.py
index 9c6099c182a..9348264b483 100644
--- a/posthog/scopes.py
+++ b/posthog/scopes.py
@@ -236,6 +236,11 @@ PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION: list[tuple[APIScopeObject, APIS
     # Read-only export of experiment definitions (list/retrieve), so services syncing
     # experiments into a warehouse don't need a credential tied to one person's account.
     ("experiment", "read"),
+    # A CI job pushes workflow definitions with a project-scoped service credential instead of a
+    # personal API key that stops working when its owner leaves. `read` on its own lets a job that
+    # only compares hold a key that cannot write.
+    ("hog_flow", "read"),
+    ("hog_flow", "write"),
 ]
 
 # Server-side scope assignment string-set constants (see RFC: server-side scope
diff --git a/products/workflows/CONTRIBUTING.md b/products/workflows/CONTRIBUTING.md
index 45a376779c4..e76f9405841 100644
--- a/products/workflows/CONTRIBUTING.md
+++ b/products/workflows/CONTRIBUTING.md
@@ -342,6 +342,16 @@ For anything emitted after the run has ended — a webhook, a callback — the v
 
 Building a version picker? The list of versions that have metrics is `{flow.version} ∪ {revision versions}`, not just the revisions endpoint. A workflow that has never been edited has zero `HogFlowRevision` rows but still reports metrics under `<flow id>/1`.
 
+## Pushing a workflow from CI
+
+A CI job that pushes a workflow definition authenticates with the project's secret API key (`phs_...`, sent as `Authorization: Bearer`), not with a personal API key.
+A personal key stops working when its owner leaves the project; the project key does not.
+Mint the key in project settings and give it the `hog_flow:write` scope.
+A job that only compares the file against the project needs `hog_flow:read`.
+The `hog_flows` endpoint accepts the key for `list`, `retrieve`, `create`, `update` and `partial_update` only.
+Deletes, publishing, revision restores and every invocation action refuse it.
+A write made with the key has no user behind it: `created_by` is null on the workflow and on its revisions, and the activity log records a system row whose trigger names the key by label.
+
 ## Common pitfalls
 
 - **Forgot the side-effect import**: triggers/actions must be imported by their `index.ts`, and async functions must be imported by nodejs/src/cdp/async-functions/index.ts.
diff --git a/products/workflows/backend/api/hog_flow.py b/products/workflows/backend/api/hog_flow.py
index 4969d7f148e..dc704fa2523 100644
--- a/products/workflows/backend/api/hog_flow.py
+++ b/products/workflows/backend/api/hog_flow.py
@@ -70,8 +70,8 @@ from posthog.api.hog_invocation_results import (
 from posthog.api.log_entries import LogEntryMixin
 from posthog.api.routing import TeamAndOrgViewSetMixin
 from posthog.api.shared import UserBasicSerializer
-from posthog.api.utils import log_activity_from_viewset
-from posthog.auth import InternalAPIAuthentication
+from posthog.api.utils import ACTIVITY_TYPES, log_activity_from_viewset
+from posthog.auth import InternalAPIAuthentication, ProjectSecretAPIKeyAuthentication
 from posthog.cdp.filters import compile_filters_expr
 from posthog.cdp.flag_gated_templates import FLAG_GATED_TEMPLATE_IDS, gated_template_enabled
 from posthog.cdp.validation import (
@@ -84,7 +84,8 @@ from posthog.cdp.validation import (
 from posthog.clickhouse.query_tagging import Feature, tag_queries
 from posthog.dataclasses import frozen
 from posthog.event_usage import AGENT_EVENT_SOURCES, EventSource, get_event_source, report_user_action
-from posthog.models import Team
+from posthog.models import Team, User
+from posthog.models.activity_logging.activity_log import Detail, Trigger, changes_between, log_activity
 from posthog.models.filters import Filter
 from posthog.models.integration import Integration
 from posthog.permissions import posthog_feature_flag_enabled
@@ -96,6 +97,7 @@ from posthog.plugins.plugin_server_api import (
     get_hog_flow_in_flight_count,
     rerun_hog_invocations,
 )
+from posthog.rate_limit import PersonalOrProjectSecretApiKeyRateThrottle, ProjectSecretApiKeyTeamRateThrottle
 from posthog.synthetic_user import SyntheticUser
 from posthog.user_permissions import UserPermissions
 from posthog.utils import relative_date_parse_with_delta_mapping
@@ -3344,7 +3346,7 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
     def create(self, validated_data: dict, *args, **kwargs) -> HogFlow:
         request = self.context["request"]
         team_id = self.context["team_id"]
-        validated_data["created_by"] = request.user
+        validated_data["created_by"] = _actor(request)
         validated_data["team_id"] = team_id
         self._strip_secret_inputs(validated_data)
 
@@ -3796,6 +3798,42 @@ class HogFlowPagination(LimitOffsetPagination):
     max_limit = 500
 
 
+# Names the project secret API key on the audit row of a write it made, because the row has no user.
+PSAK_TRIGGER_JOB_TYPE = "project_secret_api_key"
+
+
+def _actor(request: Request) -> Optional[User]:
+    # A project secret API key authenticates as a synthetic user with no row behind it, so a
+    # `created_by` column stores None for it instead of a made-up user.
+    user = request.user
+    return user if isinstance(user, User) else None
+
+
+class HogFlowBurstRateThrottle(PersonalOrProjectSecretApiKeyRateThrottle):
+    # Same scope and rate as the default BurstRateThrottle, so session and personal-key callers see
+    # no change. The PSAK-aware base also counts project secret API key requests, which the default
+    # throttles let through because they only key on a personal API key.
+    scope = "burst"
+    rate = "480/minute"
+
+
+class HogFlowSustainedRateThrottle(PersonalOrProjectSecretApiKeyRateThrottle):
+    scope = "sustained"
+    rate = "4800/hour"
+
+
+class HogFlowProjectSecretApiKeyTeamBurstThrottle(ProjectSecretApiKeyTeamRateThrottle):
+    # Per-project aggregate across all of the project's keys, the same size as the per-key budget,
+    # so minting more keys never multiplies a project's total capacity.
+    scope = "hog_flow_psak_team_burst"
+    rate = "480/minute"
+
+
+class HogFlowProjectSecretApiKeyTeamSustainedThrottle(ProjectSecretApiKeyTeamRateThrottle):
+    scope = "hog_flow_psak_team_sustained"
+    rate = "4800/hour"
+
+
 # The email body as a person reads it: the editor's plain-text export when it exists, otherwise the HTML
 # with style and script blocks and tags removed, so CSS, script and markup never match a search term.
 # The block patterns start with a non-greedy quantifier because Postgres gives a whole regex the
@@ -3973,6 +4011,18 @@ class HogFlowViewSet(
     pagination_class = HogFlowPagination
     filter_backends = [DjangoFilterBackend]
     filterset_class = HogFlowFilterSet
+    # Extends the default authenticators (TeamAndOrgViewSetMixin appends session/PAT/OAuth).
+    authentication_classes = [ProjectSecretAPIKeyAuthentication]
+    # A CI job pushes a workflow file with the project's secret API key, a credential not tied to one
+    # person's account. The push resolves, reads, creates and updates workflows and nothing else, so
+    # deletes, publishing, restores and every invocation action stay session/PAT/OAuth-only.
+    psak_allowed_actions = ["list", "retrieve", "create", "update", "partial_update"]
+    throttle_classes = [
+        HogFlowBurstRateThrottle,
+        HogFlowSustainedRateThrottle,
+        HogFlowProjectSecretApiKeyTeamBurstThrottle,
+        HogFlowProjectSecretApiKeyTeamSustainedThrottle,
+    ]
     log_source = "hog_flow"
     app_source = "hog_flow"
     function_kind = "hog_flow"
@@ -4258,6 +4308,42 @@ class HogFlowViewSet(
             ac_resource_type=self.scope_object,
         )
 
+    def _log_activity(
+        self,
+        instance: HogFlow,
+        *,
+        activity: Optional[str] = None,
+        previous: Optional[HogFlow] = None,
+        detail_type: Optional[str] = None,
+    ) -> None:
+        authenticator = self.request.successful_authenticator
+        if not isinstance(authenticator, ProjectSecretAPIKeyAuthentication):
+            log_activity_from_viewset(
+                self, instance, activity=activity, name=instance.name, previous=previous, detail_type=detail_type
+            )
+            return
+        # The shared helper hands the synthetic user to the ActivityLog user column and swallows the
+        # error, so nothing is logged. Write the row as a system row instead and name the key in the
+        # trigger, so a person can still see which credential wrote the workflow.
+        psak = authenticator.project_secret_api_key
+        log_activity(
+            organization_id=self.organization.id,
+            team_id=self.team.id,
+            user=None,
+            was_impersonated=False,
+            item_id=str(instance.id),
+            scope="HogFlow",
+            activity=activity or ACTIVITY_TYPES.get(self.action, ACTIVITY_TYPES["default"]),
+            detail=Detail(
+                name=instance.name,
+                type=detail_type,
+                changes=changes_between("HogFlow", previous=previous, current=instance)
+                if previous is not None
+                else None,
+                trigger=Trigger(job_type=PSAK_TRIGGER_JOB_TYPE, job_id=psak.id, payload={"label": psak.label}),
+            ),
+        )
+
     def _report_workflow_action(self, event: str, instance: HogFlow, extra_properties: Optional[dict] = None) -> None:
         # report_user_action injects source and MCP-client properties from the request, so usage is
         # attributable per channel (web builder vs MCP vs raw API). Capture must never break the request.
@@ -4286,7 +4372,7 @@ class HogFlowViewSet(
             )
 
         serializer.save()
-        log_activity_from_viewset(self, serializer.instance, name=serializer.instance.name, detail_type="standard")
+        self._log_activity(serializer.instance, detail_type="standard")
         self._emit_resource_edited(serializer.instance)
 
         self._report_workflow_action(
@@ -4427,7 +4513,7 @@ class HogFlowViewSet(
         if not route_to_draft:
             self._maybe_reschedule_timing_edits(before_update, serializer.instance)
             self._pause_schedules_on_audience_change(before_update, serializer.instance)
-        log_activity_from_viewset(self, serializer.instance, name=serializer.instance.name, previous=before_update)
+        self._log_activity(serializer.instance, previous=before_update)
         self._emit_resource_edited(serializer.instance)
 
         # PostHog capture for hog_flow activated (draft -> active)
@@ -4451,7 +4537,7 @@ class HogFlowViewSet(
         # usage event fires only after commit. delete() nulls the pk, so stash it for the event.
         flow_id = instance.id
         with transaction.atomic():
-            log_activity_from_viewset(self, instance, activity="deleted", name=instance.name)
+            self._log_activity(instance, activity="deleted")
             instance.delete()
         instance.id = flow_id
         self._report_workflow_action("hog_flow_deleted", instance, {"via": "destroy"})
@@ -4508,7 +4594,7 @@ class HogFlowViewSet(
             hog_flow=instance,
             version=instance.version,
             content=snapshot_flow_content(instance),
-            created_by=self.request.user if self.request.user.is_authenticated else None,
+            created_by=_actor(self.request),
         )
 
     def _write_draft(self, instance: HogFlow, locked: HogFlow, validated_data: dict) -> None:
diff --git a/products/workflows/backend/api/test/test_hog_flow_psak_auth.py b/products/workflows/backend/api/test/test_hog_flow_psak_auth.py
new file mode 100644
index 00000000000..898c747e090
--- /dev/null
+++ b/products/workflows/backend/api/test/test_hog_flow_psak_auth.py
@@ -0,0 +1,211 @@
+from posthog.test.base import APIBaseTest
+from unittest.mock import patch
+
+from django.core.cache import cache
+
+from parameterized import parameterized
+from rest_framework import status
+from rest_framework.test import APIClient
+
+from posthog.cdp.templates.hog_function_template import sync_template_to_db
+from posthog.models import Organization, ProjectSecretAPIKey, Team
+from posthog.models.activity_logging.activity_log import ActivityLog
+from posthog.models.personal_api_key import hash_key_value
+from posthog.models.utils import generate_random_token_secret
+
+from products.cdp.backend.api.test.test_hog_function_templates import MOCK_NODE_TEMPLATES
+from products.workflows.backend.api.hog_flow import (
+    PSAK_TRIGGER_JOB_TYPE,
+    HogFlowBurstRateThrottle,
+    HogFlowProjectSecretApiKeyTeamBurstThrottle,
+)
+from products.workflows.backend.models.hog_flow.hog_flow import HogFlow
+from products.workflows.backend.models.hog_flow_revision import HogFlowRevision
+
+webhook_template = MOCK_NODE_TEMPLATES[0]
+
+PSAK_REFUSED = "This action does not support project secret API key access"
+
+
+def _workflow(name: str = "Pushed from CI", url: str = "https://example.com/hook") -> dict:
+    return {
+        "name": name,
+        "actions": [
+            {
+                "id": "trigger_node",
+                "name": "trigger_1",
+                "type": "trigger",
+                "config": {
+                    "type": "event",
+                    "filters": {"events": [{"id": "$pageview", "name": "$pageview", "type": "events", "order": 0}]},
+                },
+            },
+            {
+                "id": "action_1",
+                "name": "action_1",
+                "type": "function",
+                "config": {"template_id": "template-webhook", "inputs": {"url": {"value": url}}},
+            },
+        ],
+        "edges": [{"from": "trigger_node", "to": "action_1", "type": "continue"}],
+    }
+
+
+class TestHogFlowProjectSecretApiKeyAuth(APIBaseTest):
+    def setUp(self):
+        super().setUp()
+        sync_template_to_db(webhook_template)
+        cache.clear()
+        # A CI job holds no session, so every service request goes through a fresh client.
+        self.service = APIClient()
+        self.token = self._mint_psak(self.team, ["hog_flow:write"], label="ci push key")
+
+    def _mint_psak(self, team: Team, scopes: list[str], label: str | None = None) -> str:
+        raw_token = generate_random_token_secret()
+        ProjectSecretAPIKey.objects.create(
+            team=team,
+            # Labels are unique per team, so a second key in one test needs its own.
+            label=label or f"ci key {raw_token[-6:]}",
+            secure_value=hash_key_value(raw_token),
+            scopes=scopes,
+            mask_value=f"{raw_token[:4]}...{raw_token[-4:]}",
+        )
+        return raw_token
+
+    def _bearer(self, token: str) -> dict:
+        return {"authorization": f"Bearer {token}"}
+
+    def _url(self, suffix: str = "", team: Team | None = None) -> str:
+        return f"/api/projects/{(team or self.team).id}/hog_flows/{suffix}"
+
+    def _create_with_session(self) -> str:
+        response = self.client.post(self._url(), _workflow())
+        assert response.status_code == status.HTTP_201_CREATED, response.json()
+        return response.json()["id"]
+
+    def _psak_audit_detail(self, flow_id: str, activity: str) -> dict:
+        audit = ActivityLog.objects.get(scope="HogFlow", item_id=flow_id, activity=activity)
+        assert audit.user_id is None
+        assert audit.is_system is True
+        assert audit.detail is not None
+        assert audit.detail["trigger"]["job_type"] == PSAK_TRIGGER_JOB_TYPE
+        return audit.detail
+
+    def test_psak_create_writes_the_row_and_the_audit_row_without_a_user(self):
+        response = self.service.post(self._url(), _workflow(), format="json", headers=self._bearer(self.token))
+
+        assert response.status_code == status.HTTP_201_CREATED, response.json()
+        assert response.json()["created_by"] is None
+        flow = HogFlow.objects.get(id=response.json()["id"])
+        assert flow.created_by_id is None
+        assert flow.team_id == self.team.id
+
+        detail = self._psak_audit_detail(str(flow.id), "created")
+        assert detail["trigger"]["payload"] == {"label": "ci push key"}
+
+    def test_psak_update_bumps_the_version_and_writes_the_revision_without_a_user(self):
+        flow_id = self._create_with_session()
+
+        response = self.service.patch(
+            self._url(flow_id),
+            {"actions": _workflow(url="https://example.com/v2")["actions"]},
+            format="json",
+            headers=self._bearer(self.token),
+        )
+
+        assert response.status_code == status.HTTP_200_OK, response.json()
+        flow = HogFlow.objects.get(id=flow_id)
+        assert flow.version == 2
+        # The session user who created the flow stays its creator; only the revision is unattributed.
+        assert flow.created_by_id == self.user.id
+        revision = HogFlowRevision.objects.for_team(self.team.id).get(hog_flow=flow, version=2)
+        assert revision.created_by_id is None
+        detail = self._psak_audit_detail(flow_id, "updated")
+        assert any(change["field"] == "actions" for change in detail["changes"])
+
+    def test_psak_lists_and_retrieves_the_projects_workflows(self):
+        flow_id = self._create_with_session()
+
+        listed = self.service.get(self._url(), headers=self._bearer(self.token))
+        fetched = self.service.get(self._url(flow_id), headers=self._bearer(self.token))
+
+        assert listed.status_code == status.HTTP_200_OK, listed.json()
+        assert [row["id"] for row in listed.json()["results"]] == [flow_id]
+        assert fetched.status_code == status.HTTP_200_OK, fetched.json()
+        assert fetched.json()["id"] == flow_id
+
+    @parameterized.expand(
+        [
+            ("read_only_key_reads_but_cannot_write", ["hog_flow:read"], status.HTTP_200_OK, status.HTTP_403_FORBIDDEN),
+            ("unrelated_scope_is_refused", ["feature_flag:read"], status.HTTP_403_FORBIDDEN, status.HTTP_403_FORBIDDEN),
+        ]
+    )
+    def test_psak_scope_decides_what_the_key_may_do(self, _name, scopes, expected_list, expected_create):
+        token = self._mint_psak(self.team, scopes)
+
+        listed = self.service.get(self._url(), headers=self._bearer(token))
+        created = self.service.post(self._url(), _workflow(), format="json", headers=self._bearer(token))
+
+        assert listed.status_code == expected_list, listed.json()
+        assert created.status_code == expected_create, created.json()
+        assert HogFlow.objects.count() == 0
+
+    @parameterized.expand(
+        [
+            ("destroy", "delete", "{id}"),
+            ("bulk_delete", "post", "bulk_delete"),
+            ("publish", "post", "{id}/publish"),
+            ("invocations", "post", "{id}/invocations"),
+            ("restore_revision", "post", "{id}/revisions/1/restore"),
+        ]
+    )
+    def test_psak_is_refused_outside_the_push_actions(self, _name, method, path):
+        flow_id = self._create_with_session()
+
+        response = getattr(self.service, method)(
+            self._url(path.format(id=flow_id)),
+            {"ids": [flow_id]},
+            format="json",
+            headers=self._bearer(self.token),
+        )
+
+        assert response.status_code == status.HTTP_403_FORBIDDEN, response.json()
+        assert response.json()["detail"] == PSAK_REFUSED
+        assert HogFlow.objects.filter(id=flow_id).exists()
+
+    def test_psak_of_another_project_cannot_read_or_write_this_projects_workflows(self):
+        flow_id = self._create_with_session()
+        other_org = Organization.objects.create(name="other org")
+        other_team = Team.objects.create(organization=other_org, name="other team")
+        foreign_token = self._mint_psak(other_team, ["hog_flow:write"])
+
+        listed = self.service.get(self._url(), headers=self._bearer(foreign_token))
+        fetched = self.service.get(self._url(flow_id), headers=self._bearer(foreign_token))
+        patched = self.service.patch(
+            self._url(flow_id), {"name": "hijacked"}, format="json", headers=self._bearer(foreign_token)
+        )
+        created = self.service.post(self._url(), _workflow(), format="json", headers=self._bearer(foreign_token))
+
+        assert listed.status_code == status.HTTP_403_FORBIDDEN, listed.json()
+        assert fetched.status_code == status.HTTP_403_FORBIDDEN, fetched.json()
+        assert patched.status_code == status.HTTP_403_FORBIDDEN, patched.json()
+        assert created.status_code == status.HTTP_403_FORBIDDEN, created.json()
+        assert HogFlow.objects.get(id=flow_id).name == "Pushed from CI"
+        assert HogFlow.objects.count() == 1
+
+    @parameterized.expand(
+        [
+            ("per_key", HogFlowBurstRateThrottle, False),
+            ("per_project_across_keys", HogFlowProjectSecretApiKeyTeamBurstThrottle, True),
+        ]
+    )
+    @patch("posthog.rate_limit.is_rate_limit_enabled", return_value=True)
+    def test_psak_requests_are_throttled(self, _name, throttle, second_request_uses_a_new_key, _enabled):
+        second_token = self._mint_psak(self.team, ["hog_flow:write"]) if second_request_uses_a_new_key else self.token
+
+        with patch.object(throttle, "rate", "1/minute"):
+            first = self.service.get(self._url(), headers=self._bearer(self.token))
+            second = self.service.get(self._url(), headers=self._bearer(second_token))
+
+        assert first.status_code == status.HTTP_200_OK, first.json()
+        assert second.status_code == status.HTTP_429_TOO_MANY_REQUESTS, second.json()

```

## Diff V

Files:
- frontend/src/lib/scopes.tsx (modified, +2 -0)
- posthog/scopes.py (modified, +4 -0)
- products/workflows/CONTRIBUTING.md (modified, +4 -0)
- products/workflows/backend/api/hog_flow.py (modified, +95 -11)
- products/workflows/backend/api/test/test_hog_flow_psak_auth.py (added, +194 -0)

```diff
diff --git a/frontend/src/lib/scopes.tsx b/frontend/src/lib/scopes.tsx
index e993b96d912..976c79e9e07 100644
--- a/frontend/src/lib/scopes.tsx
+++ b/frontend/src/lib/scopes.tsx
@@ -292,6 +292,8 @@ export const PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION = [
     'account:read',
     'loop:write',
     'experiment:read',
+    'hog_flow:read',
+    'hog_flow:write',
 ] as const
 
 export type ProjectSecretAPIKeyAllowedScope = (typeof PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION)[number]
diff --git a/posthog/scopes.py b/posthog/scopes.py
index 9c6099c182a..1dc16e4b159 100644
--- a/posthog/scopes.py
+++ b/posthog/scopes.py
@@ -236,6 +236,10 @@ PROJECT_SECRET_API_KEY_ALLOWED_API_SCOPE_ACTION: list[tuple[APIScopeObject, APIS
     # Read-only export of experiment definitions (list/retrieve), so services syncing
     # experiments into a warehouse don't need a credential tied to one person's account.
     ("experiment", "read"),
+    # Workflows pushed from CI: list/retrieve/create/update on hog_flows only. Deletes, publish and
+    # invocations are refused by the viewset's psak_allowed_actions, whatever the key's scopes are.
+    ("hog_flow", "read"),
+    ("hog_flow", "write"),
 ]
 
 # Server-side scope assignment string-set constants (see RFC: server-side scope
diff --git a/products/workflows/CONTRIBUTING.md b/products/workflows/CONTRIBUTING.md
index 45a376779c4..59225a78f1d 100644
--- a/products/workflows/CONTRIBUTING.md
+++ b/products/workflows/CONTRIBUTING.md
@@ -342,6 +342,10 @@ For anything emitted after the run has ended — a webhook, a callback — the v
 
 Building a version picker? The list of versions that have metrics is `{flow.version} ∪ {revision versions}`, not just the revisions endpoint. A workflow that has never been edited has zero `HogFlowRevision` rows but still reports metrics under `<flow id>/1`.
 
+## Pushing workflows from CI
+
+A CI job that pushes workflows authenticates with a project secret API key (`phs_...`, sent as `Authorization: Bearer`) that has the `hog_flow:write` scope, or `hog_flow:read` for a read-only check. Do not use a personal API key: it stops working when its owner leaves the project, and it acts with that person's access. The key may only list, retrieve, create and update workflows. Deleting, publishing, running and every other workflow action refuse it. A workflow the key creates has no `created_by`, and its activity log rows have no user but name the key (label and masked value) in the row's trigger.
+
 ## Common pitfalls
 
 - **Forgot the side-effect import**: triggers/actions must be imported by their `index.ts`, and async functions must be imported by nodejs/src/cdp/async-functions/index.ts.
diff --git a/products/workflows/backend/api/hog_flow.py b/products/workflows/backend/api/hog_flow.py
index 4969d7f148e..fe273872361 100644
--- a/products/workflows/backend/api/hog_flow.py
+++ b/products/workflows/backend/api/hog_flow.py
@@ -71,7 +71,7 @@ from posthog.api.log_entries import LogEntryMixin
 from posthog.api.routing import TeamAndOrgViewSetMixin
 from posthog.api.shared import UserBasicSerializer
 from posthog.api.utils import log_activity_from_viewset
-from posthog.auth import InternalAPIAuthentication
+from posthog.auth import InternalAPIAuthentication, ProjectSecretAPIKeyAuthentication
 from posthog.cdp.filters import compile_filters_expr
 from posthog.cdp.flag_gated_templates import FLAG_GATED_TEMPLATE_IDS, gated_template_enabled
 from posthog.cdp.validation import (
@@ -85,9 +85,10 @@ from posthog.clickhouse.query_tagging import Feature, tag_queries
 from posthog.dataclasses import frozen
 from posthog.event_usage import AGENT_EVENT_SOURCES, EventSource, get_event_source, report_user_action
 from posthog.models import Team
+from posthog.models.activity_logging.activity_log import Detail, Trigger, changes_between, log_activity
 from posthog.models.filters import Filter
 from posthog.models.integration import Integration
-from posthog.permissions import posthog_feature_flag_enabled
+from posthog.permissions import is_authenticated_via_project_secret_api_key, posthog_feature_flag_enabled
 from posthog.plugins.plugin_server_api import (
     cancel_hog_flow_batch_job,
     cancel_hog_flow_invocations,
@@ -96,6 +97,12 @@ from posthog.plugins.plugin_server_api import (
     get_hog_flow_in_flight_count,
     rerun_hog_invocations,
 )
+from posthog.rate_limit import (
+    BurstRateThrottle,
+    PersonalOrProjectSecretApiKeyRateThrottle,
+    ProjectSecretApiKeyTeamRateThrottle,
+    SustainedRateThrottle,
+)
 from posthog.synthetic_user import SyntheticUser
 from posthog.user_permissions import UserPermissions
 from posthog.utils import relative_date_parse_with_delta_mapping
@@ -201,6 +208,14 @@ from products.workflows.backend.utils.rrule_utils import compute_next_occurrence
 logger = structlog.get_logger(__name__)
 
 
+def _real_user(user: Any) -> Any:
+    # A project secret API key authenticates as a SyntheticUser with no User row, so it can't be
+    # stored in a created_by foreign key or own a "Create AI task" step.
+    if user is None or not user.is_authenticated or isinstance(user, SyntheticUser):
+        return None
+    return user
+
+
 # The content of a workflow: everything the draft cycle stages and publish promotes, and nothing
 # else. Metadata (name, description) and lifecycle (status) always apply to the live row. The draft
 # blob is a full snapshot of these fields so publish is a plain copy, not a merge.
@@ -3042,13 +3057,11 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
 
         # Who a "Create AI task" step runs as: the existing creator for an update, or the
         # requesting user for a brand-new flow (matches the `created_by` a create() actually
-        # writes). None outside a request (internal re-saves), where the skills check is skipped.
+        # writes). None outside a request (internal re-saves) and for a project secret API key,
+        # where the skills check is skipped.
         owner = instance.created_by if instance else None
         if owner is None:
-            request = self.context.get("request")
-            user = getattr(request, "user", None)
-            if user is not None and getattr(user, "is_authenticated", False):
-                owner = user
+            owner = _real_user(getattr(self.context.get("request"), "user", None))
         self.context["workflow_owner_id"] = owner.id if owner else None
 
         # Wait conditions the live flow already carries, so per-action validation can tell a newly
@@ -3344,7 +3357,7 @@ class HogFlowSerializer(HogFlowMinimalSerializer):
     def create(self, validated_data: dict, *args, **kwargs) -> HogFlow:
         request = self.context["request"]
         team_id = self.context["team_id"]
-        validated_data["created_by"] = request.user
+        validated_data["created_by"] = _real_user(request.user)
         validated_data["team_id"] = team_id
         self._strip_secret_inputs(validated_data)
 
@@ -3897,6 +3910,29 @@ def mint_audience_confirm_token(
 WRITABLE_DRAFT_CONTENT_FIELDS = frozenset(DRAFT_CONTENT_FIELDS) - frozenset(HogFlowSerializer.Meta.read_only_fields)
 
 
+class HogFlowProjectSecretApiKeyBurstThrottle(PersonalOrProjectSecretApiKeyRateThrottle):
+    # The default burst/sustained throttles skip PSAK requests, so a CI key gets the same per-key
+    # budget here that a personal API key gets from them.
+    scope = "hog_flow_psak_burst"
+    rate = BurstRateThrottle.rate
+
+
+class HogFlowProjectSecretApiKeySustainedThrottle(PersonalOrProjectSecretApiKeyRateThrottle):
+    scope = "hog_flow_psak_sustained"
+    rate = SustainedRateThrottle.rate
+
+
+class HogFlowProjectSecretApiKeyTeamBurstThrottle(ProjectSecretApiKeyTeamRateThrottle):
+    # Caps a project's total PSAK load at one key's budget, so minting more keys adds no capacity.
+    scope = "hog_flow_psak_team_burst"
+    rate = BurstRateThrottle.rate
+
+
+class HogFlowProjectSecretApiKeyTeamSustainedThrottle(ProjectSecretApiKeyTeamRateThrottle):
+    scope = "hog_flow_psak_team_sustained"
+    rate = SustainedRateThrottle.rate
+
+
 @extend_schema(extensions={"x-product": "workflows"})
 @extend_schema_view(
     list=extend_schema(
@@ -3935,6 +3971,10 @@ class HogFlowViewSet(
     TeamAndOrgViewSetMixin, AccessControlViewSetMixin, LogEntryMixin, AppMetricsMixin, viewsets.ModelViewSet
 ):
     scope_object = "hog_flow"
+    authentication_classes = [ProjectSecretAPIKeyAuthentication]
+    # A CI push resolves, reads, creates and updates workflows. Deletes, publishing and anything
+    # that runs a workflow stay with people.
+    psak_allowed_actions = ["list", "retrieve", "create", "update", "partial_update"]
     scope_object_read_actions = [
         "list",
         "retrieve",
@@ -4022,6 +4062,17 @@ class HogFlowViewSet(
             return ["hog_flow:write", "person:read", "group:read"]
         return None
 
+    def get_throttles(self):
+        throttles = super().get_throttles()
+        if self.action in self.psak_allowed_actions:
+            throttles += [
+                HogFlowProjectSecretApiKeyBurstThrottle(),
+                HogFlowProjectSecretApiKeySustainedThrottle(),
+                HogFlowProjectSecretApiKeyTeamBurstThrottle(),
+                HogFlowProjectSecretApiKeyTeamSustainedThrottle(),
+            ]
+        return throttles
+
     def get_serializer_class(self) -> type[BaseSerializer]:
         if self.action == "list":
             # MCP list ("workflows-list") is a discovery/summary tool — return metadata only so it
@@ -4270,6 +4321,9 @@ class HogFlowViewSet(
                     "workflow_name": instance.name,
                     "team_id": str(self.team_id),
                     "organization_id": str(self.organization.id),
+                    "auth_method": "project_secret_api_key"
+                    if is_authenticated_via_project_secret_api_key(self.request)
+                    else "user",
                     **(extra_properties or {}),
                 },
                 team=self.team,
@@ -4278,6 +4332,36 @@ class HogFlowViewSet(
         except Exception as e:
             logger.warning("Failed to capture workflow usage event", event=event, error=str(e))
 
+    def _log_write_activity(self, instance: HogFlow, previous: Optional[HogFlow] = None, **kwargs: Any) -> None:
+        authenticator = self.request.successful_authenticator
+        if not isinstance(authenticator, ProjectSecretAPIKeyAuthentication):
+            log_activity_from_viewset(self, instance, name=instance.name, previous=previous, **kwargs)
+            return
+        # log_activity_from_viewset writes request.user, and the PSAK's SyntheticUser has no User row,
+        # so the row would fail and be dropped. Write it with no user and name the key in the trigger.
+        psak = authenticator.project_secret_api_key
+        log_activity(
+            organization_id=self.organization.id,
+            team_id=self.team_id,
+            user=None,
+            was_impersonated=False,
+            item_id=str(instance.id),
+            scope="HogFlow",
+            activity="created" if self.action == "create" else "updated",
+            detail=Detail(
+                name=instance.name,
+                type=kwargs.get("detail_type"),
+                changes=changes_between("HogFlow", previous=previous, current=instance)
+                if previous is not None
+                else None,
+                trigger=Trigger(
+                    job_type="project_secret_api_key",
+                    job_id=str(psak.id),
+                    payload={"label": psak.label, "mask_value": psak.mask_value},
+                ),
+            ),
+        )
+
     def perform_create(self, serializer):
         if self._is_mcp_request(self.request) and serializer.validated_data.get("status") == HogFlow.State.ACTIVE:
             raise exceptions.ValidationError(
@@ -4286,7 +4370,7 @@ class HogFlowViewSet(
             )
 
         serializer.save()
-        log_activity_from_viewset(self, serializer.instance, name=serializer.instance.name, detail_type="standard")
+        self._log_write_activity(serializer.instance, detail_type="standard")
         self._emit_resource_edited(serializer.instance)
 
         self._report_workflow_action(
@@ -4427,7 +4511,7 @@ class HogFlowViewSet(
         if not route_to_draft:
             self._maybe_reschedule_timing_edits(before_update, serializer.instance)
             self._pause_schedules_on_audience_change(before_update, serializer.instance)
-        log_activity_from_viewset(self, serializer.instance, name=serializer.instance.name, previous=before_update)
+        self._log_write_activity(serializer.instance, previous=before_update)
         self._emit_resource_edited(serializer.instance)
 
         # PostHog capture for hog_flow activated (draft -> active)
@@ -4508,7 +4592,7 @@ class HogFlowViewSet(
             hog_flow=instance,
             version=instance.version,
             content=snapshot_flow_content(instance),
-            created_by=self.request.user if self.request.user.is_authenticated else None,
+            created_by=_real_user(self.request.user),
         )
 
     def _write_draft(self, instance: HogFlow, locked: HogFlow, validated_data: dict) -> None:
diff --git a/products/workflows/backend/api/test/test_hog_flow_psak_auth.py b/products/workflows/backend/api/test/test_hog_flow_psak_auth.py
new file mode 100644
index 00000000000..2a21373f903
--- /dev/null
+++ b/products/workflows/backend/api/test/test_hog_flow_psak_auth.py
@@ -0,0 +1,194 @@
+from posthog.test.base import APIBaseTest
+from unittest.mock import patch
+
+from parameterized import parameterized
+from rest_framework import status
+
+from posthog.cdp.templates.hog_function_template import sync_template_to_db
+from posthog.models import Organization, Team
+from posthog.models.activity_logging.activity_log import ActivityLog
+from posthog.models.project_secret_api_key import ProjectSecretAPIKey
+from posthog.models.utils import hash_key_value
+
+from products.cdp.backend.api.test.test_hog_function_templates import MOCK_NODE_TEMPLATES
+from products.workflows.backend.models.hog_flow.hog_flow import HogFlow
+from products.workflows.backend.models.hog_flow_revision import HogFlowRevision
+
+HOG_FLOW_SCOPES = ["hog_flow:read", "hog_flow:write"]
+
+
+def _make_psak(team: Team, label: str, scopes: list[str] = HOG_FLOW_SCOPES) -> tuple[str, ProjectSecretAPIKey]:
+    # The authenticator only accepts phs_ followed by alphanumerics.
+    suffix = "".join(c for c in label if c.isalnum())
+    token = "phs_" + ("a" * 35) + suffix
+    psak = ProjectSecretAPIKey.objects.create(
+        team=team,
+        label=label,
+        mask_value=f"phs_...{suffix[:4]}",
+        secure_value=hash_key_value(token),
+        scopes=scopes,
+    )
+    return token, psak
+
+
+def _trigger_action() -> dict:
+    return {
+        "id": "trigger_node",
+        "name": "trigger_1",
+        "type": "trigger",
+        "config": {
+            "type": "event",
+            "filters": {"events": [{"id": "$pageview", "name": "$pageview", "type": "events", "order": 0}]},
+        },
+    }
+
+
+def _webhook_action(url: str = "https://example.com") -> dict:
+    return {
+        "id": "action_1",
+        "name": "action_1",
+        "type": "function",
+        "config": {"template_id": "template-webhook", "inputs": {"url": {"value": url}}},
+    }
+
+
+class TestHogFlowPSAKAuth(APIBaseTest):
+    def setUp(self):
+        super().setUp()
+        sync_template_to_db(MOCK_NODE_TEMPLATES[0])
+        self.token, self.psak = _make_psak(self.team, "ci-push")
+        self.flow = HogFlow.objects.create(
+            team=self.team, name="Existing", created_by=self.user, actions=[_trigger_action()]
+        )
+        # Only the Bearer header may authenticate, so a session cookie cannot mask a refusal.
+        self.client.logout()
+
+    def _psak(self, token: str | None = None) -> dict:
+        return {"HTTP_AUTHORIZATION": f"Bearer {token or self.token}"}
+
+    def _url(self, team: Team | None = None, suffix: str = "") -> str:
+        return f"/api/projects/{(team or self.team).id}/hog_flows{suffix}"
+
+    def test_psak_lists_and_retrieves_workflows(self):
+        listed = self.client.get(self._url(), **self._psak())
+        assert listed.status_code == status.HTTP_200_OK, listed.content
+        assert [row["id"] for row in listed.json()["results"]] == [str(self.flow.id)]
+
+        retrieved = self.client.get(self._url(suffix=f"/{self.flow.id}"), **self._psak())
+        assert retrieved.status_code == status.HTTP_200_OK, retrieved.content
+        assert retrieved.json()["name"] == "Existing"
+
+    @patch("posthog.event_usage.posthoganalytics.capture")
+    def test_psak_create_stores_no_user_and_says_so_in_the_activity_log(self, mock_capture):
+        response = self.client.post(
+            self._url(),
+            {"name": "Pushed from CI", "actions": [_trigger_action(), _webhook_action()]},
+            content_type="application/json",
+            **self._psak(),
+        )
+
+        assert response.status_code == status.HTTP_201_CREATED, response.content
+        body = response.json()
+        assert body["name"] == "Pushed from CI"
+        assert body["created_by"] is None
+        assert HogFlow.objects.get(id=body["id"]).created_by is None
+
+        entry = ActivityLog.objects.get(scope="HogFlow", item_id=body["id"], activity="created")
+        assert entry.user is None
+        assert entry.detail is not None
+        assert entry.detail["trigger"] == {
+            "job_type": "project_secret_api_key",
+            "job_id": str(self.psak.id),
+            "payload": {"label": "ci-push", "mask_value": self.psak.mask_value},
+        }
+
+        created_events = [c for c in mock_capture.call_args_list if c.kwargs.get("event") == "hog_flow_created"]
+        assert len(created_events) == 1
+        assert created_events[0].kwargs["distinct_id"] == f"psak-{self.team.id}-{self.psak.id}"
+        assert created_events[0].kwargs["properties"]["auth_method"] == "project_secret_api_key"
+
+    @parameterized.expand([("patch",), ("put",)])
+    def test_psak_update_writes_revision_without_user(self, method: str):
+        # PSAK create does not write revision 1 on this base, so the update path's revision is the proof.
+        created = self.client.post(
+            self._url(),
+            {"name": "Revisioned", "actions": [_trigger_action(), _webhook_action()]},
+            content_type="application/json",
+            **self._psak(),
+        )
+        assert created.status_code == status.HTTP_201_CREATED, created.content
+        flow_id = created.json()["id"]
+
+        response = getattr(self.client, method)(
+            self._url(suffix=f"/{flow_id}"),
+            {"name": "Revisioned", "actions": [_trigger_action(), _webhook_action("https://changed.example.com")]},
+            content_type="application/json",
+            **self._psak(),
+        )
+
+        assert response.status_code == status.HTTP_200_OK, response.content
+        revisions = HogFlowRevision.objects.filter(hog_flow_id=flow_id).order_by("version")
+        assert [(r.version, r.created_by_id) for r in revisions] == [(1, None), (2, None)]
+
+        entry = ActivityLog.objects.get(scope="HogFlow", item_id=flow_id, activity="updated")
+        assert entry.user is None
+        assert entry.detail is not None
+        assert entry.detail["trigger"]["job_type"] == "project_secret_api_key"
+        assert entry.detail["changes"]
+
+    @parameterized.expand(
+        [
+            ("destroy", "delete", "/{id}", None),
+            ("bulk_delete", "post", "/bulk_delete", lambda flow_id: {"ids": [flow_id]}),
+            ("publish", "post", "/{id}/publish", lambda flow_id: {}),
+            ("revisions", "get", "/{id}/revisions", None),
+        ]
+    )
+    def test_psak_refused_on_actions_outside_the_push(self, _name, method, suffix, body):
+        self.flow.status = HogFlow.State.ARCHIVED
+        self.flow.save()
+        kwargs = {"content_type": "application/json", "data": body(str(self.flow.id))} if body is not None else {}
+
+        response = getattr(self.client, method)(
+            self._url(suffix=suffix.format(id=self.flow.id)), **kwargs, **self._psak()
+        )
+
+        assert response.status_code == status.HTTP_403_FORBIDDEN, response.content
+        assert HogFlow.objects.filter(id=self.flow.id).exists()
+
+    def test_psak_without_write_scope_cannot_create(self):
+        token, _ = _make_psak(self.team, "read-only", scopes=["hog_flow:read"])
+
+        response = self.client.post(self._url(), {"name": "Nope"}, content_type="application/json", **self._psak(token))
+
+        assert response.status_code == status.HTTP_403_FORBIDDEN, response.content
+
+    def test_psak_cannot_reach_another_teams_workflows(self):
+        other_team = Team.objects.create(organization=Organization.objects.create(name="Other"), name="Other")
+        other_flow = HogFlow.objects.create(team=other_team, name="Theirs", actions=[_trigger_action()])
+
+        responses = [
+            self.client.get(self._url(other_team), **self._psak()),
+            self.client.get(self._url(other_team, f"/{other_flow.id}"), **self._psak()),
+            self.client.post(
+                self._url(other_team), {"name": "Planted"}, content_type="application/json", **self._psak()
+            ),
+            self.client.patch(
+                self._url(other_team, f"/{other_flow.id}"),
+                {"name": "Hijacked"},
+                content_type="application/json",
+                **self._psak(),
+            ),
+            # Same key against its own team's URL but another team's workflow id.
+            self.client.patch(
+                self._url(suffix=f"/{other_flow.id}"),
+                {"name": "Hijacked"},
+                content_type="application/json",
+                **self._psak(),
+            ),
+        ]
+
+        assert [r.status_code for r in responses] == [403, 403, 403, 403, 404]
+        other_flow.refresh_from_db()
+        assert other_flow.name == "Theirs"
+        assert not HogFlow.objects.filter(team=other_team, name="Planted").exists()

```

## How to score

Score every diff (X, Y, Z, W, V) from 1 (poor) to 10 (excellent) on each dimension, and justify every score in one to three sentences that cite files or imports from the diff:

- `seams`: Seams and interfaces: does the change cross module boundaries through deliberate, narrow interfaces?
- `cohesion`: Cohesion and module placement: does each new piece of code live in the module that owns its concern?
- `coupling`: Coupling: does the change avoid new dependencies, and reaching into other modules' internals?
- `fit`: Repository architecture fit: does the change follow PostHog's documented product architecture (products/architecture.md)?
- `overall`: Overall architecture quality of the change, as a reviewer who owns this codebase would rate it.

Judge architecture, not completeness of features or test coverage. A diff that is truncated here was truncated for length; judge what you can see and its file list. Answer with JSON only, matching the schema you were given.