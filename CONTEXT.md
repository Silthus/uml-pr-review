# PR Review Diagram

A local tool that draws a codebase's architecture for the people and agents changing it. It reviews one pull request by drawing the part of the architecture that the pull request touches. It also indexes a whole repository into modules and their dependencies, so an agent can draft an architecture plan that a human steers, locks, and checks the implementation against.

## Language

### Pull request review

**Symbol**:
A function, method, or class declaration in the analyzed repository.
_Avoid_: Node, entity, definition

**Touched**:
A symbol, file, or module that the change under review alters. For a pull request that is its diff; for a conformance check it is the snapshot against the plan's base commit.
_Avoid_: Changed, modified, affected, in-diff

**Neighbor**:
A symbol one hop away from a touched symbol. A neighbor is a caller or a callee.
_Avoid_: Related, connected, dependent

**Caller**:
A neighbor that calls a touched symbol.
_Avoid_: Usage, consumer, incoming

**Callee**:
A neighbor that a touched symbol calls.
_Avoid_: Dependency, outgoing, target

**Package**:
A folder with its own manifest (`package.json`, `pyproject.toml`, `setup.py`, `Cargo.toml`, or `go.mod`). Every file belongs to the nearest package above it, and a repository without manifests has one package at the root.
_Avoid_: Module, workspace, project

**Graph**:
The extracted model of packages, files, symbols, and the edges between them for one pull request. It holds no geometry.
_Avoid_: Model, diagram data, index

**Layout**:
The geometry for one graph, keyed by the graph's ids. It exists only inside an artifact.
_Avoid_: Positions, coordinates

**Artifact**:
The generated HTML file that renders one graph.
_Avoid_: Report, output, diagram file

### Architecture

**Module**:
A source-bearing folder in a repository's module tree. Modules nest, and every source file belongs to exactly one module: the deepest one that holds it. A package is one kind of module.
_Avoid_: Component, directory, node, unit

**Architecture index**:
The module tree of one Git tree together with every resolved import between its files.
_Avoid_: Graph, repository graph, call graph, model

**Dependency**:
One module's use of another, made of the resolved imports from files in the first to files in the second. It is counted at whatever module level is in view.
_Avoid_: Callee, edge, link, coupling

**Seam**:
A dependency that an architecture plan names, from one module to another, with an action: add, remove, or keep.
_Avoid_: Boundary, connection, crossing, planned edge

**Interface**:
The files, and optionally the symbols, of a seam's target module that the seam must route through.
_Avoid_: API, facade, contract, entry point

**Architecture plan**:
The modules a change will create, modify, or remove, and the seams between them, drafted against one base commit before the change is implemented.
_Avoid_: Design, proposal, spec, blueprint

**Revision**:
One recorded change to an architecture plan, made by the agent or by the human.
_Avoid_: Version, history entry, edit

**Lock**:
The human's approval that freezes an architecture plan's modules and seams for implementation. Only the human locks or unlocks, and each lock and unlock is a revision.
_Avoid_: Approve, freeze, finalize, commit

**Snapshot**:
The Git tree of a working tree as it is right now, including uncommitted and untracked files, captured without touching the real index.
_Avoid_: Stash, checkpoint, working copy

**Conformance**:
Whether the change from an architecture plan's base commit to a snapshot stays within that plan.
_Avoid_: Compliance, validation, drift

**Finding**:
One place where a change departs from its architecture plan, or has not reached it yet, named by file and line together with the change that would conform.
_Avoid_: Violation, error, issue, lint
