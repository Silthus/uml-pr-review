# Deterministic layout and self-contained HTML rendering

## Summary

1. Use elkjs with the `layered` algorithm in Bun to compute the layout, and render with inline SVG and a small hand-written script.
2. All three engines nest symbol members in file containers, but only elkjs documents both compound containers and cross-container edges.
3. elkjs geometry is deterministic. Eight runs in one process and two different JavaScript engines gave the same hash. Graphviz gives no such guarantee for `dot`.
4. A hand-written SVG renderer keeps the artifact near 21 KB. Cytoscape.js adds 435 KB and refuses to accept the container boxes that the layout engine computed.
5. To keep the artifact byte-identical, the generator must sort all input, keep `randomSeed` non-zero, and round all coordinates.

**Recommendation**: elkjs (`layered`) for layout, plain inline SVG with a hand-written script for rendering.

---

## 1. elkjs

### 1.1 It runs in Bun and Node, but Bun needs one workaround

elkjs is the Eclipse Layout Kernel transpiled from Java to JavaScript with GWT [1]. The package ships `lib/elk.bundled.js` for a self-contained build and `lib/main.js` as the Node entry point [2].

The package runs at generation time. It needs no browser and no network.

Bun needs one workaround. The worker file exports its fake `Worker` class only when the code is not inside a web worker. The test is `typeof document === 'undefined' && typeof self !== 'undefined'` [3]. Bun defines a global `self`, and Node does not. This was measured:

```
bun:  typeof self = object     typeof document = undefined
node: typeof self = undefined  typeof document = undefined
```

So Bun takes the worker branch, never sets `module.exports`, and `new ELK()` fails with `TypeError: undefined is not a constructor`. Remove the global before the import:

```js
delete globalThis.self;
const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
```

The documented `workerFactory` option is the other supported route [2]. Both avoid the problem.

### 1.2 Compound nodes and hierarchical edges work

The `layered` algorithm lists `Compound (cross-hierarchy edges)` and `Clusters` in its supported graph features [4]. The ELK JSON format allows a node to hold a `children` array, and states that "Any edge may be defined under any node, regardless of its end points. This allows for flexibility when defining hierarchy-crossing edges" [5].

A test graph of three file containers, six symbol members, one nested class, and five call edges (including one cross-file back edge) laid out correctly. Nesting to depth three worked.

**You must set `hierarchyHandling`.** The default is `INHERIT`, and "If the root node is set to `INHERIT` (or not set at all), the default behavior is `SEPARATE_CHILDREN`" [6]. With the default, cross-file edges get **no routing at all**. Measured on the same graph:

| `hierarchyHandling` | root size | cross-file edges with a `sections` array |
| --- | --- | --- |
| default | 148x228 | 0 of 3 |
| `INCLUDE_CHILDREN` | 332x126 | 3 of 3 |

`INCLUDE_CHILDREN` "will lay out that node and all of its descendants in a single layout run" and "may allow cross-hierarchical edges to be laid out properly" [6].

### 1.3 Coordinates use two different origins

This is the largest single trap for the renderer. Node coordinates are relative to the parent node, but edge coordinates are relative to the edge's **container**, which is the lowest common ancestor of its end points [7].

A cross-file edge therefore has its container set to `root`, and its points are in root coordinates, while the member nodes it joins are in file coordinates. Measured output for a cross-file edge:

```json
{"id":"e1","container":"root",
 "sections":[{"startPoint":{"x":353,"y":129},"endPoint":{"x":39,"y":79}, ...}]}
```

The generator must walk the tree, accumulate parent offsets for nodes, and add the container offset for edges, to flatten everything to one absolute space before it writes the JSON.

### 1.4 Geometry is deterministic, raw output is not

The geometry is deterministic. Measurements on a graph of 15 files, 75 symbols, and about 120 edges:

| Test | Result |
| --- | --- |
| 8 runs, one process, one `ELK` instance | 1 unique geometry hash |
| A new `ELK` instance in the same process | same hash |
| Bun (JavaScriptCore) against Node (V8) | same hash, `00d00f4b...` |
| Input order reversed | **different** hash |

The cross-engine match is the strongest result. The layout contained 893 floating point numbers with up to 15 decimal places, such as `2578.1888888888893`, and two independent JavaScript engines produced every one of them identically.

Three conditions apply:

- **Raw output is not stable.** GWT writes an identity hash field `$H` on the output objects, and its value changes between runs. A hash of the full result gave 5 different values in 5 runs. Read only the fields you need: `id`, `x`, `y`, `width`, `height`, and the edge `sections`.
- **elkjs mutates the input object in place.** It adds `x`, `y`, and `$H` to the graph you pass in. Pass a fresh object for each call.
- **Input order changes the layout.** Reversing the order of `children` and `edges` produced a different, but equally stable, layout. The generator must emit files, symbols, and edges in a fixed sorted order.

Keep `randomSeed` away from zero. The default for `layered` is `1` [4], and the option description states that "If the value is 0, the seed shall be determined pseudo-randomly (e.g. from the system time)" [8]. A zero seed would destroy determinism.

### 1.5 Options that fit a call graph

| Option | Value | Why |
| --- | --- | --- |
| `elk.algorithm` | `layered` | Sugiyama layering. Callers flow into callees [4]. |
| `elk.direction` | `RIGHT` | Call direction reads left to right. Default is `UNDEFINED` [4]. |
| `elk.hierarchyHandling` | `INCLUDE_CHILDREN` | Required for cross-file edges [6]. |
| `elk.spacing.nodeNode` | `20` (default) | Gap between symbol members [4]. |
| `elk.layered.spacing.nodeNodeBetweenLayers` | `40` | Gap between call layers. Default `20` [4]. |
| `elk.padding` | `[top=30,...]` | Room for the file name in the container header. Default is `12` on all sides [4]. |
| `elk.randomSeed` | leave at `1` | Never `0` [8]. |

Defaults that already suit a call graph: cycle breaking is `GREEDY`, crossing minimisation is `LAYER_SWEEP`, node placement is `BRANDES_KOEPF`, and edge routing is `ORTHOGONAL` [4]. Orthogonal routing gives the boxy look that suits an architecture diagram.

Layout of 75 symbols took 119 ms in Bun and 218 ms in Node.

**License**: `EPL-2.0 OR GPL-3.0-or-later` [9]. The package is 8.0 MB unpacked, but it is a build-time dependency only. No elkjs code goes into the artifact, so the copyleft terms do not reach the generated HTML.

---

## 2. Alternatives

### 2.1 dagre

Two packages exist. The README states that "There are 2 versions on NPM, but only the one in the DagreJs org is receiving updates right now" [10]. The npm registry confirms the split:

| Package | Latest | Published |
| --- | --- | --- |
| `dagre` | 0.8.5 | 2019-12-03 |
| `@dagrejs/dagre` | 3.1.1 | 2026-08-08 |

Use `@dagrejs/dagre` if you use dagre at all.

Compound nodes work. A `graphlib.Graph({compound: true})` with `setParent` laid out file containers with member nodes, and produced container boxes. Nesting to depth two worked. Five runs gave one unique hash, so it is deterministic.

Two facts matter for the renderer. Coordinates are **absolute and centre-based**, not parent-relative, which is simpler than ELK. But container sizing is loose: in the 0.8.5 test a file container holding two 120-wide members came back 500 wide.

The bigger gap is the documentation. The dagre wiki documents `rankdir`, `nodesep`, `ranksep`, and `ranker`, but contains no discussion of compound graphs, clusters, or `setParent` at all [11]. Compound support works, but it is undocumented.

**License**: MIT [10].

### 2.2 Graphviz via WebAssembly

Clusters work. A subgraph whose name starts with `cluster` becomes a container, and "`dot` renders a box around subgraph clusters" [34]. Edges between nodes in different clusters are always allowed. The `compound` attribute, which is `dot` only and defaults to `false`, adds `lhead` and `ltail` so an edge can be clipped at a cluster boundary [35]. Useful attributes are `rankdir` (`TB`, `LR`, `BT`, `RL`, default `TB`) [36], `nodesep` (inches, default `0.25`) [37], and `ranksep` (default `0.5` for dot) [38].

To get coordinates instead of an image, use `-Tjson`. It returns an `objects` array with clusters first, each carrying `bb` and `lp`, then nodes with `pos` [39]. All of these are in points [40]. Do not use `-Tplain`: it uses inches and a bottom-left origin [41], and it emits no cluster lines at all, so the file container boxes are lost.

The package to use is `@hpcc-js/wasm-graphviz` 1.29.1, which bundles Graphviz 16.1.0 [42]. The API is `graphviz.layout(src, "json", "dot")` [43]. It runs in Bun. The WebAssembly binary is encoded inside `dist/index.js` and passed to `WebAssembly.instantiate` as a buffer, so it needs no network and no filesystem at run time. The effective runtime payload is about 819 KB, against 2.0 MB unpacked, most of the rest being a source map. `@viz-js/viz` is 4.75 MB unpacked and carries an older Graphviz 16.0.0.

**Determinism is the problem.** No Graphviz page states a determinism guarantee for `dot`. The FAQ has no determinism entry [44]. The only official statement of a repeatable seed covers the force-directed engines, not `dot`: for `start`, which is "neato, fdp, sfdp only", "the same seed is always used for the random number generator, so the initial placement is repeatable" [45].

The issue tracker shows a recurring history: "Dot is not producing deterministic output for SVG files", closed in 2020, which blamed hash-map iteration order leaking into output ids [46]; "dot generates random layouts every time", closed in 2023 [47]; and "random placement of subgraphs while generating several time the same dot file", which is still **open** [48]. Statement order also matters, and "[Dot] rank and cluster works only if nodes are referenced in specific order" is open [49]. Reordering semantically identical `subgraph` and edge statements moved node coordinates in a direct test.

Repeated runs of one input against one binary were stable in testing, 20 runs giving 1 distinct output. But that is an observation, not a guarantee, and this project needs the guarantee.

**Licenses**: Graphviz itself is EPL-2.0 [50]. The `@hpcc-js/wasm-graphviz` wrapper declares Apache-2.0 [51], and `@viz-js/viz` declares MIT [52]. Both packages ship a compiled Graphviz, so the EPL-2.0 terms travel with the bundled binary, and neither repository explains how the two combine.

---

## 3. Renderers

All three options receive positions that are already computed, so none of them needs a layout engine in the browser.

### 3.1 Plain SVG with a hand-written script

Size was measured by building a working artifact end to end: ELK layout, flatten to absolute coordinates, emit HTML.

| Part | Bytes |
| --- | --- |
| Hand-written script, unminified | 2,337 |
| Graph JSON for 8 files, 32 symbols, 40 edges | 8,407 |
| **Whole artifact** | **21,063** (5,061 gzipped) |

Pan and zoom use one `<g>` wrapper. The `transform` attribute "defines a list of transform definitions that are applied to an element and the element's children" [12], so a single `translate(x,y) scale(k)` moves the whole scene. Drag-to-pan uses `pointerdown`, `pointermove`, and `pointerup` [13], with `setPointerCapture` so the drag survives leaving the element, and CSS `touch-action: none` to suppress the browser's own gestures [13]. Zoom uses the `wheel` event [14].

One gotcha: `addEventListener` defaults to `passive: true` for `wheel`, so "to call `preventDefault()` on wheel events, you must use `{passive: false}` when adding the listener" [14].

Click-to-highlight, hover, and hide-neighbors are hand-written. Build an adjacency map from the edge list once, then toggle CSS classes on elements carrying a `data-id` attribute. This took about 25 lines in the test artifact. Because the output is real DOM, a CSS class does all the visual work, and `display: none` removes a node from the picture.

**License**: none. There is no third-party code.

### 3.2 Cytoscape.js

The `preset` layout takes precomputed positions, either from a per-node `position` field or from a `positions` map of node id to position [15]. It also accepts `fit`, `padding`, `zoom`, and `pan` [16]. A headless test confirmed that `preset` preserves exact input positions.

Compound nodes use a `parent` field in a node's `data` [17]. Edges between children of different parents work, confirmed both in a headless test and in the official compound demo data [18].

Interactions are built in. Pan and zoom are on by default, with `userPanningEnabled`, `userZoomingEnabled`, `minZoom`, and `maxZoom` as options [19]. Clicks use the normalised `tap` event through `cy.on('tap', 'node', handler)` [20]. Hover uses `mouseover` and `mouseout` [20]. A hide-neighbors toggle uses `node.neighborhood()`, which "includes the edges connecting the collection to the neighbourhood" [21], with the `display: none` style to remove elements [22].

Two costs are significant.

**Compound parents cannot take your container boxes.** The docs state that "A compound parent node does not have independent dimensions (position and size), as those values are automatically inferred by the positions and dimensions of the descendant nodes" [17]. Only `min-width`, `min-height`, and `padding` influence the size [23]. So Cytoscape would recompute the file container rectangles that ELK already computed, and the two would disagree.

**It renders to canvas, not SVG** [24]. The picture is not inspectable in DevTools, text cannot be selected, and nothing can be styled with plain CSS.

A further note: `eles.neighborhood()` makes "no special allowances for compound nodes" [17], so a file container needs `a.add(a.descendants()).neighborhood()`.

**Size**: `dist/cytoscape.min.js` is 435,503 bytes, 136,466 gzipped. **License**: MIT, with no runtime dependencies [25].

### 3.3 D3

D3 has no compound-node or node-link renderer. It gives you `d3-selection` to write the DOM and `d3-zoom` for pan and zoom [26]. `d3-force` is not needed, because the positions already exist [27]. The zoom behaviour applies a transform to a `<g>` exactly as the hand-written version does: `g.attr("transform", transform)` [28].

The catch is that d3-zoom is not standalone. Its dependencies are `d3-dispatch`, `d3-drag`, `d3-interpolate`, `d3-selection`, and `d3-transition` [29]. A minimal bundle of only `select`, `selectAll`, `zoom`, and `zoomIdentity` was built with `bun build --minify` and came to **48,660 bytes** (16,257 gzipped) across 111 modules. The full `d3.min.js` is 279,706 bytes.

For that 48 KB, D3 replaces about 12 lines of pan and zoom code. Every node, edge, container, highlight, and toggle is still hand-written. **License**: ISC [30].

---

## 4. How to guarantee a byte-identical artifact

The test generator produced a byte-identical file on two separate runs, verified with a SHA-256 of the whole HTML. Five rules make that hold.

1. **No timestamps and no environment.** Write no build date, no version banner from `git describe`, no absolute paths, and no hostname. Any input that is not the pull request must be pinned.
2. **Deterministic layout.** Sort files, symbols, and edges by a stable key before you call elkjs, because input order changes the layout (see 1.4). Keep `randomSeed` non-zero [8].
3. **Stable ids.** Derive every id from repository content, such as `path#symbolName`, and never from an array index or a counter that depends on filesystem walk order. Sort collections by id before you serialise.
4. **Stable JSON key order.** `JSON.stringify` follows object insertion order for string keys. Build each object with a literal in a fixed key order, or pass an explicit key array as the `replacer`. Never serialise the raw elkjs result, because the `$H` field changes between runs (see 1.4).
5. **Round the coordinates.** ELK returns doubles with up to 15 decimal places. Rounding to two decimals removed all noise, kept the picture correct, and shrank the JSON. It also removes the only place where a future engine or platform difference could show up.

For the embedded data, use a `<script type="application/json">` block. For any `type` that is not a JavaScript MIME type, "The embedded content is treated as a data block, and won't be processed by the browser" [31]. Read it with `JSON.parse(document.getElementById("graph").textContent)` [32].

Escape the payload. The HTML Standard warns that "for legacy reasons, `<!--` and `<script` strings in script elements in HTML need to be balanced in order for the parser to consider closing the block", and advises escaping `<!--`, `<script`, and `</script` [33]. The spec's suggested `\x3C` form is a JavaScript string escape and is **not valid JSON**. For a JSON data island, replace every `<` with `<`, which is valid JSON and parses back to `<`. This was verified: the generated island contained no raw `<` at all and still parsed correctly.

---

## 5. Comparison tables

### Layout engines

| | elkjs | @dagrejs/dagre | Graphviz via `@hpcc-js/wasm-graphviz` |
| --- | --- | --- | --- |
| Runs in Bun | yes, after deleting global `self` | yes | yes, wasm inlined, no network [43] |
| Compound containers | yes, documented [4] | yes, undocumented [11] | yes, `cluster_*` subgraphs [34] |
| Cross-container edges | yes, `INCLUDE_CHILDREN` [6] | yes | yes, `compound=true` to clip [35] |
| Deterministic (measured) | yes, also across V8 and JSC | yes, 5 runs | stable in 20 runs, but **not guaranteed** [44][48] |
| Determinism documented | seed default `1` [4][8] | not stated | no statement for `dot`; only for neato/fdp/sfdp [45] |
| Coordinate space | mixed: nodes parent-relative, edges container-relative [7] | absolute, centre-based | points, via `-Tjson` [39][40] |
| Edge routing | orthogonal by default [4] | polyline points | splines |
| Docs quality | full option reference [4] | no compound docs [11] | full attribute reference [34] |
| Runtime payload | 1.6 MB, build time only | 284 KB, build time only | ~819 KB wasm, build time only |
| License | EPL-2.0 OR GPL-3.0 [9] | MIT [10] | EPL-2.0 plus Apache-2.0 wrapper [50][51] |

### Renderers

| | Plain SVG | Cytoscape.js | D3 |
| --- | --- | --- | --- |
| Inlined size | ~2.3 KB of own script | 435,503 B (136,466 gz) | 48,660 B minimal (16,257 gz) |
| License | none | MIT [25] | ISC [30] |
| Draws to | SVG DOM | canvas [24] | SVG DOM |
| Honours ELK container boxes | yes | **no**, parents auto-size [17] | yes |
| Pan and zoom | hand-written, ~12 lines [12][13][14] | built in [19] | `d3.zoom()` [28] |
| Click-to-highlight | CSS class on `data-id` | `cy.on('tap', ...)` [20] | hand-written |
| Hover | `mouseover` / `mouseout` | `mouseover` / `mouseout` [20] | hand-written |
| Hide-neighbors | adjacency map plus `display:none` | `neighborhood()` plus `display:none` [21][22] | hand-written |
| JSON embedding | `<script type="application/json">` [31] | same | same |
| Whole artifact (measured) | 21,063 B | ~450 KB | ~70 KB |

---

## 6. Recommendation

Use **elkjs with `layered`** for layout and **plain inline SVG with a hand-written script** for rendering.

elkjs documents both compound containers and cross-hierarchy edges, and its determinism held across two JavaScript engines with 893 floats in the output. Graphviz draws better splines and is smaller, but it publishes no determinism guarantee for `dot` and still has an open issue about random subgraph placement, which is a direct risk to the byte-identical requirement. Plain SVG wins on the renderer side because Cytoscape.js costs 435 KB and, worse, sizes compound parents itself and therefore discards the file container rectangles that ELK just computed. The price of plain SVG is about 60 lines of pan, zoom, highlight, and toggle code, which is cheaper than fighting a renderer that disagrees with the layout engine.

---

## References

1. elkjs README, generation from the ELK Java codebase with GWT. https://github.com/kieler/elkjs/blob/master/README.md
2. elkjs README, Node usage, constructor options, `workerUrl` and `workerFactory`, build files. https://github.com/kieler/elkjs/blob/master/README.md
3. elkjs worker export guard, `lib/elk-worker.min.js` line 6236 of the published 0.12.0 package. https://github.com/kieler/elkjs
4. ELK Layered algorithm reference: id, supported features including `Compound (cross-hierarchy edges)` and `Clusters`, and option defaults. https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
5. ELK JSON graph format, node `children`, edge `sources`/`targets`/`sections`, hierarchy-crossing edges. https://eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/jsonformat.html
6. ELK Hierarchy Handling option. https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html
7. ELK coordinate system, parent-relative shapes and container-relative edges. https://eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/coordinatesystem.html
8. ELK Randomization Seed option. https://eclipse.dev/elk/reference/options/org-eclipse-elk-randomSeed.html
9. elkjs package license field, `EPL-2.0 OR GPL-3.0-or-later`. https://registry.npmjs.org/elkjs
10. dagre README, two-package notice and MIT license. https://github.com/dagrejs/dagre/blob/master/README.md
11. dagre wiki, graph label options, and absence of compound documentation. https://github.com/dagrejs/dagre/wiki
12. MDN, SVG `transform` attribute. https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/transform
13. MDN, Pointer events, `setPointerCapture`, and `touch-action`. https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
14. MDN, `wheel` event and the `{passive: false}` requirement. https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event
15. Cytoscape.js elements JSON, per-node `position`. https://js.cytoscape.org/#notation/elements-json
16. Cytoscape.js `preset` layout options source. https://github.com/cytoscape/cytoscape.js/blob/master/src/extensions/layout/preset.mjs
17. Cytoscape.js compound nodes, `parent` field and automatic parent dimensions. https://js.cytoscape.org/#notation/compound-nodes
18. Cytoscape.js compound layout demo data with cross-parent edges. https://github.com/cytoscape/cytoscape.js/blob/master/documentation/demos/cose-bilkent-layout-compound/data.json
19. Cytoscape.js initialisation options, `userPanningEnabled`, `userZoomingEnabled`, `minZoom`, `maxZoom`. https://js.cytoscape.org/#core/initialisation
20. Cytoscape.js user input device events, `tap`, `mouseover`, `mouseout`. https://js.cytoscape.org/#events/user-input-device-events
21. Cytoscape.js `eles.neighborhood()`. https://js.cytoscape.org/#eles.neighborhood
22. Cytoscape.js visibility styles, `display: none`. https://js.cytoscape.org/#style/visibility
23. Cytoscape.js compound parent sizing, `min-width`, `min-height`, `padding`. https://js.cytoscape.org/#style/compound-parent-sizing
24. Cytoscape.js renderer sources, canvas only. https://github.com/cytoscape/cytoscape.js/tree/master/src/extensions/renderer
25. Cytoscape.js LICENSE and package.json, MIT with no runtime dependencies. https://github.com/cytoscape/cytoscape.js/blob/master/LICENSE
26. d3-selection documentation. https://d3js.org/d3-selection
27. d3-force documentation. https://d3js.org/d3-force
28. d3-zoom documentation, `zoom.scaleExtent`, `event.transform`, applying a transform to a `<g>`. https://d3js.org/d3-zoom
29. d3-zoom package dependencies. https://github.com/d3/d3-zoom/blob/main/package.json
30. d3 license, ISC. https://github.com/d3/d3/blob/main/LICENSE
31. MDN, `<script>` element, non-JavaScript `type` treated as a data block. https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script
32. MDN, `Node.textContent`. https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent
33. HTML Standard, restrictions for contents of script elements. https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
34. Graphviz `cluster` attribute, box drawn around subgraph clusters. https://graphviz.org/docs/attrs/cluster/
35. Graphviz `compound` attribute, edges between clusters, `dot` only. https://graphviz.org/docs/attrs/compound/
36. Graphviz `rankdir` attribute. https://graphviz.org/docs/attrs/rankdir/
37. Graphviz `nodesep` attribute. https://graphviz.org/docs/attrs/nodesep/
38. Graphviz `ranksep` attribute. https://graphviz.org/docs/attrs/ranksep/
39. Graphviz JSON output format, `objects`, `edges`, `bb`, `pos`. https://graphviz.org/docs/outputs/json/
40. Graphviz `pos` attribute, output coordinates in points. https://graphviz.org/docs/attrs/pos/
41. Graphviz plain output format, inches and lower left origin. https://graphviz.org/docs/outputs/plain/
42. `@hpcc-js/wasm-graphviz` registry metadata, version 1.29.1. https://registry.npmjs.org/@hpcc-js/wasm-graphviz
43. `@hpcc-js/wasm-graphviz` README, `Graphviz.load()` and `layout(src, format, engine)`. https://github.com/hpcc-systems/hpcc-js-wasm/blob/trunk/packages/graphviz/README.md
44. Graphviz FAQ, with no determinism entry. https://graphviz.org/faq/
45. Graphviz `start` attribute, repeatable seed for neato, fdp, and sfdp only. https://graphviz.org/docs/attrs/start/
46. Graphviz issue 1614, dot not producing deterministic output for SVG files. https://gitlab.com/graphviz/graphviz/-/work_items/1614
47. Graphviz issue 2242, dot generates random layouts every time. https://gitlab.com/graphviz/graphviz/-/work_items/2242
48. Graphviz issue 1435, random placement of subgraphs, still open. https://gitlab.com/graphviz/graphviz/-/work_items/1435
49. Graphviz issue 1075, rank and cluster depend on node reference order. https://gitlab.com/graphviz/graphviz/-/work_items/1075
50. Graphviz license, EPL-2.0. https://graphviz.org/license/
51. `@hpcc-js/wasm` license, Apache-2.0. https://github.com/hpcc-systems/hpcc-js-wasm/blob/main/LICENSE
52. `@viz-js/viz` license, MIT. https://github.com/mdaines/viz-js/blob/v3/LICENSE

### Measurements

All measurements in this document were made on macOS arm64 with Bun 1.3.11 and Node 24.4.1, against elkjs 0.12.0, dagre 0.8.5, @dagrejs/dagre 3.1.1, cytoscape 3.34.3, d3 7.9.0, and d3-zoom 3.0.0. Sizes come from the `dist` folders of the installed packages and from `bun build --minify`.
