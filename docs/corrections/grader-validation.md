# Rule-violation grader: development tuning and held-out validation

Ticket [#100](https://github.com/Silthus/uml-pr-review/issues/100), part of [#97](https://github.com/Silthus/uml-pr-review/issues/97). Corpus: [`corpus.jsonl`](corpus.jsonl) from #103.

```sh
bun benchmark/grader/grade.ts --repo ~/dev/posthog --commit <sha> [--base <sha>] [--json]
```

The grader scores one commit, or a range, by the architecture violations it introduces or removes, across the whole repository. Each detector computes its violations over the changed files before and after, matches them by rule, file, and subject, and reports what was introduced and removed, with `file:line` evidence. The grade is the weighted sum of introduced minus removed violations.

## Verdict

VERDICT_PLACEHOLDER

## Detectors

Kept, in the frozen [`config.json`](../../benchmark/grader/config.json). "Production" means Python, TypeScript, JavaScript, or Rust outside tests, migrations, fixtures, generated code, and stories.

| Detector | What counts as one violation | Weight |
| --- | --- | --- |
| facade | An import into another product's `backend/` that is not its `facade/` or `routes.py` (the #65 and #77 rule, `isFacadeBypass`), from the indexer graph. Test files are exempt. | 5 |
| layering | A rule from `products/architecture.md` that a machine can check, or the kea rule from the development corrections (list below). | 3 |
| complexity | A function in a changed file over CCN 10, over CCN 20, or over 60 lines of code (lizard), matched by name before and after. The report also lists every touched function with its CCN and NLOC before and after. | 2 |
| reuse | A new top-level declaration whose name, ignoring case and `_`, `$`, and `-`, is already declared in one or two other production files of the same language anywhere in the repository (at least 8 characters; a name declared in three or more places is a convention). It also flags a raw `<button>`, `<input>`, `<select>`, or `<textarea>` in a frontend component outside `lemon-ui/`. | 2 |
| duplication | A block of at least 4 winnowed fingerprints (25-token windows, winnowing window 20, joined across gaps of up to 4 lines) that also occurs in one or two other production files anywhere in the repository, or twice in the same file. A fingerprint found in more places is boilerplate. | 1 |

Layering rules that are checked:
- `presentation/` imports only its own `facade/` and `presentation/`.
- `routes.py` imports only `presentation/`.
- A facade imports neither its `presentation/` nor DRF.
- `management/commands/` and `tasks/` do not import `models` or `logic`.
- `facade/contracts.py` imports neither models, Django, nor DRF.
- No `apps.get_model(...)` in production Python.
- A React component under `frontend/src` or `products/*/frontend` does not add `useState`, `useEffect`, `useMemo`, `useCallback`, or `useReducer`. This rule comes from the development layer corrections: 14 of the 98 isolable ones ask to move component state, effects, or derivation into kea logic.

Layering rules that are not implemented, because a machine cannot decide them from the code:
- "validation lives in serializers";
- "presentation holds no business rules";
- "facades stay thin";
- "models are ORM only";
- RBAC in DRF, not in the facade;
- wiring-location soundness;
- the watched-models allowance and its instance-free shapes;
- the direction rule between products.

Dropped. The code stays, off by default:
- **cycles** (an import from a changed file that closes an import cycle). It caught none of the development dependency or facade-boundary corrections in any form I tried, so it is dropped under the ticket's rule.
  - As strongly connected components, PostHog has components of about 1,000 and 1,900 files, so "on a cycle" means "inside the tangle".
  - As cycles of at most 4 files, counting function-local imports, it flags 2.8% of clean files for 2.4% catches. Django code uses function-local imports on purpose to break cycles.
  - Without them, cycles of at most 4 files catch nothing at all.
  - Cycles of at most 8 files catch 11 of 420 verified fixes at a 1.1% flag rate. The size baseline at that rate catches 18.
  - The fixture test and #95's cycle (`df69d9b`, reported as removed) show the detector works.
- **vocabulary** (terms to avoid, from a per-product term file; today only `docs/harvest/workflows/rules.json` exists). It caught none of the 45 isolable development naming corrections and flagged 1.8% of clean files, mostly `hogflow`, which is the sanctioned internal code name. The generic mechanism stays.
- **Shared-location reuse only**, the ticket's first reading of reuse: names and clones matched against `frontend/src/lib`, `common/`, and `packages/` only. It caught 1 of 101 verified development reuse corrections. Reuse fixes import from all over the repository, not from those roots, so the kept reuse detector matches names repository-wide, and the duplication detector covers clones from anywhere.

## Method

- **Unit.** One correction is one human review comment on one file, with its located fix commit (#103). The grader runs twice per correction:
  - on the pull request as the reviewer saw it, from the merge base with `master` to the commented commit;
  - on the fix commit against its parent.
- **Catch.** The first run reports an introduced violation in the commented file. The *size baseline* flags the same file when the reviewed diff adds more than N lines to it.
- **Flag rate.** Catching is cheap if everything is flagged. So every catch rate stands next to the share of changed production files the grader flags in 200 seeded pull requests without any correction, from the same split. The baseline's N is set so that it flags the same share of those files.
- **Verification.** Fresh Opus verifiers labelled every isolable fix: 484 development fixes and all 300 held-out fixes, on top of #103's 50. They used #103's prompt and saw only the comment, the fix commit, and read-only git ([`verification/`](../../benchmark/grader/verification/)). Tuning used verified development fixes only. The headline held-out numbers use verified held-out fixes only.
- **Tuning.** Only on the development set. The held-out labels, grades, and judge packets were not read before the frozen config was committed ([`frozen.json`](../../benchmark/grader/frozen.json)).
- **False alarms.** For the seeded 200 held-out pull requests without corrections, up to 5 flags per pull request went to fresh Opus judges, blind to the grader.

Reproduce:

```sh
bun benchmark/grader/verification.ts --posthog ~/dev/posthog --split development   # verification packets; labels by Opus sub-agents
bun benchmark/grader/evaluate.ts grade --split development --posthog ~/dev/posthog --shard 0/4   # and 1/4, 2/4, 3/4
bun benchmark/grader/evaluate.ts report --split development --posthog ~/dev/posthog
bun benchmark/grader/evaluate.ts grade --split heldout --posthog ~/dev/posthog --shard 0/4        # refuses unless config.json matches frozen.json
bun benchmark/grader/evaluate.ts false-alarms --split heldout --posthog ~/dev/posthog             # judge packets; labels by Opus sub-agents
bun benchmark/grader/evaluate.ts scope --split heldout --posthog ~/dev/posthog
bun benchmark/grader/evaluate.ts validate --split heldout --posthog ~/dev/posthog
```

## Development set (tuning)

Verified development fixes against 200 clean development pull requests, frozen config:

<!-- development:start -->
<!-- development:end -->

Every configuration tried, on the 420 verified development fixes and the same 200 clean development pull requests. A flag counts from any enabled detector.

| Configuration | Flags clean files | Catches | Size baseline at that rate |
| --- | --- | --- | --- |
| First draft: all 7 detectors, clones of 2+ fingerprints in up to 10 files, cycles as components of up to 50 files, reuse against shared roots only | 26.8% | 170 (40.5%) | 208 (49.5%) |
| Clones 3+ in up to 3 files, cycles as unbounded components, functions over 60 lines, vocabulary off | 19.2% | 170 (40.5%) | 151 (36.0%) |
| Clones 6+ in up to 3 files, components up to 500 files, functions over 100 lines | 11.8% | 121 (28.8%) | 98 (23.3%) |
| Cycles of up to 4 files with function-local imports, clones 3+ in up to 3 files | 19.8% | 159 (37.9%) | 151 (36.0%) |
| Cycles of up to 8 files without them, clones 4+ in up to 2 files, repository-wide name twins by language, generated code and stories excluded | 17.7% | 163 (38.8%) | 142 (33.8%) |
| **Frozen:** the same, without cycles | **16.9%** | **156 (37.1%)** | **131 (31.2%)** |

Two more variants (twins of 8+ characters in up to 2 files against 12+ in 1 file, clones 3+/3 against 4+/2) were stopped at about 80% when the cross-language twins showed up. Their partial numbers chose the clone and cycle-length settings of the fifth row.

The per-detector table above compares each detector alone with the size baseline at that detector's own flag rate. Facade, complexity, and duplication beat it. Reuse ties it. Layering is slightly below it (14 against 16 fixes), but it catches its own sub-type (5 of 79 layer corrections), so it stays under the ticket's rule.

<!-- held-out:start -->
<!-- held-out:end -->

## Limits

- **Size is a strong prior.** Reviewers comment on the files that change most, so "adds more than N lines" is a hard baseline. Every comparison here is at a matched flag rate, never at a free N.
- **File level, not the exact request.** A catch means the grader flags the commented file. It does not mean the flag names what the reviewer asked for. *Near* (within 20 lines) and *confirmed* (the fix removes a violation of the same detector) are the stricter readings.
- **Fix location.** Fixes come from #103's locator, whose precision was 72% on its sample. That is why the headline uses verified fixes only. The verifiers ran with read-only repository access, and their blindness rests on instructions.
- **Judges.** The false-alarm judges saw each flag's own description and the code, but not the grade, the weights, or any catch numbers. A judge that sees the checker's wording can still be swayed by it.
- **Tuning was coarse.** Three configurations were tried on the development set: the first draft and two clone and complexity variants. The short-cycle search replaced file-level SCCs after the first draft, when PostHog turned out to have SCCs of about 1,000 and 1,900 files. A finer search could fit the development set better. It could also overfit it.
- **Scope index sample.** The old scope index ran on 40 verified held-out fixes, not on all of them, because each run measures a whole product scope twice.
- **Cache location.** The grader writes its fingerprint and lizard caches under the repository's common directory (`uml-pr-review/`), next to the indexer's cache, unless `--cache` names another directory. The evaluation used `benchmark/.cache/grader`.
