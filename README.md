# uml-pr-review

Draws the architecture a pull request touches: the touched files and symbols, together with their callers and callees, as one self-contained HTML artifact.

## Companion app

```sh
bun install
bun run start
```

Open http://localhost:4477, pick a local clone (paste a path or use **Choose folder…** on macOS), pick one of its open pull requests, and read the diagram.

The server reads everything straight from Git objects in your clone. It never checks out a worktree, so repositories the size of PostHog work. The first review of a pull request fetches its head and base commits over HTTPS with your `gh` credentials into private `refs/uml-pr-review/*` refs. Your branches and working tree stay untouched.

Requirements: [Bun](https://bun.sh), Git, and the [GitHub CLI](https://cli.github.com) signed in (`gh auth status`).

## CLI

Run it inside a clone:

```sh
bun run cli <pr-url | pr-number> [--out file.html] [--open] [--json]
```

`--json` prints the Graph instead of writing the artifact. The last stdout line is the artifact path.

## How it analyzes

- Languages: Python, TypeScript, and JavaScript, parsed with tree-sitter.
- Touched: a symbol whose line range overlaps an added line or a deletion in the diff.
- Callees: calls inside touched symbols, resolved through same-file definitions, `self`/`this`, and imports.
- Callers: one `git grep` over the head commit for touched names, then the same resolution in the files it finds. Names that appear in more than 120 files are skipped and listed as warnings.
- Packages: the nearest folder with a `package.json`, `pyproject.toml`, `setup.py`, `Cargo.toml`, or `go.mod`.

Resolution is name-based. Calls through untyped receivers, inherited methods, and re-exporting barrels are missed.

## Vocabulary

See `CONTEXT.md`.
