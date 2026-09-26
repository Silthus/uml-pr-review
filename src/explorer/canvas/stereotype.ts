import type { ModuleKind } from "../../architecture/contracts/index.ts";

export function stereotypeOf(kind: ModuleKind): string {
  return kind === "python-package" ? "«package»" : `«${kind}»`;
}
