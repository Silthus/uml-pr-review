# Graph JSON is a layout-free seam with typed edge lists

The Graph is the document the analyzer writes and the renderer reads. It is also the stable input for later agent prompts. We decided in issue #7 (2026-09-17) that the Graph carries no geometry: the artifact embeds `{ graph, layout }`, and `layout` is a second versioned document keyed by the same ids. `--json` writes the Graph only. Call edges and import edges are two typed lists (`calls[]` between symbol ids, `imports[]` between file paths), not one list with a `kind` field. Every value a reader can derive (touched, line count, changed lines) is not a field. One zod schema is the single source of the types and validates every document on read.

## Considered options

- Geometry inside the Graph. Rejected: the analyzer output would depend on elkjs, and an agent that reads `--json` would get coordinates it does not need.
- One `edges[]` list with `kind`. Rejected: `from` and `to` would be untyped strings that sometimes name a file and sometimes a symbol.
- `touched`, `changedLines`, `lineCount` as fields. Rejected: two sources of truth for one fact.
- Packages dropped from the Graph. Rejected: the accepted renderer draws package plates and marks calls that cross a package boundary, and the renderer never reads the worktree.

## Consequences

- A symbol's change state is `added | modified | unchanged` in v1. `deleted` and `renamed` arrive with base-commit analysis and bump the schema version.
- Diff rows live once per file. The renderer slices a symbol's rows by its line range.
- The full field listing is in the resolution comment of issue #7.
