import { describe, expect, test } from "bun:test";
import { ArchitectureModel } from "../../../src/architecture/model/index.ts";
import { architectureOf } from "../../support/architecture.ts";

const errorTracking = "products/error_tracking/backend";
const featureFlags = "products/feature_flags/backend";

const model = new ArchitectureModel(
  architectureOf({
    [`${errorTracking}/facade/api.py`]: [`${errorTracking}/logic/service.py`],
    [`${errorTracking}/logic/service.py`]: [
      `${errorTracking}/models/issue.py`,
      { to: `${featureFlags}/facade/api.py`, line: 2, names: ["flags_for"] },
      { to: `${featureFlags}/models/flag.py`, line: 5, kind: "lazy", names: ["FeatureFlag"] },
    ],
    [`${errorTracking}/models/issue.py`]: [`${errorTracking}/apps.py`],
    [`${errorTracking}/tests/test_service.py`]: [`${errorTracking}/logic/service.py`, `${featureFlags}/models/flag.py`],
    [`${featureFlags}/facade/api.py`]: [`${featureFlags}/logic/rules.py`],
    [`${featureFlags}/logic/rules.py`]: [`${featureFlags}/models/flag.py`, { unresolved: "posthog.missing", line: 9 }],
    "frontend/lib/client.ts": ["frontend/lib/utils.ts"],
  }),
);

describe("modules", () => {
  test("describes a module by path with its place in the tree", () => {
    expect(model.module(errorTracking)).toEqual({
      path: errorTracking,
      label: "backend",
      kind: "directory",
      parent: "products/error_tracking",
      childCount: 4,
      directFiles: 1,
      totalFiles: 5,
    });
    expect(model.module(".")).toMatchObject({ kind: "root", parent: null, totalFiles: 10 });
    expect(model.module("products/missing")).toBeUndefined();
  });

  test("lists children in path order", () => {
    expect(model.children("products").map(({ path }) => path)).toEqual(["products/error_tracking", "products/feature_flags"]);
    expect(model.children(`${featureFlags}/models`)).toEqual([]);
    expect(model.children("nowhere")).toEqual([]);
  });

  test("finds the module that holds a file", () => {
    expect(model.moduleOfFile(`${errorTracking}/apps.py`)?.path).toBe(errorTracking);
    expect(model.moduleOfFile("frontend/lib/client.ts")?.path).toBe("frontend/lib");
    expect(model.moduleOfFile("frontend/lib/missing.ts")).toBeUndefined();
    expect(model.hasFile("frontend/lib/utils.ts")).toBe(true);
    expect(model.hasFile("frontend/lib")).toBe(false);
  });
});

describe("lift", () => {
  test("shows the children of the root and counts production imports between visible modules", () => {
    expect(model.lift(new Set())).toEqual({
      modules: [model.module(".")!, model.module("frontend")!, model.module("products")!],
      dependencies: [],
    });
  });

  test("lifts each import to the deepest visible ancestor at both ends", () => {
    const view = model.lift(new Set(["products", "products/error_tracking", errorTracking]));

    expect(view.modules.map(({ path }) => path)).toEqual([
      ".",
      "frontend",
      "products",
      "products/error_tracking",
      errorTracking,
      `${errorTracking}/facade`,
      `${errorTracking}/logic`,
      `${errorTracking}/models`,
      "products/feature_flags",
    ]);
    expect(view.dependencies).toEqual([
      { from: `${errorTracking}/facade`, to: `${errorTracking}/logic`, imports: 1 },
      { from: `${errorTracking}/logic`, to: `${errorTracking}/models`, imports: 1 },
      { from: `${errorTracking}/logic`, to: "products/feature_flags", imports: 2 },
      { from: `${errorTracking}/models`, to: errorTracking, imports: 1 },
    ]);
  });

  test("keeps a module hidden while any ancestor is collapsed", () => {
    const view = model.lift(new Set([errorTracking]));

    expect(view.modules.map(({ path }) => path)).toEqual([".", "frontend", "products"]);
  });

  test("always shows the root, even when every module holds only tests", () => {
    const tests = new ArchitectureModel(architectureOf({ "tests/test_a.py": ["tests/test_b.py"] }));

    expect(tests.lift(new Set()).modules.map(({ path }) => path)).toEqual(["."]);
    expect(tests.lift(new Set(), { includeTests: true }).modules.map(({ path }) => path)).toEqual([".", "tests"]);
  });

  test("includes test modules and their imports on request", () => {
    const view = model.lift(new Set(["products", "products/error_tracking", errorTracking]), { includeTests: true });

    expect(view.modules.map(({ path }) => path)).toContain(`${errorTracking}/tests`);
    expect(view.dependencies).toContainEqual({ from: `${errorTracking}/tests`, to: `${errorTracking}/logic`, imports: 1 });
    expect(view.dependencies).toContainEqual({ from: `${errorTracking}/tests`, to: "products/feature_flags", imports: 1 });
  });
});

describe("dependencies", () => {
  test("groups outgoing imports by the far end below the lowest common ancestor", () => {
    expect(model.dependencies(`${errorTracking}/logic`, "out")).toEqual([
      {
        module: "products/feature_flags",
        imports: 2,
        via: [
          { module: `${featureFlags}/facade`, imports: 1 },
          { module: `${featureFlags}/models`, imports: 1 },
        ],
      },
      { module: `${errorTracking}/models`, imports: 1, via: [{ module: `${errorTracking}/models`, imports: 1 }] },
    ]);
  });

  test("names an enclosing module as the far end when the target file sits directly in it", () => {
    expect(model.dependencies(`${errorTracking}/models`, "out")).toEqual([
      { module: errorTracking, imports: 1, via: [{ module: errorTracking, imports: 1 }] },
    ]);
  });

  test("mirrors the grouping for incoming imports and counts tests on request", () => {
    expect(model.dependencies(`${featureFlags}/models`, "in")).toEqual([
      { module: "products/error_tracking", imports: 1, via: [{ module: `${errorTracking}/logic`, imports: 1 }] },
      { module: `${featureFlags}/logic`, imports: 1, via: [{ module: `${featureFlags}/logic`, imports: 1 }] },
    ]);
    expect(model.dependencies(`${featureFlags}/models`, "in", { includeTests: true })[0]).toEqual({
      module: "products/error_tracking",
      imports: 2,
      via: [
        { module: `${errorTracking}/logic`, imports: 1 },
        { module: `${errorTracking}/tests`, imports: 1 },
      ],
    });
  });

  test("is empty for the root and for a path that holds no files yet", () => {
    expect(model.dependencies(".", "out")).toEqual([]);
    expect(model.dependencies("products/new_product", "in")).toEqual([]);
  });
});

describe("test imports", () => {
  const helpers = new ArchitectureModel(architectureOf({ "posthog/api/views.py": ["posthog/test/base.py", "posthog/models/user.py"] }));

  test("are decided by the importing file, so production code reaching into tests stays visible", () => {
    expect(helpers.dependencies("posthog/api", "out").map(({ module }) => module)).toEqual(["posthog/models", "posthog/test"]);
    expect(helpers.evidence("posthog/api", "posthog/test")).toMatchObject([{ file: "posthog/api/views.py", test: false }]);
  });

  test("never draw an edge to a hidden test module", () => {
    expect(helpers.lift(new Set(["posthog"])).dependencies).toEqual([{ from: "posthog/api", to: "posthog/models", imports: 1 }]);
  });
});

describe("wide dependencies", () => {
  const targets = Array.from({ length: 21 }, (_, index) => `hub/m${index}/x.py`);
  const wide = new ArchitectureModel(architectureOf({ "wide/source.py": targets, "hub/m0/x1.py": [], "hub/m0/x2.py": [], "hub/m0/x3.py": [] }));

  test("name at most 5 deepest modules in via", () => {
    expect(wide.dependencies("wide", "out")).toEqual([
      { module: "hub", imports: 21, via: ["hub/m0", "hub/m1", "hub/m10", "hub/m11", "hub/m12"].map((module) => ({ module, imports: 1 })) },
    ]);
  });

  test("list at most 20 imports of evidence by default", () => {
    expect(wide.evidence("wide", "hub")).toHaveLength(20);
    expect(wide.evidence("wide", "hub", { limit: 100 })).toHaveLength(21);
  });

  test("show at most 3 matching files per module in search", () => {
    expect(wide.search("m0/x")).toEqual([{ module: wide.module("hub/m0")!, files: ["hub/m0/x.py", "hub/m0/x1.py", "hub/m0/x2.py"] }]);
  });
});

describe("evidence", () => {
  test("lists the imports from one module into another by file and line", () => {
    expect(model.evidence("products/error_tracking", "products/feature_flags")).toEqual([
      { file: `${errorTracking}/logic/service.py`, line: 2, target: `${featureFlags}/facade/api.py`, kind: "static", names: ["flags_for"], test: false },
      { file: `${errorTracking}/logic/service.py`, line: 5, target: `${featureFlags}/models/flag.py`, kind: "lazy", names: ["FeatureFlag"], test: false },
    ]);
  });

  test("includes imports from tests on request and honours the limit", () => {
    const evidence = model.evidence("products/error_tracking", `${featureFlags}/models`, { includeTests: true });

    expect(evidence.map(({ file, test }) => [file, test])).toEqual([
      [`${errorTracking}/logic/service.py`, false],
      [`${errorTracking}/tests/test_service.py`, true],
    ]);
    expect(model.evidence("products/error_tracking", "products/feature_flags", { limit: 1 })).toHaveLength(1);
  });
});

describe("lastImportLine", () => {
  test("is the highest import line in the file, resolved or not", () => {
    expect(model.lastImportLine(`${errorTracking}/logic/service.py`)).toBe(5);
    expect(model.lastImportLine(`${featureFlags}/logic/rules.py`)).toBe(9);
  });

  test("is 0 for a file without imports or unknown to the index", () => {
    expect(model.lastImportLine("frontend/lib/utils.ts")).toBe(0);
    expect(model.lastImportLine("frontend/lib/missing.ts")).toBe(0);
  });
});

describe("search", () => {
  const catalog = new ArchitectureModel(
    architectureOf({
      "src/calib.ts": [],
      "lib/core/index.ts": [],
      "lib/index.ts": [],
      "library/index.ts": [],
      "vendor/mylib/index.ts": [],
      "other/index.ts": [],
    }),
  );

  test("ranks exact label, label prefix, basename, path, then file matches", () => {
    expect(catalog.search("LIB").map(({ module, files }) => [module.path, files])).toEqual([
      ["lib", []],
      ["library", []],
      ["vendor/mylib", []],
      ["lib/core", []],
      ["src", ["src/calib.ts"]],
    ]);
  });

  test("needs every word to occur in the module path or in one file path", () => {
    expect(model.search("feature_flags api.py").map(({ module, files }) => [module.path, files])).toEqual([
      [`${featureFlags}/facade`, [`${featureFlags}/facade/api.py`]],
    ]);
    expect(model.search("  ")).toEqual([]);
  });

  test("returns at most the limit", () => {
    expect(model.search("backend", 1).map(({ module }) => module.path)).toEqual([errorTracking]);
  });
});
