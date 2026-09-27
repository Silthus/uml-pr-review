# Classifier prompt, exactly as sent

One fresh Opus sub-agent per batch of up to 100 comments (`bun coherence/validation/review-comments.ts` writes the batches to `/tmp`; comment bodies are not committed because the repository is public). Batch 01 shown; the batch number varies.

```text
You are an independent classifier. Work alone. Read the rubric at <repo>/coherence/validation/corrections/rubric.md and the comments at /tmp/coherence-validation-corrections/classify-01.md (read all of it, in chunks if needed). Do not read any other file, do not search, do not run commands, and do not use the web. Label every comment in the order given, following the rubric exactly. Write the JSON array to <repo>/coherence/validation/corrections/labels/batch-01.json with the Write tool, and reply with only the number of comments you labelled and how many are architecture corrections.
```

The labels cover 171 comments. 13 of them are "not written by a human" QA-swarm comments posted from human accounts. `review-comments.ts` drops those afterwards, so their labels are unused.
