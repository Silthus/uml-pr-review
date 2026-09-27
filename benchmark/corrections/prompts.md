# Classifier and verifier prompts, exactly as sent

Each prompt goes to one fresh sub-agent through Claude Code's Agent tool, with the model named in its heading. `<repo>` is this repository's checkout and `<work>` is the working directory of `bun benchmark/corrections/run.ts` (default `benchmark/.cache/corrections`, which is not committed because comment bodies and diffs stay out of this public repository). `<batch>` is the three-digit batch number.

## First pass (Haiku, batches of 60 comments, tuned for recall)

```text
You are a first-pass filter. Work alone. Read the rubric at <repo>/benchmark/corrections/rubric.md, then read the comments at <work>/packets/first-pass-<batch>.md (all of it, in chunks if needed). Do not read any other file, do not search, do not run commands, and do not use the web.

For every comment, decide whether it could be an architecture correction under the rubric. Recall matters most: false positives are cheap because a stronger model reviews every positive, while a missed correction is lost for good. Mark a comment as a candidate whenever it plausibly asks for any structural change (reuse, moving code, a facade or boundary, a dependency, duplication, splitting or merging, or renaming a concept), even if you are unsure.

Write a JSON array to <repo>/docs/corrections/labels/first-pass/batch-<batch>.json with the Write tool: one object per comment, in the order given, exactly {"id": "<id>", "candidate": true|false}. Include every comment id from the file. Reply with only the number of comments you labelled and how many are candidates.
```

## Confirmation (Opus, every first-pass candidate, batches of 50)

```text
You are an independent classifier. Work alone. Read the rubric at <repo>/benchmark/corrections/rubric.md, then read the comments at <work>/packets/confirm-<batch>.md (all of it, in chunks if needed). Do not read any other file, do not search, do not run commands, and do not use the web.

Label every comment in the order given, following the rubric exactly. Write a JSON array to <repo>/docs/corrections/labels/confirm/batch-<batch>.json with the Write tool: one object per comment, exactly {"id": "<id>", "architecture": true|false, "subtype": "<sub-type>", "quote": "<quote>"}. The subtype is one of reuse, layer, facade-boundary, dependency, duplication, split-merge, naming, or other, and "none" when architecture is false. The quote is at most 20 words and 200 characters copied verbatim from the comment that carry the structural request, and "" when architecture is false. Include every comment id from the file. Reply with only the number of comments you labelled and how many are architecture corrections.
```

## Recall check (Opus, a seeded sample of 200 first-pass negatives from the development set)

The confirmation prompt, unchanged, over `<work>/packets/recall-<batch>.md`, writing to `<repo>/docs/corrections/labels/recall/batch-<batch>.json`. The sample comes from the development set only, so no held-out comment informs a change to the classifier.

## Fix verification (Opus, a seeded sample of about 50 located fixes, batches of 10)

```text
You are an independent verifier. Work alone. Read <work>/packets/verify-<batch>.md. Each entry holds a review comment on a PostHog pull request and the diff of the commit that our rule located as its fix: the first non-merge PR commit after the comment that touches the commented file. You may run read-only git commands in <posthog> (git show, git log, git diff) to see more of that commit or its neighbours; never write to that repository. Do not use the web.

For every entry, decide whether the located commit addresses the comment's structural request: "yes" when it does what was asked, "partly" when it does some of it or an equivalent, "no" when it does something unrelated, and "unverifiable" when the diff cannot tell (for example a squashed or rebased whole feature). Write a JSON array to <repo>/docs/corrections/labels/verification/batch-<batch>.json with the Write tool: one object per entry, exactly {"id": "<id>", "addressed": "yes"|"partly"|"no"|"unverifiable", "note": "<at most 200 characters on what the commit does>"}. The note describes code, never quotes the comment. Reply with only the counts per answer.
```
