# Findings: does architecture planning change how an agent builds?

Issue #61. The full numbers are in [`report.md`](report.md). This page is the conclusion, written by hand because the generator regenerates that file.

## Setup

Seven of Michael's PostHog PRs were replayed from their original task statements on Claude Opus 5.5. The replays started from the same base commits:
- **B:** Opus with no tools, as the control.
- **C:** Opus with the uml-pr-review MCP server and the `planning-architecture` skill.

Each arm ran twice per task. **A** is the original PR itself.

All 35 diffs were scored on:
- PostHog's own boundary rules;
- static quality (`lizard`, `ruff`);
- tests;
- Jev per-file and per-diff grades;
- a blind Astra 6 comparison;
- intent alignment with the original PR;
- consistency across repeats;
- process.

## Result

| Arm | Architecture | Static | Tests | Jev | Astra | Composite |
|---|---|---|---|---|---|---|
| A (original PRs) | 84.2 | 62.3 | 42.7 | 89.1 | 64.3 | 69.0 |
| B (Opus, no tool) | 96.8 | 67.8 | 31.7 | 86.8 | 83.9 | 73.0 |
| C (Opus + tool + skill) | 96.7 | 69.2 | 36.3 | 86.8 | 84.5 | 76.2 |

**The tool made the agent plan, but it did not measurably make the code better.**

- **C's composite lead is mostly the process angle.** That angle rewards planning before editing, which is exactly what arm C was told to do. Drop Process from every run, rescale the remaining weights (as the report's composite does when an angle is missing), and average per arm: B scores 76.1 and C 77.0 (A 70.5). The lead shrinks from 3.2 to 0.8, within noise.
- **The Jev means match (86.8 each).** Per task they differ in both directions: C is about 3.7 lower on #103533 and higher on #103843. Astra differs by 0.6.
- **No replay in either arm has a penalised boundary bypass.** The only penalised facade bypass in the benchmark is the original first push of #103523. Opus 5.5 respects boundaries that are written down and enforced (`products/architecture.md`, `tach.toml`), whether or not the tool is present. Every #104202 run, replays included, has a test file importing another product's backend. Test imports are exempt from the rule, so these are listed but not scored.
- **Consistency is mixed.** C was more consistent on #103533 (file overlap 1.0 against 0.2), and less consistent on three tasks: #103523 (0.5 against 1.0), #103849, and #103843.
- **Both replay arms beat the originals on the Astra judge.** Don't read that as a tool effect: A is a different model, with a human steering it over many turns.

## Why

- **Import boundaries were already solved by explicit rules.** The tool steered at the planning and review level, which is the weakest place a rule can live. The facade rules the agent kept were enforced in code and CI, the strongest place.
- **The tasks rarely forced an architectural decision.** Most were contained changes. #103523, the one task with a real facade trap, didn't transfer: replaying Michael's first message led every replay to build only the home-screen half, so no replay faced the facade choice.

## What it changed

The follow-up direction is not a planning tool. It is a **ratchet**, in the Coherence project's framing:
- harvest the rules the team enforces by hand;
- move each one up the ladder, from review to documentation to lint with a baseline to structurally impossible;
- measure the codebase with a deterministic index over time, against control products.

That work is map #67.

## Caveats

- There are 7 tasks and 2 repeats per arm, so the samples are small.
- Arm A uses the original model and the original human steering.
- `pytest` did not run: there is no local PostHog Python environment. TypeScript was not type-checked.
- Jev inputs were capped: the per-diff questions saw the first 16k characters of a diff, and each file got 60 lines of context, capped at 12k characters. No file had to be skipped, but the per-diff grade saw only part of 12 of the 35 diffs (29–45% of each #103843 diff).
- All five #103729 diffs are byte-identical, so that task carries no code signal. B and C differ there only on Process.
- `102897/C-2` was cut off by Claude Code's background-task ceiling ("Background tasks still running after 600s; terminating"), although its meta records `completed`.
- Transcripts and arm A session traces stay local, not committed. They are large, and the traces contain private session text. Run snapshots (`runs/*/task.json`) have their local paths, dispatch prompts, and notes removed. The original manifests in `benchmark/tasks/` are unchanged.
