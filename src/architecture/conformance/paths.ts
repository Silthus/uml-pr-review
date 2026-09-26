export function isWithin(path: string, module: string): boolean {
  return module === "." || path === module || path.startsWith(`${module}/`);
}

export function depthOf(path: string): number {
  return path === "." ? 0 : path.split("/").length;
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
