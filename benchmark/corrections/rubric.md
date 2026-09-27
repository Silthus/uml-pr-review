# Rubric: is this review comment an architecture correction?

This generalises the `products/workflows` rubric from #94 (`coherence/validation/corrections/rubric.md`) to every product and area of `PostHog/posthog`, and replaces its kinds with the sub-types below.

You get human review comments left on code in PostHog pull requests. Each has an id, the PR, the file it was left on, and its text. The PR's own author never appears; bots are already removed.

A comment is an **architecture correction** when the reviewer asks the author to change the **structure** of the code, not just its behaviour or style. Label its sub-type:

- `reuse`: use something that already exists elsewhere in the codebase (a component, helper, hook, util, constant, API, model, or library already in use) instead of writing a new one. "We already have `formatDuration` in `lib/utils`", "use the `LemonTable` here".
- `layer`: move logic to another layer, module, file, or product. "This belongs in the service, not the viewset", "move this into the kea logic", "this should live in the Node worker, not Django".
- `facade-boundary`: route through a facade, public API, or entry point instead of reaching into another module's or product's internals. "Don't import the model directly, go through `products.x.backend.facade`".
- `dependency`: change a dependency or boundary: remove or invert a dependency, stop importing another area, avoid a cycle, decouple two parts. "`posthog/models` shouldn't depend on `ee`", "this creates a circular import".
- `duplication`: remove duplication inside the change: two or more copies of the same logic, schema, or constant that should become one. "This is the same as the block above; extract it".
- `split-merge`: split a function, class, component, or module that is too big or mixes concerns; or merge two things that are the same concept. "This function does three things; split it", "these two serializers should be one".
- `naming`: rename a **concept** so the code uses the domain's vocabulary or one consistent name across modules (not a typo, and not a local variable renamed for taste). "We call these 'workflows', not 'hog flows'".
- `other`: another structural request, such as where state or data ownership lives, or replacing an ad-hoc mechanism with the established one ("use a feature flag, not an env var", "store this on the team model").

It does **not** qualify when it is about:

- behaviour or correctness: bugs, edge cases, error handling, security, performance, or a query plan;
- tests only, typing only, lint, or formatting;
- a local variable name, a typo, copy, UI text, styling, or a log message;
- a question without a request, praise, an acknowledgement, or a discussion of the approach with no concrete structural ask;
- a nit about a single line that does not move, reuse, split, merge, or rename anything.

When a comment mixes both, it is an architecture correction if the structural request is a real part of it. A question that plainly proposes a structural change ("could we use the existing `X` here?") counts.
