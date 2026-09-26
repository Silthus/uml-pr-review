import { describe, expect, test } from "bun:test";
import type { ArchitecturePlan, ChangedFile, ConformancePhase } from "../../../src/architecture/contracts/index.ts";
import { checkConformance } from "../../../src/architecture/conformance/index.ts";
import { ArchitectureModel } from "../../../src/architecture/model/index.ts";
import { type ArchitectureSource, architectureOf } from "../../support/architecture.ts";
import { added, deleted, modified, planOf } from "./plan-builder.ts";

const errorTracking = "products/error_tracking/backend";
const facade = `${errorTracking}/facade`;
const logic = `${errorTracking}/logic`;
const models = `${errorTracking}/models`;
const legacy = `${errorTracking}/legacy`;
const flagsFacade = "products/feature_flags/backend/facade";
const flagsModels = "products/feature_flags/backend/models";
const issues = `${logic}/issues.py`;
const fingerprint = `${logic}/fingerprint.py`;
const flagsApi = `${flagsFacade}/api.py`;
const featureFlag = `${flagsModels}/feature_flag.py`;
const team = "posthog/models/team.py";
const scenes = "frontend/src/scenes";

const baseSource: ArchitectureSource = {
  [`${facade}/api.py`]: [issues],
  [issues]: [`${models}/issue.py`, fingerprint],
  [fingerprint]: [],
  [`${logic}/tests/test_issues.py`]: [issues],
  [`${models}/issue.py`]: [],
  [`${legacy}/cohorts.py`]: [featureFlag],
  [flagsApi]: [featureFlag],
  [`${flagsFacade}/queries.py`]: [featureFlag],
  [featureFlag]: [],
  [team]: [],
  [`${scenes}/issueLogic.ts`]: [],
};

type CheckCase = { plan: ArchitecturePlan; both?: ArchitectureSource; head?: ArchitectureSource; removed?: string[]; changes: ChangedFile[]; phase?: ConformancePhase };

function check({ plan, both = {}, head = {}, removed = [], changes, phase = "progress" }: CheckCase) {
  const headSource = Object.fromEntries(Object.entries({ ...baseSource, ...both, ...head }).filter(([path]) => !removed.includes(path)));
  return checkConformance({
    plan,
    base: new ArchitectureModel(architectureOf({ ...baseSource, ...both })),
    head: new ArchitectureModel(architectureOf(headSource)),
    changes,
    phase,
  });
}

function findingsOf(checkCase: CheckCase) {
  return check(checkCase).findings.map(({ id: _id, ...finding }) => finding);
}

const modifyLogic = { path: logic, action: "modify" } as const;
const issuesImporting = (...imports: ArchitectureSource[string]) => ({ [issues]: [`${models}/issue.py`, fingerprint, ...imports] });

describe("unplanned-module", () => {
  test.each([
    { status: "locked" as const, hint: `ask the human to unlock the plan and add \`${scenes}\` as a modified module` },
    {
      status: "draft" as const,
      hint: `add it to the plan with edit_plan: {"op":"upsert_module","path":"${scenes}","action":"modify","responsibility":"…"}`,
    },
  ])("reports each changed module the $status plan does not touch once, at its first changed file", ({ status, hint }) => {
    const findings = findingsOf({
      plan: planOf({ status, modules: [modifyLogic] }),
      head: { [`${scenes}/issueSelectors.ts`]: [] },
      changes: [modified(issues, 2), added(`${scenes}/issueSelectors.ts`), modified(`${scenes}/issueLogic.ts`, 12)],
    });

    expect(findings).toEqual([
      {
        rule: "unplanned-module",
        severity: "violation",
        file: `${scenes}/issueLogic.ts`,
        line: 12,
        subject: { kind: "module", path: scenes },
        test: false,
        message: `${scenes}/issueLogic.ts:12 changes module \`${scenes}\`, which the plan does not touch (2 changed files there).`,
        fix: `Revert the changes in \`${scenes}\`, or ${hint}.`,
      },
    ]);
  });

  test("names a deleted file as deleted from its module", () => {
    const findings = findingsOf({ plan: planOf({ modules: [modifyLogic] }), removed: [team], changes: [modified(issues), deleted(team)] });

    expect(findings.map(({ message }) => message)).toEqual([
      `${team}:1 deletes a file from module \`posthog/models\`, which the plan does not touch (1 changed file there).`,
    ]);
  });

  test("is a warning when every changed file there is a test, and plans a new module as created", () => {
    const testFile = "posthog/models/test/test_team.py";
    const findings = findingsOf({ plan: planOf({ modules: [modifyLogic] }), head: { [testFile]: [team] }, changes: [modified(issues), added(testFile)] });

    expect(findings).toEqual([
      {
        rule: "unplanned-module",
        severity: "warning",
        file: testFile,
        line: 1,
        subject: { kind: "module", path: "posthog/models/test" },
        test: true,
        message: `${testFile}:1 adds a file to module \`posthog/models/test\`, which the plan does not touch (1 changed file there).`,
        fix: "Revert the changes in `posthog/models/test`, or ask the human to unlock the plan and add `posthog/models/test` as a created module.",
      },
    ]);
  });

  describe("when unchanged files there gain a dependency through configuration", () => {
    const user = "posthog/models/user.py";
    const testUser = "posthog/models/test_user.py";
    const reconfigured = (file: string, line: number, target: string, count: number) =>
      `${file}:${line} in module \`posthog/models\`, which the plan does not touch, now imports \`${target}\`: a new dependency on \`products\` through a configuration change, not a source change (${count} reconfigured import${count === 1 ? "" : "s"} there).`;
    const addModelsHint = "Revert the configuration change behind the import, or ask the human to unlock the plan and add `posthog/models` as a modified module.";

    test("reports the module once, at its first production import", () => {
      const findings = findingsOf({
        plan: planOf({ modules: [modifyLogic] }),
        both: { [testUser]: [team], [user]: [team] },
        head: { [testUser]: [team, { to: featureFlag, line: 2 }], [user]: [team, { to: flagsApi, line: 3 }] },
        changes: [modified(issues)],
      });

      expect(findings).toEqual([
        {
          rule: "unplanned-module",
          severity: "violation",
          file: user,
          line: 3,
          subject: { kind: "module", path: "posthog/models" },
          test: false,
          message: reconfigured(user, 3, flagsApi, 2),
          fix: addModelsHint,
        },
      ]);
    });

    test("is a warning when only test files gain the dependency", () => {
      const findings = findingsOf({
        plan: planOf({ modules: [modifyLogic] }),
        both: { [testUser]: [team] },
        head: { [testUser]: [team, { to: featureFlag, line: 2 }] },
        changes: [modified(issues)],
      });

      expect(findings.map(({ severity, file, line, test, message }) => ({ severity, file, line, test, message }))).toEqual([
        { severity: "warning", file: testUser, line: 2, test: true, message: reconfigured(testUser, 2, featureFlag, 1) },
      ]);
    });

    test("is a violation at the production import even when only test files there changed", () => {
      const findings = findingsOf({
        plan: planOf({ modules: [modifyLogic] }),
        both: { [testUser]: [team], [user]: [team] },
        head: { [user]: [team, { to: flagsApi, line: 3 }] },
        changes: [modified(issues), modified(testUser, 5)],
      });

      expect(findings.map(({ severity, file, line, test, message }) => ({ severity, file, line, test, message }))).toEqual([
        { severity: "violation", file: user, line: 3, test: false, message: reconfigured(user, 3, flagsApi, 1) },
      ]);
    });

    test("stays silent when the import moves to another file of a module it already depends on", () => {
      const findings = findingsOf({
        plan: planOf({ modules: [modifyLogic] }),
        both: { [user]: [featureFlag] },
        head: { [user]: [`${flagsModels}/feature_flag/__init__.py`] },
        changes: [modified(issues)],
      });

      expect(findings).toEqual([]);
    });

    test("leaves an import that now resolves to a file the change adds to the module that gains the file", () => {
      const link = "products/links/link.py";
      const findings = findingsOf({
        plan: planOf({ modules: [modifyLogic] }),
        both: { [user]: [team] },
        head: { [user]: [team, link], [link]: [] },
        changes: [modified(issues), added(link)],
      });

      expect(findings.map(({ rule, file }) => ({ rule, file }))).toEqual([{ rule: "unplanned-module", file: link }]);
    });
  });

  test("stays silent when every changed file is within a planned module", () => {
    expect(findingsOf({ plan: planOf({ modules: [modifyLogic] }), changes: [modified(issues), modified(fingerprint)] })).toEqual([]);
  });

  test("stays silent under a plan that modifies the root", () => {
    expect(findingsOf({ plan: planOf({ modules: [{ path: ".", action: "modify" }] }), changes: [modified(issues), modified(team)] })).toEqual([]);
  });

  test("leaves the imports of a file outside every planned module to this one finding", () => {
    const findings = findingsOf({ plan: planOf({ modules: [modifyLogic] }), head: { [team]: [featureFlag] }, changes: [modified(issues), modified(team)] });

    expect(findings.map(({ rule }) => rule)).toEqual(["unplanned-module"]);
  });
});

describe("unplanned-dependency", () => {
  test.each([
    { status: "locked" as const, hint: `ask the human to unlock the plan and add seam \`${logic}\` -> \`posthog/models\`` },
    { status: "draft" as const, hint: `add it to the plan with edit_plan: {"op":"upsert_seam","from":"${logic}","to":"posthog/models","action":"add"}` },
  ])("reports a new dependency the $status plan does not name at the import", ({ status, hint }) => {
    const findings = findingsOf({
      plan: planOf({ status, modules: [modifyLogic] }),
      head: issuesImporting({ to: team, line: 4, names: ["Team"] }),
      changes: [modified(issues, 4)],
    });

    expect(findings).toEqual([
      {
        rule: "unplanned-dependency",
        severity: "violation",
        file: issues,
        line: 4,
        subject: { kind: "module", path: logic },
        target: team,
        test: false,
        message: `${issues}:4 imports \`${team}\`: a new dependency from \`${logic}\` on \`posthog\` that the plan does not name.`,
        fix: `Remove the import, or ${hint}.`,
      },
    ]);
  });

  test("reports a dependency that a file without source changes gains, as when its import resolves to another file", () => {
    const findings = findingsOf({
      plan: planOf({ modules: [modifyLogic] }),
      both: { [fingerprint]: [`${models}/issue.py`] },
      head: { [fingerprint]: [team] },
      changes: [modified(issues)],
    });

    expect(findings).toEqual([
      {
        rule: "unplanned-dependency",
        severity: "violation",
        file: fingerprint,
        line: 1,
        subject: { kind: "module", path: logic },
        target: team,
        test: false,
        message: `${fingerprint}:1 imports \`${team}\`: a new dependency from \`${logic}\` on \`posthog\` that the plan does not name.`,
        fix: `Remove the import, or ask the human to unlock the plan and add seam \`${logic}\` -> \`posthog/models\`.`,
      },
    ]);
  });

  test("is a warning from a test file", () => {
    const testFile = `${logic}/tests/test_issues.py`;
    const findings = findingsOf({
      plan: planOf({ modules: [modifyLogic] }),
      head: { [testFile]: [issues, { to: team, line: 2 }] },
      changes: [modified(testFile, 2)],
    });

    expect(findings.map(({ rule, severity, file, line, test }) => ({ rule, severity, file, line, test }))).toEqual([
      { rule: "unplanned-dependency", severity: "warning", file: testFile, line: 2, test: true },
    ]);
  });

  test("stays silent for an added import along a dependency the owner already has", () => {
    const findings = findingsOf({ plan: planOf({ modules: [modifyLogic] }), head: { [fingerprint]: [`${models}/issue.py`] }, changes: [modified(fingerprint)] });

    expect(findings).toEqual([]);
  });

  test("stays silent for an import inside the owner", () => {
    const scoring = `${logic}/grouping/scoring.py`;
    const findings = findingsOf({ plan: planOf({ modules: [modifyLogic] }), head: { [fingerprint]: [scoring] }, changes: [modified(fingerprint), added(scoring)] });

    expect(findings).toEqual([]);
  });

  test("asks to move a file that sits directly in a module enclosing the owner, since no seam can name it", () => {
    const utils = `${errorTracking}/utils.py`;
    const findings = findingsOf({ plan: planOf({ modules: [modifyLogic] }), head: issuesImporting({ to: utils, line: 3 }), changes: [modified(issues, 3)] });

    expect(findings.map(({ rule, message, fix }) => ({ rule, message, fix }))).toEqual([
      {
        rule: "unplanned-dependency",
        message: `${issues}:3 imports \`${utils}\`: a new dependency from \`${logic}\` on \`${errorTracking}\` that the plan does not name.`,
        fix: `Remove the import, or move \`${utils}\` into a module of its own so the plan can name the dependency.`,
      },
    ]);
  });

  test("does not count a dependency only tests had as one the production code already has", () => {
    const findings = findingsOf({
      plan: planOf({ modules: [modifyLogic] }),
      both: { [`${logic}/tests/test_issues.py`]: [issues, team] },
      head: issuesImporting({ to: team, line: 3 }),
      changes: [modified(issues, 3)],
    });

    expect(findings.map(({ rule, file }) => ({ rule, file }))).toEqual([{ rule: "unplanned-dependency", file: issues }]);
  });

  test("takes the deepest planned module as the owner", () => {
    const findings = findingsOf({
      plan: planOf({ modules: [{ path: "products/error_tracking", action: "modify" }, modifyLogic] }),
      head: { [fingerprint]: [`${facade}/api.py`] },
      changes: [modified(fingerprint)],
    });

    expect(findings.map(({ rule, subject, message }) => ({ rule, subject, message }))).toEqual([
      {
        rule: "unplanned-dependency",
        subject: { kind: "module", path: logic },
        message: `${fingerprint}:1 imports \`${facade}/api.py\`: a new dependency from \`${logic}\` on \`${facade}\` that the plan does not name.`,
      },
    ]);
  });
});

describe("bypasses-seam", () => {
  test("points at the seam's module when the seam has no interface files", () => {
    const findings = findingsOf({
      plan: planOf({ modules: [modifyLogic], seams: [{ from: logic, to: flagsFacade, action: "add" }] }),
      head: issuesImporting({ to: featureFlag, line: 3 }),
      changes: [modified(issues, 3)],
    });

    expect(findings).toEqual([
      {
        rule: "bypasses-seam",
        severity: "violation",
        file: issues,
        line: 3,
        subject: { kind: "seam", from: logic, to: flagsFacade },
        target: featureFlag,
        test: false,
        message: `${issues}:3 imports \`${featureFlag}\` from \`${flagsModels}\` directly, but the plan routes \`${logic}\` to \`products/feature_flags\` through \`${flagsFacade}\`.`,
        fix: `Import it through the interface \`${flagsFacade}\` instead. If that interface does not offer it yet, add it there first.`,
      },
      {
        rule: "missing-seam",
        severity: "pending",
        file: issues,
        line: 4,
        subject: { kind: "seam", from: logic, to: flagsFacade },
        test: false,
        message: `No file in \`${logic}\` imports the interface \`${flagsFacade}\` yet; the plan adds seam \`${logic}\` -> \`${flagsFacade}\`.`,
        fix: `Import the interface \`${flagsFacade}\` where \`${logic}\` needs it, for example in \`${issues}\`.`,
      },
    ]);
  });

  test("names the seam with the deepest from that routes towards the target", () => {
    const findings = findingsOf({
      plan: planOf({
        modules: [modifyLogic],
        seams: [
          { from: errorTracking, to: flagsFacade, action: "add" },
          { from: logic, to: flagsFacade, action: "add", interface: { files: [flagsApi] } },
        ],
      }),
      head: issuesImporting({ to: featureFlag, line: 3 }),
      changes: [modified(issues, 3)],
    });

    expect(findings.filter(({ severity }) => severity === "violation").map(({ rule, subject, fix }) => ({ rule, subject, fix }))).toEqual([
      {
        rule: "bypasses-seam",
        subject: { kind: "seam", from: logic, to: flagsFacade },
        fix: `Import it through \`${flagsApi}\` instead. If that interface does not offer it yet, add it there first.`,
      },
    ]);
  });

  test("leaves an import from outside the seam's from to unplanned-dependency", () => {
    const findings = findingsOf({
      plan: planOf({ modules: [{ path: facade, action: "modify" }, modifyLogic], seams: [{ from: logic, to: flagsFacade, action: "add" }] }),
      head: { [`${facade}/api.py`]: [issues, { to: featureFlag, line: 2 }] },
      changes: [modified(`${facade}/api.py`, 2), modified(issues)],
    });

    expect(findings.filter(({ severity }) => severity === "violation").map(({ rule, file }) => ({ rule, file }))).toEqual([
      { rule: "unplanned-dependency", file: `${facade}/api.py` },
    ]);
  });
});

describe("off-interface", () => {
  const seamThroughApi = (symbols: string[] = []) => ({ from: logic, to: flagsFacade, action: "add" as const, interface: { files: [flagsApi], symbols } });

  test("reports an import of a file outside the interface", () => {
    const seam = { from: logic, to: flagsFacade, action: "add" as const, interface: { files: [flagsApi, `${flagsFacade}/types.py`] } };
    const findings = findingsOf({
      plan: planOf({ modules: [modifyLogic], seams: [seam] }),
      head: issuesImporting({ to: flagsApi, line: 3 }, { to: `${flagsFacade}/queries.py`, line: 4 }),
      changes: [modified(issues, 3)],
    });

    expect(findings).toEqual([
      {
        rule: "off-interface",
        severity: "violation",
        file: issues,
        line: 4,
        subject: { kind: "seam", from: logic, to: flagsFacade },
        target: `${flagsFacade}/queries.py`,
        test: false,
        message: `${issues}:4 imports \`${flagsFacade}/queries.py\`, which is not part of the interface of seam \`${logic}\` -> \`${flagsFacade}\`.`,
        fix: `Import from \`${flagsApi}\` or \`${flagsFacade}/types.py\` instead.`,
      },
    ]);
  });

  test("reports imported names outside the interface's symbols", () => {
    const findings = findingsOf({
      plan: planOf({ modules: [modifyLogic], seams: [seamThroughApi(["flags_for", "flag_usage"])] }),
      head: issuesImporting({ to: flagsApi, line: 3, names: ["FeatureFlagSerializer", "flags_for"] }),
      changes: [modified(issues, 3)],
    });

    expect(findings).toEqual([
      {
        rule: "off-interface",
        severity: "violation",
        file: issues,
        line: 3,
        subject: { kind: "seam", from: logic, to: flagsFacade },
        target: flagsApi,
        test: false,
        message: `${issues}:3 imports \`FeatureFlagSerializer\` from \`${flagsApi}\`, but seam \`${logic}\` -> \`${flagsFacade}\` allows only flags_for, flag_usage.`,
        fix: `Use flags_for, flag_usage, or expose what you need through \`${flagsApi}\` (symbols flags_for, flag_usage).`,
      },
    ]);
  });

  test("reports only the names an existing import of an interface file gains outside the symbols", () => {
    const findings = findingsOf({
      plan: planOf({ modules: [modifyLogic], seams: [seamThroughApi(["flags_for"])] }),
      both: issuesImporting({ to: flagsApi, line: 3, names: ["flags_for", "legacy_flags"] }),
      head: issuesImporting({ to: flagsApi, line: 3, names: ["flags_for", "legacy_flags", "FeatureFlagSerializer"] }),
      changes: [modified(issues, 3)],
    });

    expect(findings).toEqual([
      {
        rule: "off-interface",
        severity: "violation",
        file: issues,
        line: 3,
        subject: { kind: "seam", from: logic, to: flagsFacade },
        target: flagsApi,
        test: false,
        message: `${issues}:3 imports \`FeatureFlagSerializer\` from \`${flagsApi}\`, but seam \`${logic}\` -> \`${flagsFacade}\` allows only flags_for.`,
        fix: `Use flags_for, or expose what you need through \`${flagsApi}\` (symbols flags_for).`,
      },
    ]);
  });

  test("stays silent when an existing import keeps names it already had outside the symbols", () => {
    const findings = findingsOf({
      plan: planOf({ modules: [modifyLogic], seams: [seamThroughApi(["flags_for", "flag_usage"])] }),
      both: issuesImporting({ to: flagsApi, line: 3, names: ["flags_for", "legacy_flags"] }),
      head: issuesImporting({ to: flagsApi, line: 3, names: ["flag_usage", "flags_for", "legacy_flags"] }),
      changes: [modified(issues, 3)],
    });

    expect(findings).toEqual([]);
  });

  test.each<{ case: string; names: string[] }>([
    { case: "the names are unknown", names: [] },
    { case: "every name is an interface symbol", names: ["flags_for"] },
  ])("stays silent when $case", ({ names }) => {
    const findings = findingsOf({
      plan: planOf({ modules: [modifyLogic], seams: [seamThroughApi(["flags_for"])] }),
      head: issuesImporting({ to: flagsApi, line: 3, names }),
      changes: [modified(issues, 3)],
    });

    expect(findings).toEqual([]);
  });
});

describe("removed seams", () => {
  const removeLegacyFlags = planOf({
    modules: [{ path: legacy, action: "modify" }],
    seams: [{ from: legacy, to: flagsModels, action: "remove" }],
  });

  test("reports a new import along the removed seam, and the old one as still to remove", () => {
    const exporter = `${legacy}/export.py`;
    const findings = findingsOf({ plan: removeLegacyFlags, head: { [exporter]: [{ to: featureFlag, line: 2 }] }, changes: [added(exporter)] });

    expect(findings).toEqual([
      {
        rule: "against-removed-seam",
        severity: "violation",
        file: exporter,
        line: 2,
        subject: { kind: "seam", from: legacy, to: flagsModels },
        target: featureFlag,
        test: false,
        message: `${exporter}:2 imports \`${featureFlag}\` along seam \`${legacy}\` -> \`${flagsModels}\`, which the plan removes.`,
        fix: `Remove this import; the plan takes \`${legacy}\` off \`${flagsModels}\`.`,
      },
      {
        rule: "seam-not-removed",
        severity: "pending",
        file: `${legacy}/cohorts.py`,
        line: 1,
        subject: { kind: "seam", from: legacy, to: flagsModels },
        target: featureFlag,
        test: false,
        message: `${legacy}/cohorts.py:1 still imports \`${featureFlag}\` along seam \`${legacy}\` -> \`${flagsModels}\`, which the plan removes.`,
        fix: "Remove this import or route it the way the plan's other seams allow.",
      },
    ]);
  });

  test.each([
    { phase: "progress" as const, severity: "pending" },
    { phase: "final" as const, severity: "violation" },
  ])("reports imports still along a removed seam as $severity in a $phase check", ({ phase, severity }) => {
    const findings = findingsOf({ plan: removeLegacyFlags, changes: [modified(`${legacy}/cohorts.py`, 5)], phase });

    expect(findings.map(({ rule, severity }) => ({ rule, severity }))).toEqual([{ rule: "seam-not-removed", severity }]);
  });

  test("reports an import still along a removed seam that gains names as going against the seam, even in a progress check", () => {
    const cohorts = `${legacy}/cohorts.py`;
    const findings = findingsOf({
      plan: removeLegacyFlags,
      both: { [cohorts]: [{ to: featureFlag, names: ["FeatureFlag"] }] },
      head: { [cohorts]: [{ to: featureFlag, names: ["FeatureFlag", "get_flag"] }] },
      changes: [modified(cohorts)],
    });

    expect(findings).toEqual([
      {
        rule: "against-removed-seam",
        severity: "violation",
        file: cohorts,
        line: 1,
        subject: { kind: "seam", from: legacy, to: flagsModels },
        target: featureFlag,
        test: false,
        message: `${cohorts}:1 imports \`${featureFlag}\` along seam \`${legacy}\` -> \`${flagsModels}\`, which the plan removes.`,
        fix: `Remove this import; the plan takes \`${legacy}\` off \`${flagsModels}\`.`,
      },
    ]);
  });

  test("leaves imports that a more specific kept seam claims out of the removed seam", () => {
    const sync = `${legacy}/sync/flags.py`;
    const report = check({
      plan: planOf({
        modules: [{ path: legacy, action: "modify" }],
        seams: [
          { from: legacy, to: "products/feature_flags/backend", action: "remove" },
          { from: `${legacy}/sync`, to: flagsFacade, action: "keep" },
        ],
      }),
      both: { [sync]: [flagsApi] },
      head: { [`${legacy}/cohorts.py`]: [] },
      changes: [modified(`${legacy}/cohorts.py`)],
      phase: "final",
    });

    expect(report.verdict).toBe("conforming");
    expect(report.seams.map(({ from, imports }) => ({ from, imports }))).toEqual([
      { from: legacy, imports: 0 },
      { from: `${legacy}/sync`, imports: 1 },
    ]);
  });

  test.each(["progress" as const, "final" as const])("reports a test import still along a removed seam as a warning in a %s check", (phase) => {
    const testFile = `${legacy}/tests/test_cohorts.py`;
    const report = check({
      plan: removeLegacyFlags,
      both: { [testFile]: [featureFlag] },
      head: { [`${legacy}/cohorts.py`]: [] },
      changes: [modified(`${legacy}/cohorts.py`)],
      phase,
    });

    expect(report.findings.map(({ rule, severity, file, test }) => ({ rule, severity, file, test }))).toEqual([
      { rule: "seam-not-removed", severity: "warning", file: testFile, test: true },
    ]);
    expect(report.verdict).toBe("conforming");
  });

  test("does not count a new import beside the removed seam as one along it", () => {
    const exporter = `${legacy}/export.py`;
    const findings = findingsOf({ plan: removeLegacyFlags, head: { [exporter]: [flagsApi] }, changes: [added(exporter)] });

    expect(findings.map(({ rule }) => rule)).toEqual(["seam-not-removed"]);
  });

  test("reports at most 20 remaining imports per removed seam", () => {
    const importers = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`${legacy}/report_${String(index).padStart(2, "0")}.py`, [featureFlag]]));
    const findings = findingsOf({ plan: removeLegacyFlags, both: importers, changes: [modified(`${legacy}/cohorts.py`)] });

    expect(findings.filter(({ rule }) => rule === "seam-not-removed")).toHaveLength(20);
    expect(findings.at(-1)?.file).toBe(`${legacy}/report_18.py`);
  });
});

describe("missing-seam", () => {
  const addSeam = { from: logic, to: flagsFacade, action: "add" as const, interface: { files: [flagsApi] } };

  test.each([
    { phase: "progress" as const, severity: "pending" },
    { phase: "final" as const, severity: "violation" },
  ])("reports an added seam without an import of its interface as $severity in a $phase check", ({ phase, severity }) => {
    const findings = findingsOf({ plan: planOf({ modules: [modifyLogic], seams: [addSeam] }), changes: [modified(issues)], phase });

    expect(findings).toEqual([
      {
        rule: "missing-seam",
        severity,
        file: issues,
        line: 3,
        subject: { kind: "seam", from: logic, to: flagsFacade },
        test: false,
        message: `No file in \`${logic}\` imports \`${flagsApi}\` yet; the plan adds seam \`${logic}\` -> \`${flagsFacade}\`.`,
        fix: `Import \`${flagsApi}\` where \`${logic}\` needs it, for example in \`${issues}\`.`,
      },
    ]);
  });

  test("anchors a seam from a created module without files at that module's folder", () => {
    const flagUsage = `${errorTracking}/flag_usage`;
    const findings = findingsOf({
      plan: planOf({ modules: [{ path: flagUsage, action: "create" }], seams: [{ from: flagUsage, to: flagsFacade, action: "add", interface: { files: [flagsApi] } }] }),
      changes: [],
    });

    expect(findings.find(({ rule }) => rule === "missing-seam")).toMatchObject({
      file: `${flagUsage}/`,
      line: 1,
      fix: `Import \`${flagsApi}\` where \`${flagUsage}\` needs it, for example in \`${flagUsage}/\`.`,
    });
  });

  test("is not satisfied by a test import", () => {
    const testFile = `${logic}/tests/test_issues.py`;
    const findings = findingsOf({ plan: planOf({ modules: [modifyLogic], seams: [addSeam] }), head: { [testFile]: [issues, flagsApi] }, changes: [modified(testFile)] });

    expect(findings.map(({ rule }) => rule)).toEqual(["missing-seam"]);
  });

  test.each([
    { status: "locked" as const, hint: `ask the human to unlock the plan and mark seam \`${facade}\` -> \`${logic}\` as removed` },
    { status: "draft" as const, hint: `change the plan with edit_plan: {"op":"upsert_seam","from":"${facade}","to":"${logic}","action":"remove"}` },
  ])("reports a kept seam that lost its imports, with the $status plan's hint", ({ status, hint }) => {
    const findings = findingsOf({
      plan: planOf({ status, modules: [{ path: facade, action: "modify" }], seams: [{ from: facade, to: logic, action: "keep" }] }),
      head: { [`${facade}/api.py`]: [] },
      changes: [modified(`${facade}/api.py`)],
    });

    expect(findings).toEqual([
      {
        rule: "missing-seam",
        severity: "pending",
        file: `${facade}/api.py`,
        line: 1,
        subject: { kind: "seam", from: facade, to: logic },
        test: false,
        message: `No file in \`${facade}\` imports \`${logic}\` any more; the plan keeps seam \`${facade}\` -> \`${logic}\`.`,
        fix: `Restore an import of the interface \`${logic}\` in \`${facade}\`, or ${hint}.`,
      },
    ]);
  });
});

describe("missing-module", () => {
  const flagUsage = `${errorTracking}/flag_usage`;

  test.each([
    { phase: "progress" as const, severity: "pending" },
    { phase: "final" as const, severity: "violation" },
  ])("reports a created module without files as $severity in a $phase check, at its planned interface", ({ phase, severity }) => {
    const findings = findingsOf({
      plan: planOf({
        modules: [{ path: flagUsage, action: "create", responsibility: "Collect feature flag usage per issue." }],
        seams: [{ from: facade, to: flagUsage, action: "add", interface: { files: [`${flagUsage}/api.py`] } }],
      }),
      changes: [],
      phase,
    });

    expect(findings.find(({ rule }) => rule === "missing-module")).toEqual({
      rule: "missing-module",
      severity,
      file: `${flagUsage}/api.py`,
      line: 1,
      subject: { kind: "module", path: flagUsage },
      test: false,
      message: `\`${flagUsage}\` does not exist yet; the plan creates it to collect feature flag usage per issue.`,
      fix: `Create \`${flagUsage}\` with its first source file.`,
    });
  });

  test("anchors a created module without a planned interface at its folder", () => {
    const findings = findingsOf({ plan: planOf({ modules: [{ path: flagUsage, action: "create" }] }), changes: [] });

    expect(findings.map(({ file, line }) => ({ file, line }))).toEqual([{ file: `${flagUsage}/`, line: 1 }]);
  });

  test("stays silent once a created module has a file", () => {
    const findings = findingsOf({ plan: planOf({ modules: [{ path: flagUsage, action: "create" }] }), head: { [`${flagUsage}/api.py`]: [] }, changes: [added(`${flagUsage}/api.py`)] });

    expect(findings).toEqual([]);
  });

  test.each([
    { status: "locked" as const, hint: `ask the human to unlock the plan and drop \`${facade}\` from it` },
    { status: "draft" as const, hint: `change the plan with edit_plan: {"op":"drop_module","path":"${facade}"}` },
  ])("reports an unchanged modified module with the $status plan's hint", ({ status, hint }) => {
    const findings = findingsOf({ plan: planOf({ status, modules: [{ path: facade, action: "modify", responsibility: "API layer for issue flags" }] }), changes: [] });

    expect(findings).toEqual([
      {
        rule: "missing-module",
        severity: "pending",
        file: `${facade}/api.py`,
        line: 1,
        subject: { kind: "module", path: facade },
        test: false,
        message: `\`${facade}\` is unchanged; the plan modifies it to API layer for issue flags.`,
        fix: `Make the planned change in \`${facade}\`, or ${hint}.`,
      },
    ]);
  });

  test.each(["progress", "final"] as const)("is a warning at a test file in a %s check when the unchanged modified module holds only tests", (phase) => {
    const logicTests = `${logic}/tests`;
    const findings = findingsOf({
      plan: planOf({ modules: [{ path: logicTests, action: "modify", responsibility: "cover flag usage" }] }),
      changes: [],
      phase,
    });

    expect(findings).toEqual([
      {
        rule: "missing-module",
        severity: "warning",
        file: `${logicTests}/test_issues.py`,
        line: 1,
        subject: { kind: "module", path: logicTests },
        test: true,
        message: `\`${logicTests}\` is unchanged; the plan modifies it to cover flag usage.`,
        fix: `Make the planned change in \`${logicTests}\`, or ask the human to unlock the plan and drop \`${logicTests}\` from it.`,
      },
    ]);
  });
});

describe("module-not-removed", () => {
  test.each([
    { phase: "progress" as const, severity: "pending" },
    { phase: "final" as const, severity: "violation" },
  ])("reports a removed module that still holds files as $severity in a $phase check", ({ phase, severity }) => {
    const findings = findingsOf({
      plan: planOf({ modules: [{ path: legacy, action: "remove" }] }),
      head: { [`${legacy}/export.py`]: [] },
      changes: [added(`${legacy}/export.py`)],
      phase,
    });

    expect(findings).toEqual([
      {
        rule: "module-not-removed",
        severity,
        file: `${legacy}/cohorts.py`,
        line: 1,
        subject: { kind: "module", path: legacy },
        test: false,
        message: `\`${legacy}\` still holds 2 source files; the plan removes it.`,
        fix: `Delete the remaining files in \`${legacy}\` and move their importers as the plan's seams say.`,
      },
    ]);
  });

  test.each(["progress", "final"] as const)("is a warning at a test file in a %s check when only tests remain", (phase) => {
    const logicTests = `${logic}/tests`;
    const findings = findingsOf({ plan: planOf({ modules: [{ path: logicTests, action: "remove" }] }), changes: [], phase });

    expect(findings).toEqual([
      {
        rule: "module-not-removed",
        severity: "warning",
        file: `${logicTests}/test_issues.py`,
        line: 1,
        subject: { kind: "module", path: logicTests },
        test: true,
        message: `\`${logicTests}\` still holds 1 source file; the plan removes it.`,
        fix: `Delete the remaining files in \`${logicTests}\` and move their importers as the plan's seams say.`,
      },
    ]);
  });

  test("anchors at a remaining production file before a test file", () => {
    const legacyTest = `${legacy}/tests/test_cohorts.py`;
    const findings = findingsOf({
      plan: planOf({ modules: [{ path: legacy, action: "remove" }] }),
      head: { [legacyTest]: [], [`${legacy}/utils.py`]: [] },
      removed: [`${legacy}/cohorts.py`],
      changes: [deleted(`${legacy}/cohorts.py`), added(legacyTest), added(`${legacy}/utils.py`)],
      phase: "final",
    });

    expect(findings).toEqual([
      {
        rule: "module-not-removed",
        severity: "violation",
        file: `${legacy}/utils.py`,
        line: 1,
        subject: { kind: "module", path: legacy },
        test: false,
        message: `\`${legacy}\` still holds 2 source files; the plan removes it.`,
        fix: `Delete the remaining files in \`${legacy}\` and move their importers as the plan's seams say.`,
      },
    ]);
  });

  test("stays silent once every file is gone", () => {
    const findings = findingsOf({ plan: planOf({ modules: [{ path: legacy, action: "remove" }] }), removed: [`${legacy}/cohorts.py`], changes: [deleted(`${legacy}/cohorts.py`)] });

    expect(findings).toEqual([]);
  });
});

describe("unresolved-import", () => {
  test("warns about a new import that resolves nowhere", () => {
    const findings = findingsOf({ plan: planOf({ modules: [modifyLogic] }), head: issuesImporting({ unresolved: "posthog.flag_usage", line: 5 }), changes: [modified(issues, 5)] });

    expect(findings).toEqual([
      {
        rule: "unresolved-import",
        severity: "warning",
        file: issues,
        line: 5,
        subject: { kind: "module", path: logic },
        target: "posthog.flag_usage",
        test: false,
        message: `${issues}:5 imports \`posthog.flag_usage\`, which resolves to no file in the repository and no dependency.`,
        fix: "Fix the specifier, or create the file it names.",
      },
    ]);
  });

  test("stays silent for an import that was already unresolved at base", () => {
    const unresolved = { ...baseSource, [fingerprint]: [{ unresolved: "posthog.missing", line: 1 }] };
    const report = checkConformance({
      plan: planOf({ modules: [modifyLogic] }),
      base: new ArchitectureModel(architectureOf(unresolved)),
      head: new ArchitectureModel(architectureOf(unresolved)),
      changes: [modified(fingerprint)],
      phase: "progress",
    });

    expect(report.findings).toEqual([]);
  });
});

describe("report", () => {
  const plan = planOf({
    modules: [{ path: facade, action: "modify" }, modifyLogic, { path: legacy, action: "remove" }],
    seams: [
      { from: logic, to: flagsFacade, action: "add", interface: { files: [flagsApi] } },
      { from: facade, to: logic, action: "keep" },
    ],
  });
  const violatingChange = { plan, head: issuesImporting({ to: team, line: 3 }, { to: flagsApi, line: 4 }), changes: [modified(issues, 3)] };

  test("gives each planned element its status and the verdict the worst of them", () => {
    const report = check(violatingChange);

    expect(report.verdict).toBe("violating");
    expect(report.modules).toEqual([
      { path: facade, action: "modify", status: "pending" },
      { path: legacy, action: "remove", status: "pending" },
      { path: logic, action: "modify", status: "violating" },
    ]);
    expect(report.seams).toEqual([
      { from: facade, to: logic, action: "keep", status: "conforming", imports: 1 },
      { from: logic, to: flagsFacade, action: "add", status: "conforming", imports: 1 },
    ]);
    expect(report.counts).toEqual({ violations: 1, pending: 2, warnings: 0 });
  });

  test("orders findings by severity, then file and line, with stable ids", () => {
    const report = check(violatingChange);

    expect(report.findings.map(({ id, severity }) => ({ id, severity }))).toEqual([
      { id: `unplanned-dependency|${issues}|3|${team}`, severity: "violation" },
      { id: `missing-module|${facade}/api.py|1|${facade}`, severity: "pending" },
      { id: `module-not-removed|${legacy}/cohorts.py|1|${legacy}`, severity: "pending" },
    ]);
  });

  test("is pending while only planned work is left", () => {
    const report = check({ plan: planOf({ modules: [modifyLogic, { path: facade, action: "modify" }] }), changes: [modified(issues)] });

    expect(report.verdict).toBe("pending");
  });

  test("is violating for a change outside every planned element while the elements conform", () => {
    const report = check({ plan: planOf({ modules: [modifyLogic] }), changes: [modified(issues), modified(team)] });

    expect(report.verdict).toBe("violating");
    expect(report.modules).toEqual([{ path: logic, action: "modify", status: "conforming" }]);
  });

  test("is conforming in a final check when the change does exactly what the plan says", () => {
    const report = check({
      plan: planOf({ modules: [modifyLogic], seams: [{ from: logic, to: flagsFacade, action: "add", interface: { files: [flagsApi], symbols: ["flags_for"] } }] }),
      head: issuesImporting({ to: flagsApi, line: 3, names: ["flags_for"] }),
      changes: [modified(issues, 3)],
      phase: "final",
    });

    expect(report).toEqual({
      verdict: "conforming",
      modules: [{ path: logic, action: "modify", status: "conforming" }],
      seams: [{ from: logic, to: flagsFacade, action: "add", status: "conforming", imports: 1 }],
      findings: [],
      counts: { violations: 0, pending: 0, warnings: 0 },
    });
  });

  test("keeps warnings out of the statuses and the verdict", () => {
    const report = check({ plan: planOf({ modules: [modifyLogic] }), head: issuesImporting({ unresolved: "posthog.gone", line: 3 }), changes: [modified(issues, 3)] });

    expect(report.counts).toEqual({ violations: 0, pending: 0, warnings: 1 });
    expect(report.modules).toEqual([{ path: logic, action: "modify", status: "conforming" }]);
    expect(report.verdict).toBe("conforming");
  });
});
