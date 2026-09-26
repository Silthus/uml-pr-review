# Architecture Explorer Design Brief

Branch: `prototype/explorer-design`  
Prototype: `prototype/explorer-design/index.html`  
Data: `prototype/explorer-design/data/posthog-architecture.json`, derived read-only from `~/dev/posthog` with 340 modules and 320 rough import bundles.

## Recommendation

Build the implementation with **React Flow for interaction/state and elkjs for layout**, not hand-rolled SVG.

Measured prototype notes on the 50+ node view:

- Hand-rolled SVG in this prototype renders a 63-module stress view and mode switch in about **0.2-0.3 ms** of event handler time, so raw SVG is fast enough.
- The hard part is not drawing rectangles. It is pan/zoom, hit testing, keyboard navigation, selection state, edge routing updates, fit-to-selection, minimap, accessibility, and future virtualization. React Flow already gives those primitives and keeps them testable as React components.
- elkjs should own initial layout and relayout after expand/drill/focus changes. React Flow should own interaction, viewport, selection, handles, edge labels, and animated patching when the agent changes the plan.
- Hand-rolled SVG remains useful for the self-contained v1 artifact. The live explorer is an app surface with persistent state and collaboration affordances, so framework primitives are worth the dependency.

## Visual direction

Use the v1 **Blueprint with untouched neighbors hidden** decision as the north star. The explorer is a sibling of the artifact renderer, not a new product surface.

- The canvas is a Blueprint sheet: dotted paper, thin stroked modules, small monospace labels, restrained color, dark mode parity.
- Files/modules are the primary unit. For the architecture explorer, modules are directory-derived packages; nested product modules render as `products/<name>/backend`, `products/<name>/frontend`, and `products/<name>/shared` so frontend/backend seams do not blur together.
- Edges are quiet until selected. Counts and evidence live in the side panel and one-click edge labels, not as permanent visual noise.
- The plan overlays the same canvas. Avoid a separate “plan board” that forces users to mentally reconcile two representations.

## Design tokens

Typography:

- Sans: `-apple-system, BlinkMacSystemFont, "Helvetica Neue", Inter, system-ui, sans-serif`
- Mono: `ui-monospace, "SF Mono", SFMono-Regular, Menlo, "Cascadia Mono", Consolas, monospace`
- Body: 14 / 1.45
- Module label: 12px mono semibold
- Evidence/path label: 10-11px mono

Surfaces:

- Light paper: `oklch(0.975 0.004 250)`
- Light card: `oklch(0.995 0.002 250)`
- Dark paper: `oklch(0.2 0.012 262)`
- Dark card: `oklch(0.235 0.013 262)`
- Hairline: current ink at 16-34% alpha

Semantic status:

- Conforming: green, `oklch(0.56 0.15 152)` light / `oklch(0.74 0.16 152)` dark
- Pending: amber, `oklch(0.7 0.14 76)` light / `oklch(0.79 0.14 80)` dark
- Violating: red, `oklch(0.54 0.19 26)` light / `oklch(0.7 0.16 24)` dark

Module identity palette:

- Product: blue
- Frontend: teal
- Backend: amber
- Package/other: purple-gray
- Light categorical validation passed with `#5d75d6,#209c8a,#b8831d,#8a67c7`.
- Dark categorical validation passed with `#6f80dc,#169982,#ac8628,#8a69c6`.
- Identity is never color-only: every module also carries a kind label and left rail.

## Component inventory

- `ExplorerShell`: masthead, state tabs, canvas, side panel.
- `ArchitectureCanvas`: React Flow viewport with Blueprint background, nodes, edge labels, bundled-edge counters, selection state.
- `ModuleNode`: module/file card with kind rail, file count, mini file bars, plan badge, comment target.
- `ModuleGroup`: overview-level family card with child module samples.
- `DependencyEdge`: bundled import edge with count, direction, hover highlight, evidence popover.
- `PlanSeamEdge`: planned add/remove/keep seam with interface label and conformance stroke.
- `Breadcrumbs`: repo → package → product → side navigation; supports drill-up.
- `InspectorPanel`: selection details, incoming/outgoing counts, evidence list, navigation along a connection.
- `PlanPanel`: draft/locked state, planned modules, planned seams, conformance results, lock/delete actions.
- `ActivityFeed`: MCP calls and agent patches arriving over time; latest entry animates.
- `SteeringComposer`: comment on module/seam, create/delete plan element, lock/unlock.

## Interaction spec by state

### Repository overview

Goal: understand the codebase before the agent starts planning.

- Show top-level module families as cards on the Blueprint canvas.
- Cards show file counts, module kind, and a few child modules.
- Product cards group nested modules but do not hide backend/frontend/shared naming.
- Click selects and opens inspector. Drill action enters a product/package.
- Screenshot: `out/screenshots/overview-light.png`.

### Expand in place

Goal: keep global context while seeing a selected module’s local neighborhood.

- Selecting a module expands its one-hop dependencies and dependents in place.
- Incoming and outgoing edges are drawn, but dense non-selected edges bundle behind a `+N bundled edges` counter.
- Side panel shows counts and evidence. Clicking evidence navigates along that connection by selecting the other module.
- Density slider increases/decreases bundled edges on 50+ node views without changing the selected module.
- Screenshot: `out/screenshots/expanded-light.png`.

### Drill into product/package

Goal: inspect `products/<name>/backend|frontend|shared` as a local architecture.

- Breadcrumbs switch to repo → products → `<name>`.
- Canvas relayouts around child modules under that product.
- Backend, frontend, and shared are separate cards even when they belong to one product.
- The user can return to overview through breadcrumbs or select a child and expand in place.
- Screenshot: `out/screenshots/drill-light.png`.

### Plan focus

Goal: show only what the plan touches plus direct neighbors.

- Planned modules stay full opacity.
- Direct neighbors remain visible but muted.
- Everything else collapses into a summary card with counts by hidden module/edge class.
- This is the review mode for answering “does this change stay inside the intended module boundary?”
- Screenshot: `out/screenshots/focus-light.png`.

### Plan overlay

Goal: read the architecture plan and conformance results on the same canvas.

- Planned modules use semantic conformance badges: conforming, pending, violating.
- Planned seams render as heavier labeled edges with the interface they route through.
- Seam actions use line treatment: keep = solid, add = solid with label, remove = dashed/alert.
- Draft plan elements are editable. Locked elements keep their lock state and cannot be deleted without unlocking.
- Conformance results appear both on the canvas and in the Plan panel.
- Screenshots: `out/screenshots/plan-overlay-light.png`, `out/screenshots/plan-overlay-dark.png`.

### Live collaboration and steering

Goal: make agent work observable and steerable without leaving the explorer.

- Agent patches arrive as animated activity feed rows that name the MCP call and outcome.
- “Follow agent” moves selection to the module/seam the latest patch touched. Turning it off freezes the human’s viewport.
- Every module and seam has a comment target. Comments become agent-readable context attached to the target id.
- Humans can add the selected module to the plan, delete draft elements, and lock/unlock modules or seams.
- Screenshot: `out/screenshots/live-steering-light.png`.

## Implementation notes

- Persist architecture plans in the Git common dir as settled in #15; the UI should treat the server as the plan source of truth.
- Keep plan revisions append-only. Lock/unlock should record a revision, not mutate silently.
- SSE events should be normalized into `agent_activity`, `plan_patch`, `conformance_result`, and `selection_hint` event types.
- Edge evidence needs exact file/import records; the prototype data includes rough examples, but implementation should return file path, line, import specifier, source module, target module.
- For large repositories, compute visible graph server-side or in a web worker, then let React Flow render only the current disclosure state.

## Screenshots

- Repository overview: `out/screenshots/overview-light.png`
- Expand in place: `out/screenshots/expanded-light.png`
- Drill into product: `out/screenshots/drill-light.png`
- Plan focus: `out/screenshots/focus-light.png`
- Plan overlay: `out/screenshots/plan-overlay-light.png`
- Plan overlay dark: `out/screenshots/plan-overlay-dark.png`
- Live steering: `out/screenshots/live-steering-light.png`
