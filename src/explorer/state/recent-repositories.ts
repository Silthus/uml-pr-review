const recentKey = "uml-pr-review:recent-repositories";

export function recentRepositories(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function rememberRepository(path: string) {
  const next = [path, ...recentRepositories().filter((entry) => entry !== path)].slice(0, 8);
  localStorage.setItem(recentKey, JSON.stringify(next));
}
