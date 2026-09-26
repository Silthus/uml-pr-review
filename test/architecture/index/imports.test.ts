import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ArchitecturePayload } from "../../../src/architecture/contracts/index.ts";
import { createRepositoryIndexer } from "../../../src/architecture/index/index.ts";
import { importsOf, sourceFiles, temporaryRepository, unresolvedOf, type TemporaryRepository } from "./repository.ts";

const pythonForms = `import os
import app.models, app.util as u
from app.users import Team, User as Member
from app import helpers, CONSTANT
from . import views
from .templates import render as r
from app.everything import *
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.types import TeamType
else:
    from app.fallback import Fallback


def handler():
    from app.lazy import thing
if not TYPE_CHECKING:
    from app.runtime import Runtime
`;

const scriptForms = `import Default, { a } from "./default";
import { b, c as d } from "./named";
import * as ns from "./namespace";
import type { T } from "./types";
import "./side-effect";
export { e, f as g } from "./reexported";
export * from "./star";
const lazy = () => import("./dynamic");
const legacy = require("./required");
import k = require("./assigned");
const skipped = import(\`./templated/\${name}\`);
const template = import(\`./template\`);
import "./styles.css";
import { missing } from "./nope";
import { "quoted name" as q } from "./quoted";
import { js } from "./esm-style.js";
`;

const tsconfigBase = `{
  // comments and trailing commas are allowed
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "~/*": ["src/*"], "~/lib/*": ["lib/*"], "@icons": ["../node_modules/icons/index.js"], },
  },
}`;

let repository: TemporaryRepository;
let payload: ArchitecturePayload;

beforeAll(async () => {
  repository = await temporaryRepository({
    "app/service.py": pythonForms,
    "app/merged.py": "from app.models import Team\n\n\ndef load():\n    from app.models import User\n",
    "app/stems.py": "from app.missing import thing\nimport app.namespace\nfrom app.namespace import only\n",
    "app/__init__.py": "CONSTANT = 1\n",
    ...sourceFiles(["app/models.py", "app/util.py", "app/users.py", "app/helpers.py", "app/views.py", "app/templates.py", "app/everything.py", "app/types.py", "app/fallback.py", "app/lazy.py", "app/runtime.py", "app/other/missing.py", "app/namespace/only.py"]),
    "web/src/forms.ts": scriptForms,
    ...sourceFiles(["default", "named", "namespace", "types", "side-effect", "reexported", "star", "dynamic", "required", "assigned", "template", "quoted", "esm-style"].map((name) => `web/src/${name}.ts`)),
    "web/src/styles.css": "body {}",
    "web/tsconfig.base.json": tsconfigBase,
    "web/tsconfig.json": JSON.stringify({ extends: "./tsconfig.base" }),
    "web/src/aliases.ts": 'import "~/lib/format";\nimport "~/scenes/home";\nimport "@icons";\nimport "@acme/ui";\nimport "@acme/ui/button";\nimport "@acme/icons";\nimport "@acme/ui/missing";\nimport "react";\nimport "@acme/esm";\nimport "@acme/plain";\n',
    ...sourceFiles(["web/lib/format.ts", "web/src/lib/format.ts", "web/src/scenes/home.tsx"]),
    "packages/ui/package.json": JSON.stringify({ name: "@acme/ui", exports: { ".": { source: "./src/index.ts", import: "./dist/index.js" }, "./button": "./dist/button.js" } }),
    "packages/icons/package.json": JSON.stringify({ name: "@acme/icons", main: "dist/index.js" }),
    "packages/esm/package.json": JSON.stringify({ name: "@acme/esm", module: "./esm/index.js" }),
    "packages/plain/package.json": JSON.stringify({ name: "@acme/plain" }),
    ...sourceFiles(["packages/ui/src/index.ts", "packages/ui/src/button.ts", "packages/icons/src/index.ts", "packages/esm/esm/index.js", "packages/plain/src/index.ts"]),
    "services/llm/pyproject.toml": "[project]\nname = 'llm'\n",
    "services/llm/src/llm_gateway/__init__.py": "",
    "services/llm/src/llm_gateway/client.py": "from shared.config import settings\n",
    "services/llm/src/shared/config.py": "",
    "shared/config.py": "",
    "products/ai/logic.py": "from llm_gateway.client import complete\nfrom shared.config import settings\n",
  });
  payload = await createRepositoryIndexer().index(repository.dir, { commit: "HEAD" });
});

afterAll(() => repository.cleanup());

const importsFrom = (file: string) => importsOf(payload).filter((line) => line.startsWith(`${file}:`));

describe("Python imports", () => {
  test("records every import form with its kind and imported names, resolving submodules before the package", () => {
    expect(importsFrom("app/service.py")).toEqual([
      "app/service.py:4 -> app/__init__.py static [CONSTANT]",
      "app/service.py:7 -> app/everything.py static [*]",
      "app/service.py:12 -> app/fallback.py static [Fallback]",
      "app/service.py:4 -> app/helpers.py static",
      "app/service.py:16 -> app/lazy.py lazy [thing]",
      "app/service.py:2 -> app/models.py static",
      "app/service.py:18 -> app/runtime.py static [Runtime]",
      "app/service.py:6 -> app/templates.py static [render]",
      "app/service.py:10 -> app/types.py type [TeamType]",
      "app/service.py:3 -> app/users.py static [Team, User]",
      "app/service.py:2 -> app/util.py static",
      "app/service.py:5 -> app/views.py static",
    ]);
  });

  test("keeps one import per file pair with the first line, the strongest kind, and all names", () => {
    expect(importsFrom("app/merged.py")).toEqual(["app/merged.py:1 -> app/models.py static [Team, User]"]);
  });

  test("resolves namespace folders to their modules and never guesses by file stem", () => {
    expect(importsFrom("app/stems.py")).toEqual(["app/stems.py:3 -> app/namespace/only.py static"]);
    expect(unresolvedOf(payload).filter((line) => line.startsWith("app/"))).toEqual(["app/stems.py:1 app.missing"]);
  });

  test("finds packages under the source roots of every Python project, owning project first", () => {
    expect(importsFrom("products/ai/logic.py")).toEqual([
      "products/ai/logic.py:1 -> services/llm/src/llm_gateway/client.py static [complete]",
      "products/ai/logic.py:2 -> shared/config.py static [settings]",
    ]);
    expect(importsFrom("services/llm/src/llm_gateway/client.py")).toEqual(["services/llm/src/llm_gateway/client.py:1 -> services/llm/src/shared/config.py static [settings]"]);
  });
});

describe("TypeScript and JavaScript imports", () => {
  test("records every import form with its kind and named bindings", () => {
    expect(importsFrom("web/src/forms.ts")).toEqual([
      "web/src/forms.ts:10 -> web/src/assigned.ts require",
      "web/src/forms.ts:1 -> web/src/default.ts static",
      "web/src/forms.ts:8 -> web/src/dynamic.ts dynamic",
      "web/src/forms.ts:16 -> web/src/esm-style.ts static [js]",
      "web/src/forms.ts:2 -> web/src/named.ts static [b, c]",
      "web/src/forms.ts:3 -> web/src/namespace.ts static",
      "web/src/forms.ts:15 -> web/src/quoted.ts static [quoted name]",
      "web/src/forms.ts:6 -> web/src/reexported.ts reexport [e, f]",
      "web/src/forms.ts:9 -> web/src/required.ts require",
      "web/src/forms.ts:5 -> web/src/side-effect.ts static",
      "web/src/forms.ts:7 -> web/src/star.ts reexport",
      "web/src/forms.ts:12 -> web/src/template.ts dynamic",
      "web/src/forms.ts:4 -> web/src/types.ts type [T]",
    ]);
  });

  test("resolves tsconfig paths through extends, longest pattern first, and workspace packages by name", () => {
    expect(importsFrom("web/src/aliases.ts")).toEqual([
      "web/src/aliases.ts:9 -> packages/esm/esm/index.js static",
      "web/src/aliases.ts:6 -> packages/icons/src/index.ts static",
      "web/src/aliases.ts:10 -> packages/plain/src/index.ts static",
      "web/src/aliases.ts:5 -> packages/ui/src/button.ts static",
      "web/src/aliases.ts:4 -> packages/ui/src/index.ts static",
      "web/src/aliases.ts:1 -> web/lib/format.ts static",
      "web/src/aliases.ts:2 -> web/src/scenes/home.tsx static",
    ]);
  });
});

describe("unresolved imports", () => {
  test("lists in-repository imports that resolve to no file, and leaves out external ones and assets", () => {
    expect(unresolvedOf(payload)).toEqual(["app/stems.py:1 app.missing", "web/src/aliases.ts:7 @acme/ui/missing", "web/src/forms.ts:14 ./nope"]);
  });

  test("counts every import that resolved inside the repository, assets included", () => {
    const resolvedByFile = { "app/service.py": 11, "app/merged.py": 2, "app/stems.py": 2, "web/src/forms.ts": 14, "web/src/aliases.ts": 7, "products/ai/logic.py": 2, "services/llm/src/llm_gateway/client.py": 1 };
    expect(payload.stats.imports).toBe(Object.values(resolvedByFile).reduce((sum, count) => sum + count, 0));
  });
});

