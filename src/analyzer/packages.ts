import { posix } from "node:path";
import type { Package } from "../graph.ts";

const manifestNames = ["package.json", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod"];

export class PackageIndex {
  private readonly manifestsByRoot = new Map<string, string>();

  constructor(paths: string[]) {
    for (const path of paths) {
      if (manifestNames.includes(posix.basename(path)) && !path.includes("node_modules/")) {
        const root = posix.dirname(path);
        if (!this.manifestsByRoot.has(root) || posix.basename(path) === "package.json") this.manifestsByRoot.set(root, path);
      }
    }
  }

  rootOf(path: string): string {
    let directory = posix.dirname(path);
    while (directory !== ".") {
      if (this.manifestsByRoot.has(directory)) return directory;
      directory = posix.dirname(directory);
    }
    return ".";
  }

  manifestOf(root: string): string | undefined {
    return this.manifestsByRoot.get(root);
  }
}

export function packageFor(root: string, manifest: string | undefined, fallbackName: string): Package {
  return { root, name: (manifest && manifestPackageName(manifest)) || (root === "." ? fallbackName : root) };
}

function manifestPackageName(manifest: string): string | null {
  try {
    const parsed = JSON.parse(manifest) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return /^\s*name\s*=\s*["']([^"']+)["']/m.exec(manifest)?.[1] ?? null;
  }
}
