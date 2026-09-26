import { basename } from "node:path";
import type { HarvestItem } from "./items.ts";

export type Statement = { line: number; text: string };

const normativeMarker = /\b(must|never|always|do not|don'?t|should|shouldn'?t|only|prefer|avoid|keep|make sure|required?|forbidden|not allowed|instead)\b/i;
const guidanceDocument = /^(AGENTS|CLAUDE|CONTRIBUTING|README|ARCHITECTURE|SKILL|THEORY|CONTEXT)\.md$|\.spec\.md$/i;
const tableHeader = /^\s*\[\[?[\w.-]+\]?\]\s*$/;
const maximumBlockLength = 1500;

export function isGuidanceDocument(path: string): boolean {
  return guidanceDocument.test(basename(path)) || /\/skills\/.+\.md$/.test(path);
}

export function documentStatements(markdown: string): Statement[] {
  const statements: Statement[] = [];
  let inFence = false;
  markdown.split("\n").forEach((raw, index) => {
    if (/^\s*(```|~~~)/.test(raw)) inFence = !inFence;
    const text = raw.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").trim();
    if (inFence || text.startsWith("#") || text.length < 12) return;
    if (normativeMarker.test(text)) statements.push({ line: index + 1, text });
  });
  return statements;
}

export function configStatements(path: string, text: string, moduleNames: readonly string[]): Statement[] {
  if (path.endsWith(".toml")) return tomlBlocks(text, moduleNames);
  return text.split("\n").flatMap((line, index) => (moduleNames.some((name) => line.includes(name)) ? [{ line: index + 1, text: line.trim() }] : []));
}

export function ancestorGuidancePaths(scope: string): string[] {
  const segments = scope.replace(/\/$/, "").split("/").slice(0, -1);
  const directories = ["", ...segments.map((_, index) => `${segments.slice(0, index + 1).join("/")}/`)];
  return directories.flatMap((directory) => [`${directory}AGENTS.md`, `${directory}CLAUDE.md`]);
}

function tomlBlocks(toml: string, moduleNames: readonly string[]): Statement[] {
  const lines = toml.split("\n");
  const starts = lines.flatMap((line, index) => (tableHeader.test(line) ? [index] : []));
  return starts.flatMap((start, position) => {
    const end = starts[position + 1] ?? lines.length;
    const block = lines.slice(start, end).join("\n").trim();
    if (!moduleNames.some((name) => block.includes(name))) return [];
    return [{ line: start + 1, text: block.length > maximumBlockLength ? `${block.slice(0, maximumBlockLength)}\n…` : block }];
  });
}

export function moduleNamesOf(scope: string): string[] {
  const trimmed = scope.replace(/\/$/, "");
  return [trimmed, trimmed.replaceAll("/", ".")];
}

export function statementItems(repo: string, commit: string, path: string, statements: readonly Statement[]): HarvestItem[] {
  return statements.map(({ line, text }) => ({
    id: `doc:${path}:${line}`,
    source: "doc",
    origin: `doc:${path}`,
    url: `https://github.com/${repo}/blob/${commit}/${path}#L${line}`,
    author: "repository",
    isBot: false,
    byPullRequestAuthor: false,
    path,
    line,
    body: text,
    at: null,
  }));
}
