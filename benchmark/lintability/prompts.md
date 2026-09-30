# Labeller prompts, exactly as sent

Each prompt goes to one fresh Opus sub-agent through Claude Code's Agent tool. `<repo>` is this repository's checkout, `<work>` is the working directory of `bun benchmark/lintability/run.ts` (default `benchmark/.cache/lintability`, not committed because it holds comment bodies and diffs), and `<packet>` is the packet name, for example `label-r1-007`. `<stage>` is `calibration`, `label`, `recheck`, or `agreement`: all four use the same prompt.

## Labelling (calibration, label, agreement)

```text
You are an independent labeller. Work alone. Read the rubric at <repo>/benchmark/lintability/rubric.md, then read the corrections at <work>/packets/<packet>.md (all of it, in chunks if needed). Do not read any other file, do not search this repository, and do not use the web.

To check the `existed` guard against the code at a correction's `base` commit (the `before` commit in the first labelling round), you may run only these read-only commands: `cd /home/coder/posthog && git show <base>:<path>`, `cd /home/coder/posthog && git grep -n '<token>' <base> -- '<pathspec>'`, and `cd /home/coder/posthog && git ls-tree -r --name-only <base> -- '<dir>'`. Never run any other command in that repository and never write to it.

Label every correction in the order given, following the rubric exactly. Before writing, check each label against the rubric's step 3: `yes` and `partial` need a declarable kind, no failed guard, a tier other than not-lintable, and a tool other than review-only; `no` needs tier not-lintable and tool review-only; a `no` with a declarable kind must mark the guard that failed.

Write a JSON array to <work>/labels/<stage>/<packet>.json with the Write tool: one object per correction, exactly {"id": "<id>", "catchable": "yes"|"partial"|"no", "ruleKind": "<kind>", "tier": "lintable-now"|"lintable-with-a-custom-rule"|"not-lintable", "tool": "<tool>", "ruleSketch": "<one line, at most 200 characters>", "guards": {"general": "pass"|"fail"|"n/a", "existed": "pass"|"fail"|"n/a", "syntactic": "pass"|"fail"|"n/a", "firesAndClears": "pass"|"fail"|"n/a"}, "note": "<at most 200 characters>"}. Include every correction id from the file. Reply with only the number of corrections you labelled and the counts per catchable value.
```

## Rule grouping (rules)

```text
You group lint rules. Work alone. Read <work>/packets/<packet>.md: one line per correction that a linter could catch, as `id | language | path | kind | tool | rule sketch`. Do not read any other file, do not run commands, and do not use the web.

Many sketches state the same general rule in different words or for different scopes. Give every line a short canonical rule name (at most 120 characters) that names the general rule a team would declare once, so that corrections caught by the same declared rule share exactly the same name, for example "Products are reachable from outside only through backend.facade" or "Use lib/dayjs, not dayjs". Merge only sketches that one declaration would catch; keep different banned things apart.

Write a JSON array to <work>/labels/rules/<packet>.json with the Write tool: one object per line, exactly {"id": "<id>", "rule": "<canonical rule name>"}. Include every id. Reply with only the number of lines and the number of distinct rules.
```

## Calibration log

The rubric was frozen after the 50-row calibration sample (`calibration` stage, a seeded ranking on `sha256("110:calibration:" + id)`). The calibration labels only tuned the rubric; every calibration row was labelled again with the frozen rubric in the `label` stage.

The calibration labeller labelled the 50 rows 2 `yes`, 2 `partial`, 46 `no`, and reported eight places where the rubric was ambiguous. Each became a sentence in the frozen rubric:

1. Existing violations at `before` do not fail `general`; a new rule ships with a baseline. Style nits a team would not declare do fail it.
2. Established conventions (design-system elements, the product facade, a widely used paved path, common hygiene and security rules) pass `general`.
3. Judgment kinds with no candidate rule record `general` and `syntactic` as `fail`, and `existed` and `firesAndClears` as `n/a`.
4. `firesAndClears` is judged at the commented site; other occurrences in the file are baseline.
5. When the located fix does not address the comment, the label is judged against the comment, and `existed` is still checked at `before`.
6. When the replacement existed but had to be extended for this case, `existed` passes and the correction is at most `partial`.
7. When no judgment kind fits a failed rule, `design-other`.
8. oxlint's native `no-restricted-imports` and `no-restricted-properties` are `lintable-now`; code shapes are custom. YAML, SQL, and other files use `semgrep`.

## Recheck after review

The adversarial review found that `existed` had been checked at `before`, which already holds the PR's own earlier commits, so a helper the PR itself added counted as existing. It also found one hindsight rule labelled `yes`. The rubric now checks `existed` at `base` (the PR's merge base with master, printed in every packet) and fails `general` for rules that would flag many correct uses. Only caught corrections can change under a stricter `existed` and `general`, so the `recheck` stage relabels every correction the `label` stage caught (`yes` or `partial`) with the revised rubric and the same prompt; its labels replace the first ones. The agreement sample was labelled before this revision.
