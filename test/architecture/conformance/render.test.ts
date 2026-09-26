import { describe, expect, test } from "bun:test";
import type { ConformanceReport, ConformanceResult, Finding } from "../../../src/architecture/contracts/index.ts";
import { checkConformance, renderConformanceText } from "../../../src/architecture/conformance/index.ts";
import { ArchitectureModel } from "../../../src/architecture/model/index.ts";
import { architectureOf } from "../../support/architecture.ts";
import { modified, planOf } from "./plan-builder.ts";

const logic = "products/error_tracking/backend/logic";
const flagsFacade = "products/feature_flags/backend/facade";
const issues = `${logic}/issues.py`;
const featureFlag = "products/feature_flags/backend/models/feature_flag.py";

function resultOf(report: ConformanceReport, overrides: Partial<ConformanceResult> = {}): ConformanceResult {
  return {
    ...report,
    planId: "feature-flags-on-issues-3f2a",
    planRevision: 4,
    planStatus: "locked",
    phase: "progress",
    worktree: "/tmp/posthog-proof",
    baseCommit: "3f2a9c1d".padEnd(40, "0"),
    snapshotTree: "9b8e7d6c".padEnd(40, "0"),
    checkedAt: "2026-09-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("renderConformanceText", () => {
  test("renders the header, the draft note, and every finding with its fix", () => {
    const report = checkConformance({
      plan: planOf({ status: "draft", modules: [{ path: logic, action: "modify" }], seams: [{ from: logic, to: flagsFacade, action: "add", interface: { files: [`${flagsFacade}/api.py`] } }] }),
      base: new ArchitectureModel(architectureOf({ [issues]: [], [featureFlag]: [], [`${flagsFacade}/api.py`]: [featureFlag] })),
      head: new ArchitectureModel(architectureOf({ [issues]: [{ to: featureFlag, line: 3 }], [`${flagsFacade}/api.py`]: [featureFlag] })),
      changes: [modified(issues, 3)],
      phase: "progress",
    });

    expect(renderConformanceText(resultOf(report, { planStatus: "draft" }))).toBe(
      [
        "Plan feature-flags-on-issues-3f2a revision 4 (draft), progress check of /tmp/posthog-proof at snapshot 9b8e7d6 against base 3f2a9c1: violating.",
        "1 violation, 1 pending, 0 warnings.",
        "The plan is a draft. Ask the human to lock it before you implement.",
        "",
        `violation bypasses-seam ${issues}:3`,
        `  ${issues}:3 imports \`${featureFlag}\` from \`products/feature_flags/backend/models\` directly, but the plan routes \`${logic}\` to \`products/feature_flags\` through \`${flagsFacade}\`.`,
        `  Fix: Import it through \`${flagsFacade}/api.py\` instead. If that interface does not offer it yet, add it there first.`,
        `pending missing-seam ${issues}:4`,
        `  No file in \`${logic}\` imports \`${flagsFacade}/api.py\` yet; the plan adds seam \`${logic}\` -> \`${flagsFacade}\`.`,
        `  Fix: Import \`${flagsFacade}/api.py\` where \`${logic}\` needs it, for example in \`${issues}\`.`,
      ].join("\n"),
    );
  });

  test("renders a conforming locked final check as its header alone", () => {
    const report: ConformanceReport = { verdict: "conforming", modules: [], seams: [], findings: [], counts: { violations: 0, pending: 0, warnings: 0 } };

    expect(renderConformanceText(resultOf(report, { phase: "final" }))).toBe(
      [
        "Plan feature-flags-on-issues-3f2a revision 4 (locked), final check of /tmp/posthog-proof at snapshot 9b8e7d6 against base 3f2a9c1: conforming.",
        "0 violations, 0 pending, 0 warnings.",
      ].join("\n"),
    );
  });

  test.each([
    { total: 41, overflow: "1 more finding is in structuredContent.findings." },
    { total: 42, overflow: "2 more findings are in structuredContent.findings." },
  ])("shows the first 40 of $total findings and points to the rest", ({ total, overflow }) => {
    const findings = Array.from({ length: total }, (_, index): Finding => warningAt(`posthog/api/view_${String(index).padStart(2, "0")}.py`));
    const report: ConformanceReport = { verdict: "conforming", modules: [], seams: [], findings, counts: { violations: 0, pending: 0, warnings: total } };

    const lines = renderConformanceText(resultOf(report)).split("\n");

    expect(lines[1]).toBe(`0 violations, 0 pending, ${total} warnings.`);
    expect(lines.filter((line) => line.startsWith("warning "))).toHaveLength(40);
    expect(lines.slice(-4)).toEqual([
      "warning unresolved-import posthog/api/view_39.py:2",
      "  posthog/api/view_39.py:2 imports `posthog.gone`, which resolves to no file in the repository and no dependency.",
      "  Fix: Fix the specifier, or create the file it names.",
      overflow,
    ]);
  });
});

function warningAt(file: string): Finding {
  return {
    id: `unresolved-import|${file}|2|posthog.gone`,
    rule: "unresolved-import",
    severity: "warning",
    file,
    line: 2,
    subject: { kind: "module", path: "posthog/api" },
    target: "posthog.gone",
    test: false,
    message: `${file}:2 imports \`posthog.gone\`, which resolves to no file in the repository and no dependency.`,
    fix: "Fix the specifier, or create the file it names.",
  };
}
