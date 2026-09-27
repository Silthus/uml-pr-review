# Classifier rubric: is this review comment an architecture correction?

You get human review comments from pull requests to PostHog's `products/workflows`. Each has an id, the PR, the file it was left on (or "review body"), and its text. Label each one.

A comment is an **architecture correction** when the reviewer asks the author to change the structure of the code, not just its behaviour or style. It qualifies when it asks to:

- **move** code to another file, module, layer, or product (for example "this belongs in the service layer", "move this to the facade");
- **route through** a facade, public API, entry point, or shared helper instead of reaching into internals (for example "don't import the model directly, use `products.x.backend.facade`");
- **change a boundary or dependency**: remove or invert a dependency, stop importing another product's internals, avoid a cycle, decouple two parts;
- **remove duplication**: reuse an existing function, component, or constant instead of re-implementing it;
- **split or merge** a function, class, component, logic, or module because it is too big or mixes concerns, or because two things are the same concept;
- **rename a concept** so the code uses the domain's vocabulary (not a typo fix or a local variable rename for taste).

It does **not** qualify when it is about behaviour or correctness (bugs, edge cases, error handling, performance), tests only, typing only, naming of a local variable, formatting, copy or UI text, a question without a request, praise, or an acknowledgement.

When a comment mixes both, label it architecture if the structural request is a real part of it.

Answer with **only** a JSON array, one object per comment, in the order given:

```json
[{ "id": "gh:12345:67890", "architecture": true, "kind": "route-through-facade", "quote": "use the facade instead of importing the model" }]
```

- `kind` is one of `move`, `route-through-facade`, `boundary-or-dependency`, `remove-duplication`, `split-or-merge`, `rename-concept`, or `none` when `architecture` is false.
- `quote` is at most 12 words copied from the comment that carry the request; use `""` when `architecture` is false.
