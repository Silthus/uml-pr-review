---
name: planning-architecture
description: Plan a change's architecture before writing code with the uml-pr-review MCP tools (modules, seams, interfaces), let the human steer and lock it in the explorer, then build against the locked plan and prove conformance with check_plan. Use when asked to plan or design a change's architecture, when a feature spans more than one module, or when an architecture plan already exists for the work.
---

An **architecture plan** names every module a change touches and every **seam** it adds, keeps, or removes. A seam is a dependency from one module to another, and it runs through an **interface**: the files and symbols the dependent side may import. The human watches the plan appear in the explorer, steers it, and locks it. After that, the plan is the contract the code must meet.

The `uml-pr-review` MCP tools do the work. Pass your working directory as `worktree` on every call, and follow the `next` field of each result.

## 1. Map the ground

Start with `get_architecture_overview`. Then use `search_modules` and `describe_module` to find where the change belongs. For each module you might depend on, call `get_dependency_evidence` to see how its existing callers reach it.

Done when you can name:
- every module the change touches;
- for each dependency you add, the interface its existing callers already use. This is usually a facade, public API, or contracts file.

## 2. Draft the plan

Call `create_plan`. Its goal states the problem and your approach in plain words.

In one `edit_plan` batch:
- Add each module with its action (`create`, `modify`, or `remove`) and a one-sentence responsibility: what changes there.
- Add each seam with its action, its interface (files, plus symbols once you know them), and a rationale: why this dependency, and why through this interface.

Route every new dependency through the target's interface. When the interface lacks what you need, plan the addition to the interface (a `modify` of that module) instead of reaching past it into models or internals.

Done when every file you expect to edit lies within a planned module, and every new cross-module import has a planned seam through an interface.

## 3. Review with the human

Give the human the explorer URL from the result and a short summary of the plan. Then stop and wait.

When they reply:
- Read the plan with `get_plan`.
- Answer every pending human comment with `resolve_comment` and a reply, and apply what it asks.
- Accept the edits the human made.

Lock the plan with `set_plan_lock` only on the human's explicit word, quoting it in `humanRequest`. Standing approval given up front ("plan it, lock it, and build it") counts as that word.

Done when the plan is locked.

## 4. Build against the plan

Implement in slices. After each slice, run `check_plan`:
- Fix every violation exactly as its `fix` says.
- Treat `pending` findings as your remaining work list.

When a finding shows the plan itself is wrong, tell the human which module or seam must change and ask them to unlock the plan. The plan changes first; the code follows.

## 5. Prove it

Run `check_plan` with `final: true`.

Done when the verdict is `conforming`. Report the verdict and any accepted warnings to the human.
