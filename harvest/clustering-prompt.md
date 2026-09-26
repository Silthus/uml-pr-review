You are clustering harvested evidence into a first-draft architecture theory for {{product}} in {{repo}} (scopes: {{scopes}}). Work read-only: never comment, post, or push, and read code through `gh api 'repos/{{repo}}/contents/<path>?ref={{commit}}' -H 'Accept: application/vnd.github.raw'` or `gh search code --repo {{repo}}`.

## Inputs in {{workdir}}

- `review.jsonl`: human PR review comments (inline comments and review bodies) since {{since}}. `byPullRequestAuthor` marks replies by the PR's own author.
- `bot-review.jsonl`: bot review comments. Grep it for corroboration; do not read all of it.
- `doc.jsonl`: normative lines from the scope's docs and skills, the agent guides above it, and the config blocks that name it.
- `session.jsonl`: turns where the harvesting user corrected a coding agent.
- `{{harvest}}`: the full harvest. Every `id` above is an item id in it. Code is pinned at {{commit}}.

Before clustering, read the scope's own guides (CONTRIBUTING, AGENTS, skills) and the repository's architecture docs, so the vocabulary and components match the code.

## Output

Write `{{draft}}` with this shape:

```
{
  "product": "{{product}}",
  "vocabulary": [{ "term", "definition", "avoid": [] }],               // about 15 terms, one precise meaning each
  "components": [{ "name", "role", "responsibility", "paths": [] }],    // about 8; role is taxonomy-style: registry, interpreter, scheduler, gateway, store, adapter, validator, editor state
  "caveats": [{ "statement", "evidence": [{ "id", "quote" }] }],
  "rules": [{
    "id": "kebab-case",
    "statement": "a short positive target",
    "kind": "guarantee | paved-path | boundary | vocabulary | caveat",
    "component": "one of the component names",
    "evidence": [{ "id": "<item id>", "quote": "<3-240 chars, verbatim in that item's body>" }],
    "currentLevel": "review-only | documented | linted | structural",
    "currentLevelBasis": "what you checked at the pinned commit and what you found",
    "proposedLevel": "a level at or above currentLevel",
    "howToEnforce": "one line: the lint, test, tach or import contract, type, or chokepoint",
    "confidence": "low | medium | high",
    "value": 1, "effort": 1
  }],
  "sourceNotes": ["3 to 6 short notes on what the clustering saw and ignored"]
}
```

## Rules

1. Do not invent. Ground every rule in harvested evidence. Prefer rules raised in at least two PRs or sessions, or by two reviewers other than the PR author. A rule with one source gets confidence `low` unless a doc states it. Aim for 20 to 30 rules.
2. Quote verbatim, 240 characters at most. Cite only evidence that supports the statement on its own, not a comment that shares a keyword.
3. A reply by the PR author that accepts a bot finding is weaker evidence than a reviewer raising the rule. Cite the finding that raised it when you use the reply.
4. Session evidence: quote only the user's own words. Skip pasted messages from colleagues, private links, customer names, and anything that looks like a credential.
5. Check every level against the code at {{commit}}: lint configs, import contracts, types that make the wrong state unrepresentable, invariant tests, and chokepoints. A guard that one caller path skips is not `structural`. Say what you checked in `currentLevelBasis`.
6. Leave out one-off bug findings unless the same class recurs; then state the guarantee that prevents the class.
7. Leave security weaknesses out of the draft. Report them to the user separately.
8. `value` is the reviewer and agent pain the rule prevents (frequency times blast radius); `effort` is the cost to move it one rung up.

Validate with `{{assemble}}`. It lists every unknown id, non-verbatim quote, credential-shaped quote, and downward proposal. Fix the draft until it passes.
