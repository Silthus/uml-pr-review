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

- **C's composite lead is mostly the process angle.** That angle rewards planning before editing, which is exactly what arm C was told to do. Without it, B and C land within noise: 74.9 against 75.5.
- **Jev scores both arms identically, and Astra differs by 0.6.**
- **No replay in either arm broke a PostHog boundary rule.** The only facade bypass in the benchmark is the original first push of #103523. Opus 5.5 respects boundaries that are written down and enforced (`products/architecture.md`, `tach.toml`), whether or not the tool is present.
- **Consistency is mixed.** C was more consistent on #103533 (file overlap 1.0 against 0.2) and less consistent on #103849 and #103843.
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
- Jev inputs were capped (a 16k-character diff and 12k characters of context per file). No file had to be skipped.
- Transcripts and arm A session traces stay local, not committed. They are large, and the traces contain private session text.
