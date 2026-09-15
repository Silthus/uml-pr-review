# uml-pr-review

Run it inside a cloned repository. Give it a GitHub pull request URL. Get one self-contained HTML artifact that draws the files and symbols the pull request touches, together with their callers and callees.

## Status

Prototype. The route to version 1 is tracked as a wayfinder map in this repository's issues.

## Run

```sh
bun install
bun run src/cli.ts <pr-url>
```

## Vocabulary

See `CONTEXT.md`.
