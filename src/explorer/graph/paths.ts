export function ancestorsOf(path: string): string[] {
  if (path === ".") return [];
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function moduleLabel(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function parentOf(path: string): string | null {
  const ancestors = ancestorsOf(path);
  return ancestors.at(-1) ?? (path === "." ? null : ".");
}
