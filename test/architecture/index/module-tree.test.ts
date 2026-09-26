import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ArchitecturePayload } from "../../../src/architecture/contracts/index.ts";
import { createRepositoryIndexer } from "../../../src/architecture/index/index.ts";
import { ArchitectureModel } from "../../../src/architecture/model/index.ts";
import { sourceFiles, temporaryRepository, type TemporaryRepository } from "./repository.ts";

const products = Array.from({ length: 10 }, (_, index) => `products/p${index}`);

let repository: TemporaryRepository;
let payload: ArchitecturePayload;
let model: ArchitectureModel;

beforeAll(async () => {
  repository = await temporaryRepository({
    "README.md": "# repository",
    ...sourceFiles([
      "e2e/login.ts",
      "frontend/jest.config.ts",
      "frontend/src/__generated__/api.ts",
      "frontend/src/lib/format.ts",
      "frontend/src/lib/format.test.ts",
      "frontend/src/scenes/billing/Billing.tsx",
      "frontend/src/scenes/insights/Insights.tsx",
      "frontend/src/globals.d.ts",
      "posthog/__init__.py",
      "posthog/apps.py",
      "posthog/api/v2/routes/teams.py",
      "posthog/migrations/0001_initial.py",
      "posthog/tests/test_api.py",
      "products/__init__.py",
      "products/shared/helpers.py",
      ...products.flatMap((product) => [`${product}/backend/models.py`, `${product}/frontend/scene.tsx`]),
      "rust/crate/src/main.rs",
      "tools/management/commands/run.py",
      "tools-extra/lint.py",
      ".github/scripts/release.py",
      "node_modules/left-pad/index.js",
    ]),
    "frontend/package.json": JSON.stringify({ name: "frontend" }),
    "rust/crate/Cargo.toml": "[package]\nname = \"crate\"\n",
  });
  payload = await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });
  model = new ArchitectureModel(payload);
});

afterAll(() => repository.cleanup());

describe("module tree", () => {
  test("turns source folders into modules in tree order with labels and one kind each", () => {
    expect(payload.modules.map(([path, label, , kind]) => `${path} "${label}" ${kind}`)).toEqual([
      '. "." root',
      'e2e "e2e" tests',
      'frontend "frontend" package',
      'frontend/src/__generated__ "__generated__" generated',
      'frontend/src/lib "lib" directory',
      'frontend/src/scenes "scenes" directory',
      'frontend/src/scenes/billing "billing" scene',
      'frontend/src/scenes/insights "insights" scene',
      'posthog "posthog" django-app',
      'posthog/api/v2/routes "api/v2/routes" directory',
      'posthog/migrations "migrations" migrations',
      'posthog/tests "tests" tests',
      'products "products" python-package',
      ...products.flatMap((product) => [
        `${product} "${product.slice("products/".length)}" product`,
        `${product}/backend "backend" layer`,
        `${product}/frontend "frontend" layer`,
      ]),
      'products/shared "shared" directory',
      'rust/crate "rust/crate" package',
      'tools-extra "tools-extra" directory',
      'tools/management/commands "tools/management/commands" directory',
    ]);
  });

  test("makes a dominant src folder transparent and counts its files for the parent", () => {
    expect(model.module("frontend")).toMatchObject({ parent: ".", childCount: 3, directFiles: 1, totalFiles: 6 });
    expect(model.moduleOfFile("frontend/src/lib/format.ts")?.path).toBe("frontend/src/lib");
    expect(model.moduleOfFile("rust/crate/src/main.rs")?.path).toBe("rust/crate");
    expect(model.module(".")).toMatchObject({ totalFiles: 37, childCount: 7 });
  });

  test("lists source files sorted by path with language and role, without declarations, dot-folders, or node_modules", () => {
    const files = payload.files.map(([path, , language, role]) => `${path} ${language} ${role}`);
    expect(files).toContain("e2e/login.ts typescript test");
    expect(files).toContain("frontend/src/lib/format.test.ts typescript test");
    expect(files).toContain("frontend/src/lib/format.ts typescript production");
    expect(files).toContain("posthog/tests/test_api.py python test");
    expect(files).toContain("rust/crate/src/main.rs rust production");
    expect(files.some((file) => /globals\.d\.ts|\.github|node_modules|README/.test(file))).toBe(false);
    expect(payload.files.map(([path]) => path)).toEqual(payload.files.map(([path]) => path).sort());
    expect(payload.files).toHaveLength(37);
  });

  test("identifies the repository and the indexed commit", async () => {
    const head = (await repository.git("rev-parse", "HEAD")).trim();
    const tree = (await repository.git("rev-parse", "HEAD^{tree}")).trim();
    expect(payload).toMatchObject({ version: 1, commit: head, tree });
    expect(payload.repository.root).toBe((await repository.git("rev-parse", "--show-toplevel")).trim());
    expect(payload.repository.name).toBe(payload.repository.root.split("/").at(-1)!);
  });
});
