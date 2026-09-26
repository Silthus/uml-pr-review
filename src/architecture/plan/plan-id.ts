const slugLength = 40;

export function planIdFor(title: string): string {
  return `${slugOf(title)}-${randomHex()}`;
}

function slugOf(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, slugLength)
    .replace(/-+$/, "");
  return slug || "plan";
}

function randomHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(2)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
