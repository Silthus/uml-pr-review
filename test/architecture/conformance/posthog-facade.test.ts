import { describe, expect, test } from "bun:test";
import { checkConformance } from "../../../src/architecture/conformance/index.ts";
import { ArchitectureModel } from "../../../src/architecture/model/index.ts";
import { type ArchitectureSource, architectureOf } from "../../support/architecture.ts";
import { modified, planOf } from "./plan-builder.ts";

const logic = "products/error_tracking/backend/logic";
const facade = "products/error_tracking/backend/facade";
const flagsFacade = "products/feature_flags/backend/facade";
const flagsModels = "products/feature_flags/backend/models";
const issues = `${logic}/issues.py`;

const baseSource: ArchitectureSource = {
  [`${facade}/api.py`]: [issues],
  [issues]: [`${logic}/fingerprint.py`],
  [`${logic}/fingerprint.py`]: [],
  [`${flagsFacade}/api.py`]: [`${flagsModels}/feature_flag.py`],
  [`${flagsModels}/feature_flag.py`]: [],
};

const plan = planOf({
  modules: [
    { path: facade, action: "modify" },
    { path: logic, action: "modify" },
  ],
  seams: [{ from: logic, to: flagsFacade, action: "add", interface: { files: [`${flagsFacade}/api.py`] } }],
});

function checkWithIssuesImporting(target: string) {
  const head = architectureOf({ ...baseSource, [issues]: [`${logic}/fingerprint.py`, { to: target, line: 3, names: ["FeatureFlag"] }] });
  return checkConformance({
    plan,
    base: new ArchitectureModel(architectureOf(baseSource)),
    head: new ArchitectureModel(head),
    changes: [modified(issues, 3)],
    phase: "progress",
  });
}

describe("PostHog: error tracking logic reaching feature flags", () => {
  test("an import of the feature flag models from the logic is one bypass of the facade seam", () => {
    const { findings } = checkWithIssuesImporting(`${flagsModels}/feature_flag.py`);

    expect(findings.filter(({ severity }) => severity === "violation")).toEqual([
      {
        id: `bypasses-seam|${issues}|3|${flagsModels}/feature_flag.py`,
        rule: "bypasses-seam",
        severity: "violation",
        file: issues,
        line: 3,
        subject: { kind: "seam", from: logic, to: flagsFacade },
        target: `${flagsModels}/feature_flag.py`,
        test: false,
        message: `${issues}:3 imports \`${flagsModels}/feature_flag.py\` from \`${flagsModels}\` directly, but the plan routes \`${logic}\` to \`products/feature_flags\` through \`${flagsFacade}\`.`,
        fix: `Import it through \`${flagsFacade}/api.py\` instead. If that interface does not offer it yet, add it there first.`,
      },
    ]);
  });

  test("routing the same import through the facade leaves no violation", () => {
    const report = checkWithIssuesImporting(`${flagsFacade}/api.py`);

    expect(report.counts.violations).toBe(0);
    expect(report.seams).toEqual([{ from: logic, to: flagsFacade, action: "add", status: "conforming", imports: 1 }]);
  });
});
