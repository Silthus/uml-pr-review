# Verifier and judge prompts, exactly as sent

Each prompt went to one fresh Opus sub-agent through Claude Code's Agent tool. `<repo>` is this repository's checkout, `<posthog>` the read-only PostHog clone, and `<batch>` the three-digit batch number. The packets live under `benchmark/.cache/grader/packets/`, which is not committed, because comment bodies and diffs stay out of this public repository. `bun benchmark/grader/verification.ts` writes the verification packets, and `bun benchmark/grader/evaluate.ts false-alarms` writes the judge packets.

## Fix verification (every isolable fix without a label, batches of 20)

#103's verifier prompt, with this repository's paths. The development batches replied with their counts per answer. The held-out batches replied only "done", so their counts stayed out of the conversation until the validation run.

```text
You are an independent verifier. Work alone. Read <repo>/benchmark/.cache/grader/packets/<split>/verify-<batch>.md (all of it, in chunks if needed). Each entry holds a review comment on a PostHog pull request and the diff of the commit that our rule located as its fix: the first non-merge PR commit after the comment that touches the commented file. You may run read-only git commands in <posthog> (use `/usr/bin/git -C <posthog> show ...`, `log`, `diff`) to see more of that commit or its neighbours; never write to that repository. Do not read any other file in the uml-pr-review repository, do not search it, and do not use the web.

For every entry, decide whether the located commit addresses the comment's structural request: "yes" when it does what was asked, "partly" when it does some of it or an equivalent, "no" when it does something unrelated, and "unverifiable" when the diff cannot tell (for example a squashed or rebased whole feature). Write a JSON array to <repo>/benchmark/grader/verification/<split>/batch-<batch>.json with the Write tool: one object per entry, exactly {"id": "<id>", "addressed": "yes"|"partly"|"no"|"unverifiable", "note": "<at most 200 characters on what the commit does>"}. The note describes code, never quotes the comment. Include every entry id from the file. Reply with only the counts per answer.
```

## False-alarm judge (every flag in the packets, batches of 25)

A packet entry holds the pull request link, the merge commit, the flag's file, line, and one-line description, and 12 lines of code on each side of the line at the merge commit. For a clone or a name twin, the description names the other file. The prompt tells the judge how to open that file with `git show`.

```text
You are an independent code reviewer. Work alone. Read <repo>/benchmark/.cache/grader/packets/false-alarm/false-alarm-<batch>.md (all of it, in chunks if needed). Each entry is one finding that an automated checker raised on a merged PostHog pull request: the file and line, the checker's one-line description, and the code around that line at the merge commit. You may run read-only git commands in <posthog> to see the change and the code the finding refers to, for example `/usr/bin/git -C <posthog> show <merge commit> -- <path>` or `/usr/bin/git -C <posthog> show <merge commit>:<other path>`. Never write to that repository. Do not read any other file in the uml-pr-review repository, do not search it, and do not use the web.

For every entry, decide whether the finding points at a real architecture or maintainability problem that this pull request introduced, one that a careful reviewer on this codebase would reasonably ask the author to change:
- "problem": yes.
- "not-a-problem": the finding is wrong, or technically true but harmless, conventional in this codebase, clearly intended, boilerplate, or not introduced by this change.
- "unsure": you cannot tell.

Write a JSON array to <repo>/benchmark/grader/false-alarms/heldout/batch-<batch>.json with the Write tool: one object per entry, exactly {"id": "<id>", "verdict": "problem"|"not-a-problem"|"unsure", "note": "<at most 200 characters on why>"}. Include every entry id from the file. Reply with only the counts per verdict.
```
