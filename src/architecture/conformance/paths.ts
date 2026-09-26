export function isWithin(path: string, module: string): boolean {
  return module === "." || path === module || path.startsWith(`${module}/`);
}

export function regionOf(from: string, to: string): string {
  const fromSegments = segmentsOf(from);
  const toSegments = segmentsOf(to);
  let common = 0;
  while (common < fromSegments.length && common < toSegments.length && fromSegments[common] === toSegments[common]) common++;
  return toSegments.slice(0, common + 1).join("/");
}

export function depthOf(path: string): number {
  return segmentsOf(path).length;
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function segmentsOf(path: string): string[] {
  return path === "." ? [] : path.split("/");
}
