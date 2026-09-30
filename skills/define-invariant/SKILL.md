---
name: define-invariant
description: One conversation that declares a component's first Coherence invariants, wires the linter that enforces them, and proves each one. Run once per product area.
argument-hint: <component folder>
disable-model-invocation: true
---

You **grill** the engineer, once, until the **invariants** of one component folder are declared. The result is a `<Name>.spec.md` bullet per invariant, the lint entry that enforces it, and a witnessed **refutation**. Later changes go through PR review, never through this skill again.

Speak Coherence's lexicon: **invariant**, **chokepoint** (`protects:` + `chokepoint:`), **totality oracle** (`over:` + `via:`), **enforcement**, **enforcer**, **refutation**, **listed residual**.

## The conversation

The engineer's time is the scarce thing. Find every fact yourself (read files, run commands, grep); ask only for a **decision**. Ask exactly **one** question per message, then stop and wait:

```
**Q<n>: <title>**
<the context the engineer needs, at most five lines; a Mermaid diagram when a shape is clearer drawn>

**Recommendation:** <your answer and its reason in one line>
```

When the engineer accepts, move on without restating it.

## Coherence

Run Coherence from the PostHog worktree root. Write `coherence` below as `node $COHERENCE_HOME/src/cli.ts` when `COHERENCE_HOME` is set; otherwise use the `coherence` binary. `coherence.config.json` at the root names the language and the `lint` tools.

## 1. Scope

The argument is the component folder. Read, without asking:

- the `*.spec.md` files in and above the folder, and `coherence.config.json`;
- every **enforcer** that covers the folder, per [`enforcers.md`](enforcers.md): `tach.toml`, the import-linter contracts, the oxlint configs, and the ruff configs.

Then send one message: what the folder is (its main modules and its import edges in and out, as a Mermaid diagram when that helps), each enforcer that covers it and what that enforcer owns, and your first question.

Done when you can name every enforcer that covers the folder and what it owns.

## 2. Evidence

This skill's repository holds the corrections reviewers made. Its root is two folders above this skill's base directory:

```sh
jq -c 'select(.path | startswith("<folder>"))' <repo>/docs/lintability/labels.jsonl      # catchable, ruleKind, ruleSketch, quote
jq -c 'select(.path | startswith("<folder>"))' <repo>/docs/corrections/corpus.jsonl
jq -r '.rules[] | "\(.id): \(.statement)"' <repo>/docs/harvest/<product>/rules.json        # when present
```

Widen `<folder>` to the product when the folder itself has none. A correction backs a rule only when it asks for that rule, not merely for a nearby change.

The code's shape is a **lead**, never backing: a module that exactly one other module imports today may be a door or an accident. Ask the engineer whether that is a rule and why; it becomes a candidate only when the engineer states the rule and its reason.

Done when each candidate is backed by a correction, a harvested rule, or the engineer's own statement of the rule.

## 3. Candidates

Put each candidate to the engineer as its own question: the sentence, its `because`, its form, and its backing. The engineer accepts, edits, or drops it. Pick the form:

| The rule | Form | Enforcer |
|---|---|---|
| A project module has one door: only the chokepoint module imports it | chokepoint, module form: `protects: <file>`, `chokepoint: <file>` | TypeScript: `coherence/chokepoint` in oxlint. Python: import-linter or Pyright, credited as they stand |
| A scoped ban ("code under X never imports Y") or a paved path over an external API ("use Y, not X") | lint totality oracle: `over:` + `via: lint <tool>:<rule> matching "<text>"` | oxlint `no-restricted-imports`, or ruff `TID251` |

A rule an enforcer already owns (a tach dependency or interface, an import-linter layer) is out: a bullet that restates it is a second declaration. A Python chokepoint that an existing import-linter or Pyright rule credits is in: the bullet adds the reason and the refutation, and the enforcer stays as it is.

Done when every candidate is accepted, edited, or dropped. Zero accepted is a valid outcome; go to the close.

## 4. Current violations

For each accepted candidate, find the code that breaks it today: for a chokepoint, the importers of the protected module other than its chokepoint; for a totality oracle, the linter's findings with a draft of its lint entry in place. List them. Recommend:

- **fix now** when the list is short and each fix is mechanical; make the fixes in the worktree;
- otherwise, for a totality oracle, a **listed residual**: the files go in the lint config's exclusion, and `over:` names the same files. A chokepoint has no residual; fix the importers or drop the candidate.

Done when each candidate has zero violations or a listed residual the engineer accepted.

## 5. Write

For each accepted candidate:

1. `coherence scaffold component <folder> "<intent>"` when the folder has no spec yet;
2. `coherence scaffold invariant <folder> "<sentence>" --name "<name>" --kinds <kinds|none> --chokepoint|--totality-oracle --write`;
3. fill every `<placeholder>` slot of the bullet, and answer each `checklist:` line the scaffold printed;
4. write the lint entry, per [`enforcers.md`](enforcers.md). Its message names the invariant and its spec file.

Done when `coherence spec --check` lists each bullet with 0 unfilled placeholders and 0 problems.

## 6. Prove

- **Chokepoint:** `coherence run --invariant "<name>"`. It refutes automatically and prints the grade, `checker-choked` where an enforcer is credited. Then witness the credited enforcer itself: stage a file outside the chokepoint that imports the protected module, and see the enforcer fire on it (for TypeScript, `coherence(chokepoint)` from the oxlint command in `coherence.config.json`); delete the file and see it clean. When the credited enforcer stays silent, say so in the bullet's `because`: the grade overstates, and Coherence's own check is what enforces it.
- **Lint totality oracle:** stage a file that breaks the rule, run `coherence refute "<folder>/<name>" --broke "<what you staged>"`, delete the file, then run `coherence run --invariant "<name>"`.

Write what you broke and what you saw into the bullet's `refuted:` line, then run `coherence spec --check` and `coherence run --status`.

When a bullet stays a **requirement** because Coherence could not run its refutation (`not run`, a reason about the instrument rather than the code), quote the reason to the engineer and ask one question: keep the bullet as a requirement, or drop it.

Done when each bullet reads as an **invariant**, or the engineer has decided on each requirement.

## 7. Close

Send one summary: a table of each invariant with its form, grade, enforcer, and listed residual; each requirement and the reason it stays one; the files you changed; the time one lint run over the folder takes, with the command from `coherence.config.json`. Tell the engineer to open a PR with those files. Do not commit.

Done when the summary is sent.
