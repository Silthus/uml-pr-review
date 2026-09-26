# Architecture explorer round 2 prototype

Throwaway prototype for issue #21. It answers whether the real PostHog architecture index can be explored as a UML package diagram while keeping connection evidence and plan conformance visible.

## Source data

- Repository index: `prototype/explorer-design-2/data/posthog-architecture.json`
- Source commit in index: `f637db96`
- Modules: 6,574
- Files: 41,535
- File import edges: 166,755
- Tests are hidden by default and can be toggled into aggregation.

## Design decision

Use a UML package diagram as the primary spatial metaphor, not a generic node-link graph. Packages are drawn as tabbed folders with stereotypes, file counts, child counts, and disclosure affordances. Visible imports are rendered as dashed dependency arrows. When a package is collapsed, file-level imports are lifted to the deepest visible ancestor so the diagram stays small without losing evidence in the inspector.

The design is connection-first: selection keeps the chosen package stable, distinguishes incoming and outgoing dependencies, dims irrelevant packages, and lists sorted file-level evidence next to the diagram.

## UML notation rules

- Every visible module is a UML package-shaped card with a tab.
- Stereotypes encode module type:
  - `«package»` for regular packages
  - `«product»` for product packages
  - `«layer»` for backend/frontend layer packages
  - `«django-app»` for Django app roots
  - `«directory»` for directory containers
  - `«migrations»` for migration packages
- Dependency edges are dashed arrows.
- Incoming dependencies are blue.
- Outgoing dependencies are green.
- Planned conforming seams use the green dependency treatment with explicit labels.
- Violating seams use red dotted dependency treatment and a violation badge.
- Plan roles are shown as package badges: modify, interface, neighbor, pending, conforming, violating, and comment counts.

## Views

### Overview

The overview intentionally shows exactly 16 top-level packages. This includes `products` plus the largest peer roots. The measured screenshot state is:

- 16 packages
- 24 aggregated edges
- Aggregation time around 15-16 ms
- Manual layout time rounded to 0.0 ms

This proved the top-level map can remain legible at 1440x900 in both light and dark states.

### Nested products

The nested products view expands `products` and focuses on the selected real product area. It shows product packages, layer packages, and submodules inside true nested package frames. The measured screenshot state is:

- 33 packages
- 70 aggregated edges
- Aggregation time around 16 ms

The full product set is too large for one viewport, so the prototype uses disclosure counts and a focused subset rather than drawing all 90 product children at once. This is the right default for readability: the canvas answers where the selected product lives, while the disclosure affordance communicates hidden breadth.

### Connection lens

The connection lens selects `products/error_tracking/backend`, highlights incoming and outgoing dependencies separately, and pulls in the far ends from collapsed packages. It caps visible far-end packages to the highest-weight incoming and outgoing sets while preserving full sorted evidence in the inspector.

The measured screenshot state after iteration is:

- 19 packages
- 15 aggregated edges
- Aggregation time around 21 ms

This is the most important interaction. It makes the selected module large enough to read, keeps blue incoming and green outgoing directionality clear, and avoids drowning the user in every collapsed far end.

### Plan overlay

The plan overlay models the scenario: show feature flag usage on error tracking issues.

Modified modules:

- `products/error_tracking/backend/facade`
- `products/error_tracking/frontend`
- `products/error_tracking/backend/logic`

Conforming seam:

- `products/error_tracking/backend/logic` to `products/feature_flags/backend/facade`
- Interface path: `products/feature_flags/backend/api/feature_flag_usage.py`

Violating seam:

- `products/error_tracking/backend/facade` to `products/feature_flags/backend/models`
- Rationale: bypasses the feature flag facade and should route through the facade/API seam.

The measured screenshot state is:

- 21 packages
- 72 edges
- Aggregation time around 17 ms

The overlay is readable enough for a prototype, but visually dense. The red violating seam is still discoverable because it has a separate line style, module badge, and inspector explanation.

### Live collaboration

The live collaboration state adds:

- scripted agent plan edits
- activity feed
- follow-agent control
- human comment on the violating model seam
- human-created plan element requiring facade/API evidence

The captured light screenshot demonstrates the behavior, but it is intentionally marked as a prototype limitation: the feed is too visually dominant when placed on top of the diagram. A production version should dock collaboration activity or make it collapsible rather than floating over package evidence.

## Component inventory

- Header with index metadata, test toggle, follow-agent toggle, and theme toggle.
- Mode switcher for overview, nested products, connection lens, plan overlay, and live collaboration.
- React Flow canvas with custom UML package nodes.
- Custom dependency edge renderer for aggregated imports and plan seams.
- Minimap and fit/zoom controls.
- Inspector with selected package metadata.
- Dependency lists with sorted file-level evidence.
- Plan summary with actions that select relevant packages.
- Live activity feed for agent and human collaboration events.

## Layout and aggregation

The graph model is built from the real index once. On every interaction, the visible package set is selected from the current mode, expansion state, selected path, and test filter. File-level edges are then aggregated to visible ancestors.

Aggregation rule:

1. Resolve the file's module.
2. Walk upward until a visible ancestor is found.
3. Drop self-edges after lifting.
4. Group by visible source and target.
5. Count weights and retain sorted evidence examples.

Manual layouts are used for the key prototype states because generic auto-layout compressed the package cards too aggressively. ELK remains available as a fallback, but the screenshots use manual mode-specific layouts for legibility.

Observed aggregation timings on the real index:

- Overview: about 15-16 ms
- Nested products: about 16 ms
- Connection lens: about 21 ms
- Plan/live overlay: about 17-25 ms

These timings are fast enough for prototype interaction at the tested data size.

## Visual system

The look follows the existing Blueprint-inspired artifact direction:

- dotted paper background
- thin strokes
- muted cards
- monospace metadata
- restrained categorical accents
- light and dark themes as separately tuned states

Validated categorical accents from the dataviz pass:

- Light: `#5d75d6`, `#209c8a`, `#b8831d`, `#8a67c7`
- Dark: `#6f80dc`, `#169982`, `#ac8628`, `#8a69c6`

The dark overview capture preserves contrast and the paper/ink hierarchy.

## Accessibility and interaction

- Packages are buttons and can be selected from the keyboard.
- Disclosure controls are explicit buttons.
- Inspector actions can move selection to relevant plan packages.
- Minimap and fit controls are present.
- Light and dark themes are available.
- Text avoids mid-word truncation where the node is large enough; deeply nested long paths are shortened with path-aware ellipses.

## Screenshots

- `prototype/explorer-design-2/out/screenshots/overview-light.png`
- `prototype/explorer-design-2/out/screenshots/overview-dark.png`
- `prototype/explorer-design-2/out/screenshots/nested-products-light.png`
- `prototype/explorer-design-2/out/screenshots/connection-light.png`
- `prototype/explorer-design-2/out/screenshots/plan-light.png`
- `prototype/explorer-design-2/out/screenshots/live-light.png`

## Limits found

- Drawing all 90 product children in one viewport is not useful. A focused expansion plus disclosure count is more legible.
- Generic graph layout made nodes tiny and compressed. The prototype needs package-aware layout constraints.
- The plan overlay is dense when real dependency edges and proposed seams are shown together. Production should offer a seam-only toggle or staged overlays.
- The live collaboration feed should not float over the graph by default. Docking or collapsible panels would preserve context better.
- The inspector can become very long because evidence is intentionally preserved. Production should virtualize evidence lists and add filters by edge kind.

## Verdict

The UML package diagram direction works on the real PostHog index when the product tree is disclosed progressively and edge aggregation is recalculated against the current visible module set. The key interaction should be the connection lens: select a package, distinguish incoming and outgoing dependencies, lift collapsed far ends into view, and keep sorted file-level evidence in the inspector.
