---
name: coherence-loop
description: Coherence loop iterations that ratchet a product scope toward a coherent architecture, one small verified pull request at a time, with a question inbox for decisions only a human can make. Use when asked to run the coherence loop on a scope, to propose the next coherence pull request, or to continue the loop after coherence:question answers.
---

Each iteration is one notch of a **ratchet**: pick the module where incoherence hurts most, apply the next recipe step as the **smallest change** that completes it, prove the Coherence Index did not slip, and propose it. The runner in `coherence/loop/` does every deterministic part and prints JSON; you do the judgement and the code change. When a runner prints `error`, act on its message.

Run every command from the root of this repository. The request names:

- the target **repository** and **scope**, for example `~/dev/posthog` and `products/workflows`;
- the **budget**, the number of pull requests to propose (default 1);
- the **mode**: dry run by default, or draft;
- whether to **fetch** the base, and which **signals** report to use, if any.

## 1. Sense

Get a signals report. When PostHog MCP tools are available, follow `coherence/signals/export-ci.md` for the scope and save the report to `coherence/signals/reports/<scope name>-ci-<date>.json`. Otherwise use the newest report for the scope in `coherence/signals/reports/`, or none.

Run `bun coherence/loop/sense.ts --repo <repository> --scope <scope> --budget <n>`, adding `--posthog-signals <report>`, `--fetch`, `--runs`, `--active-days`, and `--max-questions` as the request says.

Done when it prints a `sense` path and a ranked `targets` list.

## 2. Choose

Run `bun coherence/loop/choose.ts --sense <sense path>`. It prints one of three actions:

- **`done`**: the budget is spent or no target is left. Go to the report at the end.
- **`ask`**: a boundary decision, which always goes to a human. Read the drafted `question`; sharpen its wording where the evidence supports a clearer framing. Raise it with `bun coherence/inbox.ts raise --iteration <iteration>` (override with `--question`, `--context`, and `--option` flags). Record it with `bun coherence/loop/record.ts --iteration <iteration> --outcome question`, then choose again.
- **`act`**: read the module, its `reason`, and its `evidence`. An `answer` is a human's decision on this target; follow it. Judge your confidence before you touch code. Ask instead when:
  - the module **boundary** is unclear: which files belong to it, or where its entry point should live;
  - the step needs a **name** the team would debate;
  - the **ownership** is unclear: another team's code, or generated or vendored code;
  - the step changes **behaviour** that a test cannot pin.

  To ask, raise the question with your own `--question`, `--context`, and two or more `--option` flags, record the outcome `question`, and choose again.

Done when choose prints `act` for a target you are confident in, or `done`.

## 3. Workspace

Run `bun coherence/loop/workspace.ts --iteration <iteration>`. It creates a scratch worktree of the repository at the sensed base, on the branch `coherence/<scope name>/<slug>`, and lists the `busyFiles` that active pull requests touch.

Done when it prints the workspace `path` and `branch`.

## 4. Act

Apply the recipe step (see Recipe steps) in the workspace as the smallest change that completes it:

- one purpose, at most about 300 changed lines;
- inside the scope, with every busy file left as it is; a facade also re-routes its callers outside the scope;
- in the repository's own conventions: read its `AGENTS.md` or `CLAUDE.md`, the neighbouring code, and the tests next to it.

Commit once, with a subject that says what the change does: `git -C <path> commit`. When a commit hook needs tools the workspace lacks (PostHog's hooks need the flox Python), commit with `--no-verify`, run the formatter and linter the hook would run, and name the skipped hook in the summary.

Done when `git -C <path> status --porcelain` prints nothing and the branch holds your commit.

## 5. Verify

Run `bun coherence/loop/verify.ts --iteration <iteration>`. It checks the diff size, busy files, and the scope. It runs the linters the index uses and the tests that touch or import the changed files, and it measures the index before and after for the touched module.

On `fail`, fix each problem, amend the commit, and verify again. When a problem stays out of reach within this step (the change cannot fit the budget, or a targeted dimension keeps dropping), record `abandoned` with a `--note` naming the problem, and choose again. Tests reported as `not run` stay declared in the pull request; that keeps it **honest**.

Done when the verdict is `pass`, or the iteration is recorded as abandoned.

## 6. Propose

Write a summary file with two sections, which the runner places above the target, evidence, step, verification class, index delta, and checks:

- `## What changed`: the change in two or three sentences, in the reviewer's words;
- `## Review in 2 minutes`: the files to open, in order, and what to check in each.

Run `bun coherence/loop/propose.ts --iteration <iteration> --summary <file>`. Add `--draft` in draft mode only; the runner then pushes the branch and opens a draft pull request. The runner and the inbox are the only paths to GitHub.

Done when it prints the `body` path of `pr.md`, and in draft mode the `pullRequest` URL.

## 7. Record

Run `bun coherence/loop/record.ts --iteration <iteration> --outcome proposed`.

Done when it prints the ledger `entry`. Then return to step 2.

## Report

For each iteration, give the target, step, verification class, and index delta, plus the `pr.md` path, pull request URL, or question URL.

## Recipe steps

The ranking recommends the next step per module, in this order:

- **facade**: give the module one entry point: `backend/facade/` in a PostHog product, or the repository's equivalent. Export what outside callers use, and re-route the bypassing imports that the reason lists. Moves and re-exports only; behaviour stays the same.
- **characterisation-tests**: outside-in tests at the facade or public functions that pin today's behaviour, odd parts included. Assert the observed outputs, and keep the production code as it is. Put the tests where the repository keeps tests for that module.
- **ratchet-rule**: a lint rule, a `tach` boundary, or a custom check that forbids the bypass or smell the reason names. Today's violations go into a baseline file, so the check passes now and fails on every new violation.
- **internal-cleanup**: split and simplify behind the facade, starting with the driver the reason names. Keep the facade's signature and the characterisation tests green.

Every pull request carries a verification class:

- **mechanical**: moves, tests, and baselines, reviewable from the diff alone;
- **behaviour-adjacent**: internals change behind pinned tests;
- **boundary**: what other modules may depend on changes.
