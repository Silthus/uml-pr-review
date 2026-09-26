export type Theme = "light" | "dark";

const themeKey = "uml-pr-review:theme";

export function initialTheme(requested: string | null): Theme {
  if (requested === "light" || requested === "dark") return requested;
  const stored = localStorage.getItem(themeKey);
  if (stored === "light" || stored === "dark") return stored;
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function rememberTheme(theme: Theme) {
  localStorage.setItem(themeKey, theme);
}
