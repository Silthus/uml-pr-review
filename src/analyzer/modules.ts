import { posix } from "node:path";
import type { LanguageId } from "./parser.ts";

const scriptExtensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"];
const scriptSuffixes = ["", ...scriptExtensions, ...scriptExtensions.map((extension) => `/index${extension}`)];
const aliasPrefix = /^(@|~|#)\//;

export class ModuleResolver {
  private readonly files: Set<string>;
  private readonly scriptsByStem = new Map<string, string[]>();
  private readonly cache = new Map<string, string | null>();

  constructor(paths: string[]) {
    this.files = new Set(paths);
    for (const path of paths) {
      const stem = scriptStem(path);
      if (stem) this.scriptsByStem.set(stem, [...(this.scriptsByStem.get(stem) ?? []), path]);
    }
  }

  resolve(fromPath: string, language: LanguageId, specifier: string): string | null {
    const key = `${language === "python" ? "py" : "js"}\0${language === "python" || specifier.startsWith(".") ? posix.dirname(fromPath) : ""}\0${specifier}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, language === "python" ? this.resolvePython(fromPath, specifier) : this.resolveScript(fromPath, specifier));
    }
    return this.cache.get(key)!;
  }

  private resolvePython(fromPath: string, specifier: string): string | null {
    const dots = /^\.*/.exec(specifier)![0].length;
    const dotted = specifier.slice(dots).replaceAll(".", "/");
    const base = dots === 0 ? "" : posix.join(posix.dirname(fromPath), ...Array<string>(dots - 1).fill(".."));
    const modulePath = posix.join(base, dotted);
    return this.firstExisting([`${modulePath}.py`, `${modulePath}/__init__.py`, `${modulePath}.pyi`]);
  }

  private resolveScript(fromPath: string, specifier: string): string | null {
    const withoutJsExtension = specifier.replace(/\.[mc]?js$/, "");
    if (specifier.startsWith(".")) {
      const target = posix.join(posix.dirname(fromPath), withoutJsExtension);
      return this.firstExisting(scriptSuffixes.map((suffix) => target + suffix));
    }
    return this.resolveBySuffix(fromPath, withoutJsExtension.replace(aliasPrefix, ""));
  }

  private resolveBySuffix(fromPath: string, specifier: string): string | null {
    if (!specifier.includes("/")) return null;
    const lastSegment = specifier.slice(specifier.lastIndexOf("/") + 1);
    const candidates = [...(this.scriptsByStem.get(lastSegment) ?? []), ...(this.scriptsByStem.get(`${lastSegment}/index`) ?? [])];
    const matching = candidates.filter((path) => {
      const stem = withoutScriptExtension(path).replace(/\/index$/, "");
      return stem === specifier || stem.endsWith(`/${specifier}`);
    });
    return closestTo(fromPath, matching);
  }

  private firstExisting(candidates: string[]): string | null {
    return candidates.find((candidate) => this.files.has(candidate)) ?? null;
  }
}

function withoutScriptExtension(path: string): string {
  return path.replace(/\.[mc]?[jt]sx?$/, "");
}

function scriptStem(path: string): string | null {
  if (!/\.[mc]?[jt]sx?$/.test(path) || /\.d\.[mc]?ts$/.test(path)) return null;
  const stem = posix.basename(withoutScriptExtension(path));
  return stem === "index" ? `${posix.basename(posix.dirname(path))}/index` : stem;
}

function closestTo(fromPath: string, paths: string[]): string | null {
  const sharedPrefix = (path: string) => {
    let length = 0;
    while (length < path.length && path[length] === fromPath[length]) length++;
    return length;
  };
  return [...paths].sort((a, b) => sharedPrefix(b) - sharedPrefix(a) || a.length - b.length || (a < b ? -1 : 1))[0] ?? null;
}
