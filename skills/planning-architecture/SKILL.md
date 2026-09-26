---
name: planning-architecture
description: Architecture plans through the uml-pr-review MCP tools: modules, seams, interfaces, lock, and check_plan conformance. Use when asked to plan or design a change before building it, when a change adds a dependency between modules, or when a plan already exists for the work.
---

An **architecture plan** names every module a change touches and every **seam** it adds, keeps, or removes. A seam is a dependency from one module to another, and it runs through an **interface**: the files and symbols the dependent side may import. The human watches the plan appear in the explorer, steers it, and locks it. After that, the plan is the contract the code must meet.

The `uml-pr-review` MCP tools do the work. Follow the `next` field of each result.

## 1. Map the ground

Start with `get_architecture_overview`. Then use `search_modules` and `describe_module` to find where the change belongs. For each module you might depend on, call `get_dependency_evidence` to see how existing callers reach it.

Done when you can name every module the change touches, and, for each dependency you add, the target's **interface**: its facade, public API, or contracts file. Name the interface even where some existing callers import past it.

## 2. Draft the plan

Call `create_plan`. Its goal states the problem and your approach in plain words.

In one `edit_plan` batch:
- Add each module with its action (`create`, `modify`, or `remove`) and a one-sentence responsibility: what changes there.
- Add each seam with its action, its interface (files, plus symbols once you know them), and a rationale: why this dependency, and why through this interface.

Route every new dependency through the target's **interface**. When the interface lacks what you need, plan a `modify` of the target module that adds it. Resolve every `edit_plan` warning before moving on.

Done when every file you expect to edit lies within a planned module, and every new cross-module import has a planned seam through an interface.

## 3. Review with the human

Give the human the `explorerUrl` and a short summary of the plan.

If the human already gave standing approval to lock ("plan it, lock it, and build it"), lock now. Otherwise stop and wait.

When they reply:
- Read the plan with `get_plan`.
- Answer every pending human comment with `resolve_comment` and a reply, and apply what it asks.
- Build on every edit listed in `humanChanges`, and keep it in each later `edit_plan`.

Lock with `set_plan_lock` only on the human's explicit word, quoting it in `humanRequest`.

Done when the plan is locked.

## 4. Build against the plan

Implement in slices. After each slice, run `check_plan`:
- Fix every violation exactly as its `fix` says.
- Treat `pending` findings as your remaining work list.

When a finding shows the plan itself is wrong:
- Use `add_comment` on that module or seam to name the change.
- Ask the human to unlock the plan.

The plan changes first; the code follows.

Done when a progress check reports 0 violations and 0 pending.

## 5. Prove it

Run `check_plan` with `final: true`.

Done when the verdict is `conforming`. Report the verdict to the human, and each remaining warning with its `file:line`.
