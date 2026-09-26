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
