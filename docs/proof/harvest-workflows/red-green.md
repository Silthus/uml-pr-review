# Proof: harvest workflows rules

## Red: the verbatim-quote guard is load-bearing

Negative control. The check in `harvest/lib/theory.ts` that a quote is verbatim in its evidence was replaced with `if (false)`, then:

```
$ bun test harvest/test/theory.test.ts
66 |     expect(() => assembleTheory(draft([invented]), harvest)).toThrow('facade-only: the quote "always use the facade" is not verbatim in gh:1:1');
error: expect(received).toThrow(expected)
Expected substring: "facade-only: the quote \"always use the facade\" is not verbatim in gh:1:1"
(fail) assembleTheory > rejects a quote that is not verbatim in its evidence [0.16ms]
 5 pass
 1 fail
```

## Green: the check restored

```
$ bun test harvest/test/theory.test.ts
 6 pass
 0 fail
 7 expect() calls
Ran 6 tests across 1 file. [13.00ms]
```

## Full gate on the final tree

```
$ bun test
 375 pass
 0 fail
 874 expect() calls
Ran 375 tests across 38 files. [14.29s]
$ bun run typecheck
$ tsc --noEmit
exit 0
```

## The outputs came from these commands

```
AI_GATEWAY_API_KEY=… bun harvest/run.ts --repo PostHog/posthog --scope products/workflows --scope nodejs/src/cdp/services/hogflows \
  --since 2026-03-01 --out /tmp/wfh/out --term workflows --term hogflow --term hog_flow --term "hog flow" --term broadcast
bun harvest/assemble.ts --harvest /tmp/wfh/out/harvest.json --draft /tmp/wfh/draft.final.json --out docs/harvest/workflows
```

`assemble.ts` rejects the draft unless every evidence id is in the harvest and every quote is verbatim in its source.
