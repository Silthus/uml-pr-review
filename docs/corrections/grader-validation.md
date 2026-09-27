# Rule-violation grader: development tuning and held-out validation

Ticket [#100](https://github.com/Silthus/uml-pr-review/issues/100), part of [#97](https://github.com/Silthus/uml-pr-review/issues/97). Corpus: [`corpus.jsonl`](corpus.jsonl) from #103.

```sh
bun benchmark/grader/grade.ts --repo ~/dev/posthog --commit <sha> [--base <sha>] [--json]
```

The grader scores one commit, or a range, by the architecture violations it introduces or removes, across the whole repository. Each detector computes its violations over the changed files before and after, matches them by rule, file, and subject, and reports what was introduced and removed, with `file:line` evidence. The grade is the weighted sum of introduced minus removed violations.

## Verdict

**On the held-out set, the grader does not beat the trivial size baseline, and most of what it flags is not a problem.**

All numbers count comments on production files only, because the grader cannot flag anything else.

- **Catch.** On the 230 verified held-out fixes, the grader flags the commented file for 78 (33.9%). It flags 18.6% of the changed production files in 198 clean held-out pull requests.
  - "Flag any file that adds more than 64 lines" flags the same share and catches 109 (47.4%).
  - The development-matched cut, more than 110 lines, flags only 9.9% of those files and still catches 74.
  - Across all 286 isolable fixes, verified or not, the grader catches 106 (37.1%).
- **Only facade beats size.** Facade bypasses catch 10 of 230 at a 0.5% flag rate, where size catches 7. Complexity, reuse, duplication, and layering each fall below size at their own flag rates.
- **False alarms.** Blind Opus judges called 168 of 178 decided flags on clean held-out pull requests not a problem, a **94% false-alarm rate**. Complexity crossings and name twins are almost all conventional or harmless. The 10 real finds include copied experiment components, a component effect that duplicates kea state, and a new cross-product import past a facade.
- **Development against held-out.** On the development set, the same frozen grader beat size: 156 of 374 (41.7%) against 121 (32.4%) at a 16.9% flag rate. That edge did not survive the time split.
  - Size is a much stronger prior on the held-out set: the matched cut drops from 110 to 64 lines and catches 47% instead of 32%.
  - The eight configurations tried on the development set (six complete, two stopped early) also fit it somewhat.
- **Old signals.** On 40 verified held-out fixes, read on the fix commit:
  - the scope index moved as asked on 5 of 36 and the wrong way on 1;
  - #95's diff-local prototype moved as asked on 7 of 36 and the wrong way on 3;
  - the grader saw the fix remove a violation in the commented file on 6 of 34.
  None of the three is a usable per-PR signal.
- **Speed.** 0.75 s per commit (median 0.75 s, p90 0.79 s) over 100 consecutive `master` commits in one process with warm caches (`evaluate.ts timing`). The first commit, which builds the fingerprint and symbol indexes, took 2.6 s. A 3,000-commit trend for #101 takes about 40 minutes on one process.
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
- the watched-models allowance and its instance-free shapes.

Checkable but not wired into this grader: new product dependencies that `tach.toml` does not declare. `boundaryHygiene` in `benchmark/lib/boundary.ts` already computes them from the same index. This is a follow-up.

Facade stays on thin evidence. On the development set it catches 0 of 8 facade-boundary corrections and 1 of 6 dependency corrections (the per-sub-type table below). It passes the ticket's rule only through that one correction. It also beats the size baseline at its own flag rate on both sets, and it is the most precise detector the judges saw.

The weights (facade 5, layering 3, complexity 2, reuse 2, duplication 1) set the scale of the grade for the #101 trend. They were set by hand from each detector's development lift, rounded and capped, not fitted. No number in this report depends on them: a catch or a flag is any introduced violation from an enabled detector.

Dropped. The code stays, off by default:
- **cycles** (an import from a changed file that closes an import cycle). It caught none of the development dependency or facade-boundary corrections in any form I tried, so it is dropped under the ticket's rule.
  - As strongly connected components, PostHog has components of about 1,000 and 1,900 files, so "on a cycle" means "inside the tangle".
  - As cycles of at most 4 files, counting function-local imports, it flags 2.8% of clean files for 2.4% catches. Django code uses function-local imports on purpose to break cycles.
  - Without them, cycles of at most 4 files catch nothing at all.
  - Cycles of at most 8 files catch 11 of 420 verified fixes at a 1.1% flag rate. The size baseline at that rate catches 18.
  - With function-local imports counted, the search finds #95's cycle: `df69d9b` removes it. Without them, the frozen setting, it does not, because that cycle runs through function-local imports in `hog_flow.py`.
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
- **False alarms.** The seeded 200 held-out pull requests without corrections were graded: 198, because two merge commits are missing from the local clone. Up to 5 flags per pull request went to fresh Opus judges, blind to the grader. The exact prompts are in [`prompts.md`](../../benchmark/grader/prompts.md).

Reproduce:

```sh
bun benchmark/grader/verification.ts --posthog ~/dev/posthog --split development   # verification packets; labels by Opus sub-agents
bun benchmark/grader/evaluate.ts grade --split development --posthog ~/dev/posthog --shard 0/4   # and 1/4, 2/4, 3/4
bun benchmark/grader/evaluate.ts report --split development --posthog ~/dev/posthog
bun benchmark/grader/evaluate.ts grade --split heldout --posthog ~/dev/posthog --shard 0/4        # refuses unless the config and grader sources match frozen.json
bun benchmark/grader/evaluate.ts false-alarms --split heldout --posthog ~/dev/posthog             # judge packets; labels by Opus sub-agents
bun benchmark/grader/evaluate.ts scope --split heldout --posthog ~/dev/posthog
bun benchmark/grader/evaluate.ts validate --split heldout --posthog ~/dev/posthog
bun benchmark/grader/evaluate.ts timing --posthog ~/dev/posthog --commits 100
```

## Development set (tuning)

The frozen config on the development set:

<!-- development:start -->
374 verified development fixes on production files (59 comments on other files left out), against 198 clean development pull requests.

| Detector | Flags clean files | Catches corrections | Size baseline at the same flag rate |
| --- | --- | --- | --- |
| facade | 0.8% | 23/374 (6.1%) | 16/374 (4.3%) (adds > 692 lines) |
| layering | 0.8% | 14/374 (3.7%) | 16/374 (4.3%) (adds > 692 lines) |
| complexity | 10.0% | 93/374 (24.9%) | 73/374 (19.5%) (adds > 164 lines) |
| reuse | 3.4% | 38/374 (10.2%) | 37/374 (9.9%) (adds > 329 lines) |
| duplication | 6.4% | 59/374 (15.8%) | 44/374 (11.8%) (adds > 215 lines) |

Catches per sub-type, which the keep-or-drop rule reads:

| Detector | reuse | layer | facade-boundary | dependency | duplication | split-merge | naming | other | all |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| facade | 5/102 | 3/68 | 0/7 | 1/5 | 5/86 | 2/30 | 2/31 | 5/45 | 23/374 |
| layering | 3/102 | 5/68 | 1/7 | 0/5 | 1/86 | 2/30 | 0/31 | 2/45 | 14/374 |
| complexity | 25/102 | 17/68 | 5/7 | 1/5 | 24/86 | 12/30 | 5/31 | 4/45 | 93/374 |
| reuse | 11/102 | 5/68 | 0/7 | 0/5 | 12/86 | 3/30 | 2/31 | 5/45 | 38/374 |
| duplication | 9/102 | 9/68 | 0/7 | 2/5 | 26/86 | 3/30 | 3/31 | 7/45 | 59/374 |
<!-- development:end -->

Every configuration tried, on the 420 verified development fixes and the same 200 clean development pull requests. A flag counts from any enabled detector. These tuning runs counted comments on every file. The frozen tables above and in the held-out section count comments on production files only, on both sides of the comparison, because the grader cannot flag anything else.

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

The frozen config hashes to `e516869b1d3c4259ca9d19612a670ed2f179a3705592ff80bd3628810263847f` and the grader sources with it to `55ddee253e0b42fd262521ddc4d94d72cc57f26ff9524a80124401be7d46228c` (`frozen.json`). The held-out rows hash to `0f4580b5f5c2f74330ea79af55c4d9c9991f8901b29c99129ce0b7f89c4ae851`, which matches `heldout.sha256`. The grader ran once on the held-out set.

**Catch** means the grader, run on the pull request as the reviewer saw it (merge base to the commented commit), reports a violation it introduced in the commented file. **Near** means within 20 lines of the comment. **Confirmed** means the fix commit also removes a violation of the same detector in that file. Only comments on production files count, on both sides of every comparison, because the grader cannot flag anything else (14 held-out comments on other files are left out). **Verified** rows are the fixes that a fresh Opus verifier judged to address the comment fully or partly (230 of 286).

### Catch rate per sub-type

| Sub-type | Verified | Catch | Near | Confirmed | Size baseline, adds > 64 | All isolable, verified or not | Catch |
| --- | --- | --- | --- | --- | --- | --- | --- |
| reuse | 64 | 23/64 (35.9%) | 11/64 (17.2%) | 8/64 (12.5%) | 35/64 (54.7%) | 78 | 30/78 (38.5%) |
| layer | 27 | 10/27 (37.0%) | 5/27 (18.5%) | 6/27 (22.2%) | 12/27 (44.4%) | 37 | 15/37 (40.5%) |
| facade-boundary | 5 | 4/5 (80.0%) | 2/5 (40.0%) | 3/5 (60.0%) | 3/5 (60.0%) | 5 | 4/5 (80.0%) |
| dependency | 4 | 3/4 (75.0%) | 2/4 (50.0%) | 2/4 (50.0%) | 2/4 (50.0%) | 6 | 4/6 (66.7%) |
| duplication | 60 | 24/60 (40.0%) | 7/60 (11.7%) | 12/60 (20.0%) | 29/60 (48.3%) | 75 | 32/75 (42.7%) |
| split-merge | 26 | 5/26 (19.2%) | 3/26 (11.5%) | 3/26 (11.5%) | 11/26 (42.3%) | 31 | 7/31 (22.6%) |
| naming | 15 | 5/15 (33.3%) | 1/15 (6.7%) | 1/15 (6.7%) | 6/15 (40.0%) | 18 | 6/18 (33.3%) |
| other | 29 | 4/29 (13.8%) | 1/29 (3.4%) | 2/29 (6.9%) | 11/29 (37.9%) | 36 | 8/36 (22.2%) |
| all | 230 | 78/230 (33.9%) | 32/230 (13.9%) | 37/230 (16.1%) | 109/230 (47.4%) | 286 | 106/286 (37.1%) |

### Per detector, verified held-out fixes

| Detector | Flags clean files | Catches corrections | Size baseline at the same flag rate |
| --- | --- | --- | --- |
| facade | 0.5% | 10/230 (4.3%) | 7/230 (3.0%) (adds > 485 lines) |
| layering | 2.0% | 7/230 (3.0%) | 20/230 (8.7%) (adds > 285 lines) |
| complexity | 7.8% | 46/230 (20.0%) | 63/230 (27.4%) (adds > 135 lines) |
| reuse | 6.2% | 21/230 (9.1%) | 52/230 (22.6%) (adds > 157 lines) |
| duplication | 5.1% | 20/230 (8.7%) | 40/230 (17.4%) (adds > 181 lines) |

| Detector | reuse | layer | facade-boundary | dependency | duplication | split-merge | naming | other | all |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| facade | 1/64 | 0/27 | 1/5 | 3/4 | 4/60 | 1/26 | 0/15 | 0/29 | 10/230 |
| layering | 2/64 | 2/27 | 1/5 | 0/4 | 1/60 | 0/26 | 0/15 | 1/29 | 7/230 |
| complexity | 9/64 | 7/27 | 2/5 | 1/4 | 19/60 | 4/26 | 4/15 | 0/29 | 46/230 |
| reuse | 10/64 | 1/27 | 0/5 | 0/4 | 6/60 | 1/26 | 2/15 | 1/29 | 21/230 |
| duplication | 8/64 | 2/27 | 1/5 | 0/4 | 5/60 | 0/26 | 1/15 | 3/29 | 20/230 |

### Baseline: flag any file that adds more than N lines

On the 198 graded clean held-out pull requests, the grader flags 18.6% of the 791 changed production files (71 pull requests have at least one flag). The size baseline flags the same share of files at N = 64 lines.

- Grader: catches 78/230 (33.9%) of verified fixes.
- Size baseline, N = 64 (matched on the held-out clean files): 109/230 (47.4%).
- Size baseline, N = 110 (matched on the development clean files, fixed before validation; it flags 9.9% of held-out clean files): 74/230 (32.2%).

### False alarms

A seeded sample of 200 held-out pull requests without any correction; 2 merge commits are missing from the local clone, so 198 were graded. The grader flagged 71 of them. Up to 5 flags per pull request (179 in all) went to fresh Opus judges, who saw the flag and the code but not the grade, the weights, or any catch numbers.

- Judged: 179. A real problem: 10. Not a problem: 168. Unsure: 1.
- **False-alarm rate: 94.4%** of decided flags (93.9% counting unsure as not a false alarm).
- Pull requests with at least one flag judged not a problem: 70 of 198.
- facade: 2 judged, 50.0% not a problem.
- complexity: 77 judged, 97.4% not a problem.
- duplication: 52 judged, 92.3% not a problem.
- reuse: 33 judged, 97.0% not a problem.
- layering: 15 judged, 85.7% not a problem.

### Old scope index and #95's diff-local prototype

A seeded sample of 40 verified held-out fixes. Each signal is read on the fix commit against its parent, and asks whether the fix moves it the way the reviewer asked. Scope: the product folder of the commented file.

| Signal | Fixes it could score | Moved as asked | Moved the other way |
| --- | --- | --- | --- |
| Scope composite, unrounded, change of 0.2 or more (the #95 threshold) | 36 | 5/36 (13.9%) | 1/36 (2.8%) |
| #95 diff-local prototype, score not 0 | 36 | 7/36 (19.4%) | 3/36 (8.3%) |
| Grader: the fix removes a violation in the commented file (production files only) | 34 | 6/34 (17.6%) | n/a |

### Speed during the held-out run

770 gradings: median 2.29 s, p90 2.98 s per commit range, with six shards and the scope-index run sharing one machine. For one process on consecutive commits, see `evaluate.ts timing` in the verdict.
<!-- held-out:end -->

## Limits

- **Size is a strong prior.** Reviewers comment on the files that change most, so "adds more than N lines" is a hard baseline. Every comparison here is at a matched flag rate, never at a free N.
- **File level, not the exact request.** A catch means the grader flags the commented file. It does not mean the flag names what the reviewer asked for. *Near* (within 20 lines) and *confirmed* (the fix removes a violation of the same detector) are the stricter readings.
- **Fix location.** Fixes come from #103's locator, whose precision was 72% on its sample. That is why the headline uses verified fixes only. The verifiers ran with read-only repository access, and their blindness rests on instructions.
- **Judges.** The false-alarm judges saw each flag's own description and the code, but not the grade, the weights, or any catch numbers. A judge that sees the checker's wording can still be swayed by it.
- **Tuning was coarse, and it fit the development set.** Eight configurations were tried: six ran to completion (the table above) and two were stopped early. The short-cycle search replaced file-level SCCs after the first draft, when PostHog turned out to have SCCs of about 1,000 and 1,900 files. The development-to-held-out drop shows some of the fit did not generalise.
- **Store keys during tuning.** Grades are stored under a digest of the config and the `benchmark/grader` sources.
  - Two tuning variants had their config key renamed mid-run (`maxComponentFiles` to `maxCycleLength`). Their stores were symlinked to the new digests to read them. Nothing else changed in those configs.
  - The held-out grades live in one fresh store written after the freeze.
  - The digest does not cover the indexer, `isTestPath`, `benchmark/lib/boundary.ts`, or the lizard version. They did not change during this work, and lizard is pinned in `coherence/tools.ts`.
- **Known grader defects, left in the frozen grader** (fixing them would change held-out grades after the single run):
  - The touched-function list keys functions by file and name. Python methods of different classes, such as `A.run` and `B.run`, collide there. The CCN and NLOC violations are not affected.
  - The name-twin rule flags `facade/contracts.py` re-declaring a model's name, which the contracts rule requires.
  - Removed clones are reported under the new path of a renamed file, where other detectors use the old one.
  - The dead copy (`C`) branches in the change reader.
  - For some Rust functions, `fmt` among them, lizard's CSV row does not parse into a start line. 20 of about 6,400 stored violations have no line. One of the 179 judged flags was such a line-less complexity flag, and its packet showed the top of the file instead of the function.
- **Judges saw the checker's words.** A judge sees the flag's description. For clones and twins it has to open the other file itself with `git show`, as the prompt says.
- **Scope index sample.** The old scope index ran on 40 verified held-out fixes, not on all of them, because each run measures a whole product scope twice.
- **Cache location.** The grader writes its fingerprint and lizard caches under the repository's common directory (`uml-pr-review/`), next to the indexer's cache, unless `--cache` names another directory. The evaluation used `benchmark/.cache/grader`.
