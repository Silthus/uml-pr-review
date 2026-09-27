import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, type GraderConfig } from "../../benchmark/grader/config.ts";
import { createGrader, type GradeReport } from "../../benchmark/grader/grade.ts";
import { detectorNames, type DetectorName } from "../../benchmark/grader/violations.ts";
import { repositoryWithChange, type Files } from "../support/repository.ts";

let scratch: string;
let config: GraderConfig;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "grader-test-"));
  await mkdir(join(scratch, "terms", "workflows"), { recursive: true });
  await writeFile(
    join(scratch, "terms", "workflows", "rules.json"),
    JSON.stringify({ product: "Workflows", source: { scopes: ["products/workflows"] }, vocabulary: [{ term: "Workflow", avoid: ["hog flow", "hogflow", "flow"] }] }),
  );
  config = { ...(await readConfig()), detectors: [...detectorNames], vocabulary: { termFiles: join(scratch, "terms") } };
});

afterAll(() => rm(scratch, { recursive: true, force: true }));

async function grade(base: Files, head: Files): Promise<GradeReport> {
  const repository = await repositoryWithChange(base, head);
  const grader = await createGrader(repository.dir, config, join(scratch, "cache", repository.base));
  try {
    return await grader.grade(repository.base, repository.head);
  } finally {
    grader.close();
    await repository.cleanup();
  }
}

function rules(report: GradeReport, detector: DetectorName, direction: "introduced" | "removed"): string[] {
  return (report.detectors[detector]?.[direction] ?? []).map(({ rule, file, line }) => `${rule} ${file}:${line}`);
}

function block(name: string, lines = 12): string {
  return Array.from({ length: lines }, (_, index) => `    total_${index} = compute_${name}(items[${index}], factor=${index}) + offset`).join("\n");
}

describe("cycles", () => {
  const a = "from pkg import b\n\ndef run():\n    return b.value()\n";
  const b = "def value():\n    return 1\n";
  const bImportingA = "from pkg import a\n\ndef value():\n    return a.run\n";

  test("an import that closes a cycle is introduced, and the edit that opens it again removes it", async () => {
    const closing = await grade({ "pkg/__init__.py": "", "pkg/a.py": a, "pkg/b.py": b }, { "pkg/b.py": bImportingA });
    expect(rules(closing, "cycles", "introduced")).toEqual(["import-cycle pkg/b.py:1"]);

    const opening = await grade({ "pkg/__init__.py": "", "pkg/a.py": a, "pkg/b.py": bImportingA }, { "pkg/b.py": b });
    expect(rules(opening, "cycles", "removed")).toEqual(["import-cycle pkg/b.py:1"]);
    expect(rules(opening, "cycles", "introduced")).toEqual([]);
  });
});

describe("facade bypasses", () => {
  const product = { "products/billing/backend/__init__.py": "", "products/billing/backend/models.py": "class Invoice:\n    pass\n", "products/billing/backend/facade/__init__.py": "", "products/billing/backend/facade/api.py": "def invoices():\n    return []\n" };

  test("importing another product's internals is introduced; importing its facade is not", async () => {
    const report = await grade(
      { ...product, "products/crm/backend/__init__.py": "", "products/crm/backend/logic.py": "def run():\n    return 1\n" },
      {
        "products/crm/backend/logic.py": "from products.billing.backend.models import Invoice\nfrom products.billing.backend.facade.api import invoices\n\ndef run():\n    return Invoice, invoices\n",
      },
    );
    expect(rules(report, "facade", "introduced")).toEqual(["facade-bypass products/crm/backend/logic.py:1"]);
  });
});

describe("layering", () => {
  test("presentation importing its own models, and a component taking on state, are introduced", async () => {
    const report = await grade(
      {
        "products/billing/backend/__init__.py": "",
        "products/billing/backend/models.py": "class Invoice:\n    pass\n",
        "products/billing/backend/presentation/__init__.py": "",
        "products/billing/backend/presentation/views.py": "def list_invoices():\n    return []\n",
        "frontend/src/scenes/billing/Invoices.tsx": "export function Invoices(): JSX.Element {\n    return <div />\n}\n",
      },
      {
        "products/billing/backend/presentation/views.py": "from products.billing.backend.models import Invoice\n\ndef list_invoices():\n    return Invoice\n",
        "frontend/src/scenes/billing/Invoices.tsx": "export function Invoices(): JSX.Element {\n    const [open, setOpen] = useState(false)\n    return <div onClick={() => setOpen(!open)} />\n}\n",
      },
    );
    expect(rules(report, "layering", "introduced").sort()).toEqual(["component-state frontend/src/scenes/billing/Invoices.tsx:2", "presentation-imports-internals products/billing/backend/presentation/views.py:1"]);
  });
});

describe("touched-function complexity", () => {
  const branches = (count: number) => Array.from({ length: count }, (_, index) => `    if kind == ${index}:\n        return ${index}`).join("\n");

  test("a function crossing CCN 10 is introduced, and the touched function reports its CCN before and after", async () => {
    const report = await grade({ "app/rules.py": `def classify(kind):\n${branches(3)}\n    return -1\n` }, { "app/rules.py": `def classify(kind):\n${branches(12)}\n    return -1\n` });
    expect(rules(report, "complexity", "introduced")).toEqual(["ccn-over-10 app/rules.py:1"]);
    expect(report.detectors.complexity?.touched).toEqual([{ file: "app/rules.py", name: "classify", line: 1, before: { ccn: 4, nloc: 8 }, after: { ccn: 13, nloc: 26 } }]);
  });
});

describe("vocabulary", () => {
  test("a term the product's term file avoids is introduced in scope and ignored outside it; single generic words are not checked", async () => {
    const report = await grade(
      { "products/workflows/mcp/tools.yaml": "tools:\n  - name: list\n", "products/surveys/tools.yaml": "tools: []\n" },
      { "products/workflows/mcp/tools.yaml": "tools:\n  - name: list\n    description: List every hog flow in the flow editor\n", "products/surveys/tools.yaml": "tools: [hogflow]\n" },
    );
    expect(rules(report, "vocabulary", "introduced")).toEqual(["avoided-term products/workflows/mcp/tools.yaml:3"]);
  });
});

describe("reuse", () => {
  const helper = "def region_to_host(region):\n    return f'https://{region}.posthog.com'\n";

  test("re-declaring a helper that exists elsewhere, and a raw element where Lemon UI exists, are introduced", async () => {
    const report = await grade(
      { "posthog/utils.py": helper, "ee/api/provisioning.py": "def provision():\n    return None\n", "frontend/src/scenes/billing/Plans.tsx": "export function Plans(): JSX.Element {\n    return <div />\n}\n" },
      {
        "ee/api/provisioning.py": `def provision():\n    return None\n\n\n${helper.replace("region_to_host", "_region_to_host")}`,
        "frontend/src/scenes/billing/Plans.tsx": "export function Plans(): JSX.Element {\n    return <button onClick={() => {}}>Upgrade</button>\n}\n",
      },
    );
    expect(rules(report, "reuse", "introduced").sort()).toEqual(["name-twin ee/api/provisioning.py:5", "raw-element frontend/src/scenes/billing/Plans.tsx:2"]);
    expect(report.detectors.reuse?.introduced.find(({ rule }) => rule === "name-twin")?.message).toContain("posthog/utils.py");
  });

  test("replacing the twin with an import of the existing helper removes it", async () => {
    const report = await grade(
      { "posthog/utils.py": helper, "ee/api/provisioning.py": `def provision():\n    return None\n\n\n${helper}` },
      { "ee/api/provisioning.py": "from posthog.utils import region_to_host\n\n\ndef provision():\n    return region_to_host\n" },
    );
    expect(rules(report, "reuse", "removed")).toEqual(["name-twin ee/api/provisioning.py:5"]);
    expect(rules(report, "reuse", "introduced")).toEqual([]);
  });

  test("a port to another language is not a twin", async () => {
    const report = await grade(
      { "rust/cohorts/src/classifier.rs": "pub fn classify_leaf_node(x: u32) -> u32 {\n    x\n}\n", "products/cohorts/backend/parity.py": "VALUE = 1\n" },
      { "products/cohorts/backend/parity.py": "VALUE = 1\n\n\ndef classify_leaf_node(x):\n    return x\n" },
    );
    expect(rules(report, "reuse", "introduced")).toEqual([]);
  });

  test("a name declared in many places is a convention, not a twin", async () => {
    const report = await grade(
      { "a/one.py": "def get_queryset_for(x):\n    return x\n", "b/two.py": "def get_queryset_for(x):\n    return x\n", "c/three.py": "def get_queryset_for(x):\n    return x\n", "d/four.py": "VALUE = 1\n" },
      { "d/four.py": "VALUE = 1\n\n\ndef get_queryset_for(x):\n    return x\n" },
    );
    expect(rules(report, "reuse", "introduced")).toEqual([]);
  });
});

describe("duplication", () => {
  const original = `def summarise(items, factor, offset):\n${block("summary")}\n    return total_0\n`;

  test("code copied from anywhere in the repository is introduced, and code that was already there is not", async () => {
    const report = await grade(
      { "products/billing/backend/report.py": original, "products/crm/backend/export.py": "def export():\n    return []\n" },
      { "products/crm/backend/export.py": `def export():\n    return []\n\n\n${original.replace("summarise", "summarise_contacts")}` },
    );
    expect(rules(report, "duplication", "introduced")).toEqual(["clone products/crm/backend/export.py:5"]);
    expect(report.detectors.duplication?.introduced[0]?.message).toContain("products/billing/backend/report.py");
  });
});

describe("grade", () => {
  test("the grade is the weighted sum of introduced minus removed violations", async () => {
    const a = "from pkg import b\n\ndef run():\n    return b.value()\n";
    const report = await grade(
      { "pkg/__init__.py": "", "pkg/a.py": a, "pkg/b.py": "def value():\n    return 1\n" },
      { "pkg/b.py": "from pkg import a\n\ndef value():\n    return a.run\n" },
    );
    expect(report.grade).toBe(config.weights.cycles!);
    expect(report.files).toEqual([{ path: "pkg/b.py", addedLines: 3 }]);
  });
});
