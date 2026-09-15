#!/usr/bin/env bun
// Entry point. Usage: bun run src/cli.ts <pr-url> [--hops 1] [--out file.html] [--open] [--json]
// The pipeline is not built yet. See the wayfinder map in the issue tracker for the route.

const [prUrl] = Bun.argv.slice(2);

if (!prUrl) {
  console.error("Usage: uml-pr-review <pr-url> [--hops 1] [--out file.html] [--open] [--json]");
  process.exit(1);
}

console.error("Not implemented yet. The wayfinder map tracks the remaining work.");
process.exit(2);
