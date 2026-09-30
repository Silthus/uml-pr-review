# Enforcers

What each PostHog enforcer owns, what Coherence credits, and how to write a lint entry for an invariant. Paths are from the PostHog root.

## What each enforcer owns

| Enforcer | Where | Owns |
|---|---|---|
| tach | `tach.toml` `[[modules]]`, `[[interfaces]]` | Python dependencies between modules, and which submodules others may import (a product's facade) |
| import-linter | `pyproject.toml` `[[tool.importlinter.contracts]]` | Python layering inside a product: presentation reaches only the facade, routes only presentation |
| oxlint (frontend, `products/**`) | `.oxlintrc.json` | TypeScript under `frontend/` and `products/` |
| oxlint (nodejs) | `nodejs/.oxlintrc.nodejs.json`, plus nested `.oxlintrc.json` files under `nodejs/` | TypeScript under `nodejs/` |
| ruff | `pyproject.toml` `[tool.ruff]`; `products/ruff.toml` extends it for `products/` | Python lint, including `TID251` banned APIs |

A folder is covered by an enforcer when a module entry, a contract pattern (`products.*.backend` covers every product's backend), or a config's `files`/folder reaches it.

## What Coherence credits as `checker-choked`

- **TypeScript module chokepoint:** an oxlint config whose folder contains the protected module lists the `coherence` plugin in `jsPlugins` and sets `coherence/chokepoint` to `error` in its top-level `rules`. The rule reads the spec bullets itself, so it needs no options beyond `root`. A nested `.oxlintrc.json` between that config and the module shadows it: it needs the plugin and the rule too.
- **Python module chokepoint:** an import-linter contract names the protected module or a parent of it.
- **Python symbol chokepoint:** the name starts with `_` and Pyright's `reportPrivateUsage` is an error.

Everything else grades `reference-choked` at best: Coherence's own check, through its edit hook.

Credit says a rule names the module, not that it forbids every outside import. Say in the bullet's `because` what the credited rule actually stops.

## Lint totality oracle entries

The tool in `via: lint <tool>:<rule>` must be a key under `lint` in `coherence.config.json`. Every entry is `error`: CI runs oxlint with `--quiet`, which hides warnings.

### oxlint `no-restricted-imports`

Append a pattern to the `no-restricted-imports` of the config or override that covers the folder. Overrides replace a rule's options instead of merging them, so an override that sets the rule repeats the global bans; copy them when you add a new override.

```json
{ "group": ["~/cdp", "~/cdp/**"], "message": "<invariant name> (<spec path>): <the paved path>" }
```

Bullet: `via: lint oxlint:no-restricted-imports matching "<text in the message or pattern>"`.

Listed residual: the override's `excludeFiles`.

### ruff `TID251`

PostHog's ruff selects `TID253` but not `TID251`, so the entry selects it. `banned-api` bans a name everywhere its config applies, and ruff lints each file with the nearest config above it. So scope the ban with a `ruff.toml` in the component folder that extends the nearest config (for a folder under `products/`, `products/ruff.toml`):

```toml
extend = "<relative path to the nearest ruff config>"

[lint]
extend-select = ["TID251"]

[lint.flake8-tidy-imports.banned-api]
"a.b.name".msg = "<invariant name> (<spec path>): <the paved path>"
```

A ban for the whole repository goes in `pyproject.toml` under `[tool.ruff.lint]` instead.

Bullet: `via: lint ruff:TID251 matching "<name>"`.

Listed residual: `[lint.extend-per-file-ignores]` with `TID251` in the same `ruff.toml`, keyed relative to its folder. Use the `extend-` table: a nested `per-file-ignores` replaces the parent's, and the parent's test and folder ignores stop applying. The paved path itself (the one module allowed to use the banned name) is excluded the same way; name it in `over:` as the paved path, apart from the residual.

## Lint timing

Time one lint run over the folder with the command in `coherence.config.json`, with the folder appended, and report it in the summary.
