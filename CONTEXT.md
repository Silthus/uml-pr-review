# PR Review Diagram

A local tool that reads one pull request and draws the part of the codebase architecture the pull request touches. It exists because code written by agents arrives faster than a reviewer can read it, and a diagram shows the structure faster than the diff.

## Language

**Symbol**:
A function, method, or class declaration in the analyzed repository.
_Avoid_: Node, entity, definition

**Touched**:
A symbol or file that the pull request changes.
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

**Graph**:
The extracted model of packages, files, symbols, and the edges between them for one pull request. It holds no geometry.
_Avoid_: Model, diagram data, index

**Package**:
A folder with its own `package.json` that the workspace lists. Every file belongs to one package. A single-package repository has one package at the root.
_Avoid_: Module, workspace, project

**Layout**:
The geometry for one graph, keyed by the graph's ids. It exists only inside an artifact.
_Avoid_: Positions, coordinates

**Artifact**:
The generated HTML file that renders one graph.
_Avoid_: Report, output, diagram file
