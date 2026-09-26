export function isWithin(path: string, module: string): boolean {
  return module === "." || path.startsWith(`${module}/`);
}

export function seamLabel({ from, to }: { from: string; to: string }): string {
  return `${from} -> ${to}`;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
