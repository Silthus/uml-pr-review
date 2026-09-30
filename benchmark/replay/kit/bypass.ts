import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Language } from "./kit.ts";
import type { Bullet } from "./spec.ts";

export interface Bypass {
  path: string;
  content: string;
}

const TYPESCRIPT_STEM = "kitWitnessBypass";
const PYTHON_STEM = "kit_witness_bypass";

export function isChokepoint(bullet: Bullet): boolean {
  return bullet.fields["protects"] !== undefined;
}

export function bypassFor(worktree: string, bullet: Bullet, language: Language): Bypass {
  const protects = bullet.fields["protects"];
  if (protects !== undefined) return chokepointBypass(bullet.component, protects, language);
  const via = /^lint (\w+):([\w/-]+) matching "([^"]+)"$/.exec(bullet.fields["via"] ?? "");
  if (via === null) throw new Error(`${bullet.component}/${bullet.name} is neither a chokepoint nor a lint totality oracle with matching text`);
  return lintBypass(worktree, bullet.component, via[1]!, via[2]!, via[3]!);
}

function chokepointBypass(component: string, protects: string, language: Language): Bypass {
  const [, symbol, thing] = /^(?:(\w+) in )?(\S+)$/.exec(protects) ?? [];
  if (thing === undefined) throw new Error(`cannot read the protected thing "${protects}"`);
  return language === "python" ? pythonImportBypass(component, pythonModule(thing), symbol) : typescriptImportBypass(component, thing, symbol);
}

function pythonModule(thing: string): string {
  if (!thing.endsWith(".py")) return thing;
  return thing.replace(/\.py$/, "").replace(/\/__init__$/, "").split("/").join(".");
}

function pythonImportBypass(component: string, module: string, symbol: string | undefined): Bypass {
  const content = symbol === undefined ? `import ${module}  # noqa: F401\n` : `from ${module} import ${symbol}  # noqa: F401\n`;
  return { path: join(component, `${PYTHON_STEM}.py`), content };
}

function typescriptImportBypass(component: string, file: string, symbol: string | undefined): Bypass {
  const specifier = relative(component, file).replace(/\.tsx?$/, "");
  const from = specifier.startsWith(".") ? specifier : `./${specifier}`;
  const content = symbol === undefined ? `import * as bypass from "${from}";\nexport { bypass };\n` : `import { ${symbol} } from "${from}";\nexport { ${symbol} };\n`;
  return { path: join(component, `${TYPESCRIPT_STEM}.ts`), content };
}

function lintBypass(worktree: string, component: string, tool: string, rule: string, matching: string): Bypass {
  if (tool === "oxlint" && rule === "no-restricted-imports") return { path: join(component, `${TYPESCRIPT_STEM}.ts`), content: `import "${matching}";\n` };
  if (tool === "ruff" && rule === "TID251") return bannedApiBypass(component, bannedApi(worktree, matching));
  throw new Error(`the kit cannot stage a bypass for ${tool}:${rule}`);
}

function bannedApiBypass(component: string, api: string): Bypass {
  const dot = api.lastIndexOf(".");
  return dot === -1 ? pythonImportBypass(component, api, undefined) : pythonImportBypass(component, api.slice(0, dot), api.slice(dot + 1));
}

interface PyProject {
  tool?: { ruff?: { lint?: { "flake8-tidy-imports"?: { "banned-api"?: Record<string, unknown> } } } };
}

function bannedApi(worktree: string, matching: string): string {
  const pyproject = Bun.TOML.parse(readFileSync(join(worktree, "pyproject.toml"), "utf8")) as PyProject;
  const banned = Object.keys(pyproject.tool?.ruff?.lint?.["flake8-tidy-imports"]?.["banned-api"] ?? {});
  const exact = banned.find((api) => api === matching || api.endsWith(`.${matching}`));
  if (exact !== undefined) return exact;
  const containing = banned.filter((api) => api.includes(matching));
  if (containing.length === 1) return containing[0]!;
  throw new Error(`pyproject.toml bans ${containing.length === 0 ? "no API" : `several APIs (${containing.join(", ")})`} matching "${matching}"`);
}
