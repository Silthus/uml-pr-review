# Rule-violation grader: development tuning and held-out validation

Ticket [#100](https://github.com/Silthus/uml-pr-review/issues/100), part of [#97](https://github.com/Silthus/uml-pr-review/issues/97). Corpus: [`corpus.jsonl`](corpus.jsonl) from #103.

```sh
bun benchmark/grader/grade.ts --repo ~/dev/posthog --commit <sha> [--base <sha>] [--json]
```

The grader scores one commit, or a range, by the architecture violations it introduces or removes, across the whole repository. Each detector computes its violations over the changed files before and after, matches them by rule, file, and subject, and reports what was introduced and removed, with `file:line` evidence. The grade is the weighted sum of introduced minus removed violations.

## Verdict

**On the held-out set, the grader does not beat the trivial size baseline, and most of what it flags is not a problem.**

- **Catch.** On the 240 verified held-out fixes, the grader flags the commented file for 78 (32.5%). It flags 18.6% of the changed production files in 200 clean held-out pull requests.
  - "Flag any file that adds more than 64 lines" flags the same share and catches 115 (47.9%).
  - The development-matched cut, more than 110 lines, flags only 9.9% of those files and still catches 79.
  - Across all 300 isolable fixes, verified or not, the grader catches 106 (35.3%).
- **Only facade beats size.** Facade bypasses catch 10 of 240 at a 0.5% flag rate, where size catches 7. Complexity, reuse, duplication, and layering each fall below size at their own flag rates.
- **False alarms.** Blind Opus judges called 168 of 178 decided flags on clean held-out pull requests not a problem, a **94% false-alarm rate**. Complexity crossings and name twins are almost all conventional or harmless. The 10 real finds include copied experiment components, a component effect that duplicates kea state, and a new cross-product import past a facade.
- **Development against held-out.** On the development set, the same frozen grader beat size: 37.1% against 31.2% at a 16.9% flag rate. That edge did not survive the time split.
  - Size is a much stronger prior on the held-out set: the matched cut drops from 110 to 64 lines and catches 48% instead of 31%.
  - Six configurations tried on the development set also fit it somewhat.
- **Old scope index.** On a sample of 36 verified held-out fixes, it moved as asked on 5 and the wrong way on 1. The grader's confirmed catches, where a violation is flagged before the fix and removed by it, reach 5 of 40 on the same sample. Neither is a usable per-PR signal.
- **Speed.** 0.86 s per commit (median 0.84 s, p90 1.05 s) over 100 consecutive `master` commits in one process with warm caches. The first commit, which builds the fingerprint and symbol indexes, takes about 3 s. A 3,000-commit trend for #101 takes about 45 minutes on one process.
- **Use.** Treat the grader as an evidence generator, not a gate or a score. Facade bypasses are worth surfacing. Every other flag needs a human or a judge before anyone acts on it.

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
| Detector | Flags clean files | Catches corrections | Size baseline at the same flag rate |
| --- | --- | --- | --- |
| facade | 0.8% | 23/420 (5.5%) | 16/420 (3.8%) (adds > 692 lines) |
| layering | 0.8% | 14/420 (3.3%) | 16/420 (3.8%) (adds > 692 lines) |
| complexity | 10.0% | 93/420 (22.1%) | 80/420 (19.0%) (adds > 164 lines) |
| reuse | 3.4% | 38/420 (9.0%) | 38/420 (9.0%) (adds > 329 lines) |
| duplication | 6.4% | 59/420 (14.0%) | 49/420 (11.7%) (adds > 215 lines) |
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
## Held-out validation

The frozen config hashes to `e516869b1d3c4259ca9d19612a670ed2f179a3705592ff80bd3628810263847f`. The held-out rows hash to `0f4580b5f5c2f74330ea79af55c4d9c9991f8901b29c99129ce0b7f89c4ae851`, which matches `heldout.sha256`. The grader ran once on the held-out set.

**Catch** means the grader, run on the pull request as the reviewer saw it (merge base to the commented commit), reports a violation it introduced in the commented file. **Near** means within 20 lines of the comment. **Confirmed** means the fix commit also removes a violation of the same detector in that file. **Verified** rows are the held-out fixes that a fresh Opus verifier judged to address the comment fully or partly (240 of 300).

### Catch rate per sub-type

| Sub-type | Verified | Catch | Near | Confirmed | Size baseline, adds > 64 | All isolable | Catch (unverified) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| reuse | 67 | 23/67 (34.3%) | 11/67 (16.4%) | 8/67 (11.9%) | 37/67 (55.2%) | 81 | 30/81 (37.0%) |
| layer | 29 | 10/29 (34.5%) | 5/29 (17.2%) | 6/29 (20.7%) | 13/29 (44.8%) | 39 | 15/39 (38.5%) |
| facade-boundary | 5 | 4/5 (80.0%) | 2/5 (40.0%) | 3/5 (60.0%) | 3/5 (60.0%) | 5 | 4/5 (80.0%) |
| dependency | 5 | 3/5 (60.0%) | 2/5 (40.0%) | 2/5 (40.0%) | 3/5 (60.0%) | 8 | 4/8 (50.0%) |
| duplication | 62 | 24/62 (38.7%) | 7/62 (11.3%) | 12/62 (19.4%) | 31/62 (50.0%) | 79 | 32/79 (40.5%) |
| split-merge | 26 | 5/26 (19.2%) | 3/26 (11.5%) | 3/26 (11.5%) | 11/26 (42.3%) | 31 | 7/31 (22.6%) |
| naming | 16 | 5/16 (31.3%) | 1/16 (6.3%) | 1/16 (6.3%) | 6/16 (37.5%) | 20 | 6/20 (30.0%) |
| other | 30 | 4/30 (13.3%) | 1/30 (3.3%) | 2/30 (6.7%) | 11/30 (36.7%) | 37 | 8/37 (21.6%) |
| all | 240 | 78/240 (32.5%) | 32/240 (13.3%) | 37/240 (15.4%) | 115/240 (47.9%) | 300 | 106/300 (35.3%) |

### Per detector, verified held-out fixes

| Detector | Flags clean files | Catches corrections | Size baseline at the same flag rate |
| --- | --- | --- | --- |
| facade | 0.5% | 10/240 (4.2%) | 7/240 (2.9%) (adds > 485 lines) |
| layering | 2.0% | 7/240 (2.9%) | 21/240 (8.8%) (adds > 285 lines) |
| complexity | 7.8% | 46/240 (19.2%) | 67/240 (27.9%) (adds > 135 lines) |
| reuse | 6.2% | 21/240 (8.8%) | 56/240 (23.3%) (adds > 157 lines) |
| duplication | 5.1% | 20/240 (8.3%) | 43/240 (17.9%) (adds > 181 lines) |

### Baseline: flag any file that adds more than N lines

On the 200 clean held-out pull requests, the grader flags 18.6% of the 791 changed production files (71 of 200 pull requests have at least one flag). The size baseline flags the same share of files at N = 64 lines.

- Grader: catches 78/240 (32.5%) of verified fixes.
- Size baseline, N = 64 (matched on the held-out clean files): 115/240 (47.9%).
- Size baseline, N = 110 (matched on the development clean files, fixed before validation): 79/240 (32.9%).

### False alarms

A seeded sample of 200 held-out pull requests without any correction. The grader flagged 71 of them. Up to 5 flags per pull request (179 in all) went to fresh Opus judges, who saw the flag and the code but not the grade, the weights, or any catch numbers.

- Judged: 179. A real problem: 10. Not a problem: 168. Unsure: 1.
- **False-alarm rate: 94.4%** of decided flags (93.9% counting unsure as not a false alarm).
- Pull requests with at least one flag judged not a problem: 70 of 200.
- facade: 2 judged, 50.0% not a problem.
- complexity: 77 judged, 97.4% not a problem.
- duplication: 52 judged, 92.3% not a problem.
- reuse: 33 judged, 97.0% not a problem.
- layering: 15 judged, 85.7% not a problem.

### Old scope index

The product-scope Coherence Index, run on a seeded sample of 40 verified held-out fixes (scope: the product folder of the commented file), fix commit against its parent. It "moves as asked" when the unrounded composite rises by 0.2 or more, the #95 threshold. It could be computed for 36.

- Moved as asked: 5/36 (13.9%). Moved the other way (falls by 0.2 or more): 1/36 (2.8%).
- Grader on the same sample, confirmed catches: 5/40 (12.5%).

### Speed

800 gradings: median 2.27 s, p90 2.97 s, mean 2.18 s per commit range, graded in parallel shards on one machine alongside the scope-index run.
<!-- held-out:end -->

## Limits

- **Size is a strong prior.** Reviewers comment on the files that change most, so "adds more than N lines" is a hard baseline. Every comparison here is at a matched flag rate, never at a free N.
- **File level, not the exact request.** A catch means the grader flags the commented file. It does not mean the flag names what the reviewer asked for. *Near* (within 20 lines) and *confirmed* (the fix removes a violation of the same detector) are the stricter readings.
- **Fix location.** Fixes come from #103's locator, whose precision was 72% on its sample. That is why the headline uses verified fixes only. The verifiers ran with read-only repository access, and their blindness rests on instructions.
- **Judges.** The false-alarm judges saw each flag's own description and the code, but not the grade, the weights, or any catch numbers. A judge that sees the checker's wording can still be swayed by it.
- **Tuning was coarse.** Three configurations were tried on the development set: the first draft and two clone and complexity variants. The short-cycle search replaced file-level SCCs after the first draft, when PostHog turned out to have SCCs of about 1,000 and 1,900 files. A finer search could fit the development set better. It could also overfit it.
- **Scope index sample.** The old scope index ran on 40 verified held-out fixes, not on all of them, because each run measures a whole product scope twice.
- **Cache location.** The grader writes its fingerprint and lizard caches under the repository's common directory (`uml-pr-review/`), next to the indexer's cache, unless `--cache` names another directory. The evaluation used `benchmark/.cache/grader`.
