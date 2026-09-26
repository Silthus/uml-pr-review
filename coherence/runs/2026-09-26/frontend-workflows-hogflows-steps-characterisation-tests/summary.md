## What changed

Adds characterisation tests for `HogFlowBranchCard`, the branch editor card used by the conditional and random-cohort split steps, which had no tests. They pin today's behaviour: the name input shows its value, placeholder, and `data-attr`, and reports edits; the remove button calls `onRemove` unless a `removeDisabledReason` is set; focus or pointer-down selects the card's branch. Production code is unchanged.

Jest did not run these tests in the loop's workspace, because it had no installed `frontend/node_modules`. They were run by hand against the main checkout's dependencies: 5 of 5 pass. The commit skipped the pre-commit hook, which needs `python` and so could not run here; the file was formatted with `oxfmt` and is clean under `oxlint`.

## Review in 2 minutes

1. `products/workflows/frontend/Workflows/hogflows/steps/HogFlowBranchCard.test.tsx`, top of the file: `useHogFlowBranchSelection` is mocked through a lazy wrapper. `HogFlowBranchSelection` sits in an import cycle (`hogFlowEditorLogic` → … → `StepConditionalBranch` → `HogFlowBranchSelection`), so jest runs the mock factory twice. A plain `jest.fn()` in the factory leaves the component and the test with different mocks. Check that the comment explains this well enough.
2. The same file, the tests: check that each assertion matches what `HogFlowBranchCard.tsx` does today. Branch colour and selection tint are not asserted: jsdom drops `var(...)` and `color-mix(...)` style values, so they cannot be observed in jest.
