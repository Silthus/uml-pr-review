# define-invariant

One conversation that declares a component's first Coherence invariants, wires the linter that enforces them, and proves each one. `SKILL.md` is the conversation; `enforcers.md` is what it reads about PostHog's enforcers.

Load it for one session and run it from a kit worktree:

```sh
cd /tmp/try-ts/posthog && claude --plugin-dir ~/dev/uml-pr-review/skills/define-invariant
# then, in the session:
/define-invariant nodejs/src/cdp/services/hogflows
```

`--plugin-dir` takes this folder, not `skills/`: Claude Code reads a folder holding a `SKILL.md` as a one-skill plugin. `/define-invariant` resolves while no other loaded skill has that name; `/define-invariant:define-invariant` always does.

The skill runs Coherence as `node $COHERENCE_HOME/src/cli.ts`, so export `COHERENCE_HOME` from the kit's setup first. Its evidence is this repository's `docs/lintability/labels.jsonl`, `docs/corrections/corpus.jsonl`, and `docs/harvest/<product>/rules.json`, found two folders above the skill.

The dogfood on `products/workflows` is in [`docs/dogfood/workflows/`](../../docs/dogfood/workflows/README.md).
