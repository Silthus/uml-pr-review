import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface Bullet {
  component: string;
  name: string;
  fields: Record<string, string>;
}

const INVARIANTS_HEADING = "## invariants";

export function findBullet(worktree: string, target: string): Bullet {
  for (const [component, name] of splits(target)) {
    const fields = declaredFields(join(worktree, component), name);
    if (fields !== undefined) return { component, name, fields };
  }
  throw new Error(`no invariant declared as "${target}": no spec in its folders has a bullet with that name`);
}

function splits(target: string): [string, string][] {
  const slashes = [...target.matchAll(/\//g)].map((match) => match.index);
  return [[".", target], ...slashes.map((at): [string, string] => [target.slice(0, at), target.slice(at + 1)])];
}

function declaredFields(folder: string, name: string): Record<string, string> | undefined {
  const specs = existsSync(folder) ? readdirSync(folder).filter((file) => file.endsWith(".spec.md")) : [];
  for (const spec of specs) {
    const fields = bulletFields(invariantsSection(readFileSync(join(folder, spec), "utf8")), name);
    if (fields !== undefined) return fields;
  }
  return undefined;
}

function invariantsSection(spec: string): string[] {
  const lines = spec.split("\n");
  const start = lines.indexOf(INVARIANTS_HEADING);
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

function bulletFields(lines: string[], name: string): Record<string, string> | undefined {
  const start = lines.findIndex((line) => line.startsWith(`- ${name}:`));
  if (start === -1) return undefined;
  const fields: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(" ")) break;
    const field = /^\s+([a-z][a-z-]*):\s*(.*)$/.exec(line);
    if (field !== null) fields[field[1]!] = field[2]!;
  }
  return fields;
}
