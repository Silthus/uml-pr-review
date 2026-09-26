import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { analyze, type Analysis } from "../src/analyzer/analyze.ts";
import { diffCommits } from "../src/diff.ts";
import { listTree } from "../src/git.ts";
import { repositoryWithChange, type CommittedRepository } from "./support/repository.ts";

const base = {
  "package.json": `{ "name": "shop" }\n`,
  "billing/pyproject.toml": `[project]\nname = "billing"\n`,
  "billing/tax.py": "def tax_for(items):\n    return 0\n",
  "billing/invoices.py": [
    "from billing.tax import tax_for",
    "",
    "",
    "def total(items):",
    "    return sum(items) + tax_for(items)",
    "",
    "",
    "def unrelated():",
    "    return 1",
    "",
  ].join("\n"),
  "billing/checkout.py": [
    "from billing.invoices import total",
    "",
    "",
    "class Checkout:",
    "    def pay(self, items):",
    "        return total(items)",
    "",
  ].join("\n"),
  "billing/tests/test_invoices.py": [
    "from billing.invoices import total",
    "",
    "",
    "class TestTotal:",
    "    def test_total(self):",
    "        assert total([1]) == 1",
    "",
  ].join("\n"),
  "web/package.json": `{ "name": "web" }\n`,
  "web/src/price.ts": "export function formatPrice(cents: number) {\n  return `${cents / 100}`;\n}\n",
  "web/src/cart.tsx": [
    'import { formatPrice } from "./price";',
    "",
    "export function Cart({ cents }: { cents: number }) {",
    "  return <span>{formatPrice(cents)}</span>;",
    "}",
    "",
  ].join("\n"),
};

const head = {
  "billing/invoices.py": [
    "from billing.tax import tax_for",
    "",
    "",
    "def total(items):",
    "    return round(sum(items) + tax_for(items), 2)",
    "",
    "",
    "def unrelated():",
    "    return 1",
    "",
    "",
    "def discount(items):",
    "    return tax_for(items) / 2",
    "",
  ].join("\n"),
  "web/src/price.ts": "export function formatPrice(cents: number) {\n  return `$${(cents / 100).toFixed(2)}`;\n}\n",
  "README.md": "# Shop\n",
};

let repository: CommittedRepository;
let analysis: Analysis;

beforeAll(async () => {
  repository = await repositoryWithChange(base, head);
  analysis = await analyze({
    repoDir: repository.dir,
    repoName: "shop",
    headSha: repository.head,
    paths: await listTree(repository.dir, repository.head),
    diffs: await diffCommits(repository.dir, repository.base, repository.head),
  });
});

afterAll(() => repository.cleanup());

const symbol = (id: string) => analysis.symbols.find((candidate) => candidate.id === id);
const callPairs = () => analysis.calls.map((call) => `${call.from} -> ${call.to}`).sort();

describe("analyzing a pull request", () => {
  test("marks the symbols the diff overlaps as touched and leaves the rest out", () => {
    expect(symbol("billing/invoices.py#total")).toMatchObject({ change: "modified", hop: 0, signatureChanged: false });
    expect(symbol("billing/invoices.py#discount")).toMatchObject({ change: "added", hop: 0 });
    expect(symbol("web/src/price.ts#formatPrice")).toMatchObject({ change: "modified", hop: 0 });
    expect(symbol("billing/invoices.py#unrelated")).toBeUndefined();
  });

  test("draws callers and callees one hop out, across files, languages, and tests", () => {
    expect(callPairs()).toEqual([
      "billing/checkout.py#Checkout.pay -> billing/invoices.py#total",
      "billing/invoices.py#discount -> billing/tax.py#tax_for",
      "billing/invoices.py#total -> billing/tax.py#tax_for",
      "billing/tests/test_invoices.py#test:TestTotal > test_total -> billing/invoices.py#total",
      "web/src/cart.tsx#Cart -> web/src/price.ts#formatPrice",
    ]);
    expect(symbol("billing/tax.py#tax_for")).toMatchObject({ change: "unchanged", hop: 1 });
    expect(symbol("billing/checkout.py#Checkout")).toMatchObject({ kind: "class", hop: 1 });
  });

  test("keeps the caller-side line of every call site", () => {
    const call = analysis.calls.find((candidate) => candidate.from === "billing/checkout.py#Checkout.pay");
    expect(call?.sites).toEqual([6]);
  });

  test("lists every changed file with its package and role, including files without symbols", () => {
    const files = Object.fromEntries(analysis.files.map((file) => [file.path, [file.status, file.package, file.role]]));
    expect(files).toMatchObject({
      "README.md": ["added", ".", "production"],
      "billing/invoices.py": ["modified", "billing", "production"],
      "billing/tests/test_invoices.py": ["unchanged", "billing", "test"],
      "web/src/cart.tsx": ["unchanged", "web", "production"],
    });
    expect(analysis.packages.map((pkg) => `${pkg.root}=${pkg.name}`).sort()).toEqual([".=shop", "billing=billing", "web=web"]);
  });

  test("links files through their imports", () => {
    expect(analysis.imports).toContainEqual({ from: "web/src/cart.tsx", to: "web/src/price.ts" });
    expect(analysis.imports).toContainEqual({ from: "billing/checkout.py", to: "billing/invoices.py" });
  });
});
