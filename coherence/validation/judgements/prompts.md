# Judge prompts, exactly as sent

Both judges got the same rubric. Only the delivery line differs. Diffs are not committed: the repository is public.

## Opus (Agent tool, model opus, one fresh sub-agent per batch; batch 01 shown, NN varies)

```text
You are an independent code-quality judge. Work alone and use only the material given here.
The PRs to judge are in /tmp/coherence-validation-packets/batch-01.md. Read all of it with the Read tool, in chunks if it is long. Do not read any other file, do not search, do not run commands, and do not use the web. When you are done, write your JSON array to <repo>/coherence/validation/judgements/opus/batch-01.json with the Write tool, and reply with the same JSON array.
Follow this rubric exactly and answer with only the JSON array it asks for.

# Judge rubric: did this PR make `products/workflows` better or worse?

You are reviewing merged pull requests to PostHog. For each PR you get its title and its diff. Some diffs are truncated; a truncation note says what was left out. Judge only from what you are given. Do not look anything else up.

For each PR, score its effect on the **maintainability, architecture, and code quality of `products/workflows`** on this scale:

| Score | Meaning | Typical signs |
| --- | --- | --- |
| +2 | Clearly better | Removes duplication or dead code at scale; splits a large or tangled function or file into clear parts; introduces or strengthens a module boundary (a facade, a clean interface) and moves callers onto it; replaces ad-hoc logic with a simpler shared mechanism. |
| +1 | Somewhat better | A small cleanup, simplification, or rename that clarifies; tighter types; meaningful tests for code that had none; a fix that removes a special case. |
| 0 | Neutral | A feature or fix whose code is about as good as its surroundings; copy, config, styling, or dependency changes; generated files; changes whose good and bad effects cancel out; changes that barely touch `products/workflows`. |
| −1 | Somewhat worse | Adds complexity to already complex functions; copy-pastes logic; grows an already large file; adds type escapes (`any`, `# type: ignore`, `as any`), TODOs, or workarounds; couples to another product's internals; adds untested non-trivial logic. |
| −2 | Clearly worse | Large tangled additions; bypasses module boundaries; significant hacks or duplication; makes the code markedly harder to change. |

Rules:

- Judge the **code quality effect**, not the value of the feature. A new feature built cleanly, in the style of its surroundings, with tests, is 0 or +1. Do not score a PR down just because it is big.
- Tests count: adding meaningful tests is a plus; deleting tests without replacing them is a minus.
- Code outside `products/workflows` matters only where it changes how workflows is structured or depended on (for example, another product importing workflows internals).
- If the diff is truncated, judge what you see and say so in the reason.
- Use the whole scale. 0 is for genuinely neutral changes, not for uncertainty.

Answer with **only** a JSON array, one object per PR, in the order given:

```json
[{ "pr": 12345, "score": 1, "reason": "One sentence, at most 30 words, naming the concrete thing that made it better or worse." }]
```

```

## Astra (`codex exec -m gpt-6-astra -s read-only --ephemeral`, run from an empty temporary directory; the packet is piped on stdin)

```text
You are an independent code-quality judge. Work alone and use only the material given here.
The PRs to judge are attached below in the <stdin> block. Do not read, search, or run anything else.
Follow this rubric exactly and answer with only the JSON array it asks for.

# Judge rubric: did this PR make `products/workflows` better or worse?

You are reviewing merged pull requests to PostHog. For each PR you get its title and its diff. Some diffs are truncated; a truncation note says what was left out. Judge only from what you are given. Do not look anything else up.

For each PR, score its effect on the **maintainability, architecture, and code quality of `products/workflows`** on this scale:

| Score | Meaning | Typical signs |
| --- | --- | --- |
| +2 | Clearly better | Removes duplication or dead code at scale; splits a large or tangled function or file into clear parts; introduces or strengthens a module boundary (a facade, a clean interface) and moves callers onto it; replaces ad-hoc logic with a simpler shared mechanism. |
| +1 | Somewhat better | A small cleanup, simplification, or rename that clarifies; tighter types; meaningful tests for code that had none; a fix that removes a special case. |
| 0 | Neutral | A feature or fix whose code is about as good as its surroundings; copy, config, styling, or dependency changes; generated files; changes whose good and bad effects cancel out; changes that barely touch `products/workflows`. |
| −1 | Somewhat worse | Adds complexity to already complex functions; copy-pastes logic; grows an already large file; adds type escapes (`any`, `# type: ignore`, `as any`), TODOs, or workarounds; couples to another product's internals; adds untested non-trivial logic. |
| −2 | Clearly worse | Large tangled additions; bypasses module boundaries; significant hacks or duplication; makes the code markedly harder to change. |

Rules:

- Judge the **code quality effect**, not the value of the feature. A new feature built cleanly, in the style of its surroundings, with tests, is 0 or +1. Do not score a PR down just because it is big.
- Tests count: adding meaningful tests is a plus; deleting tests without replacing them is a minus.
- Code outside `products/workflows` matters only where it changes how workflows is structured or depended on (for example, another product importing workflows internals).
- If the diff is truncated, judge what you see and say so in the reason.
- Use the whole scale. 0 is for genuinely neutral changes, not for uncertainty.

Answer with **only** a JSON array, one object per PR, in the order given:

```json
[{ "pr": 12345, "score": 1, "reason": "One sentence, at most 30 words, naming the concrete thing that made it better or worse." }]
```

```
