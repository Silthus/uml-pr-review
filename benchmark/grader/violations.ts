export const detectorNames = ["cycles", "facade", "layering", "complexity", "vocabulary", "reuse", "duplication"] as const;
export type DetectorName = (typeof detectorNames)[number];

export type Violation = { detector: DetectorName; rule: string; file: string; line: number; subject: string; message: string };
export type Finding = { introduced: Violation[]; removed: Violation[] };

export function difference(before: Violation[], after: Violation[], renames: Map<string, string> = new Map()): Finding {
  const identity = ({ rule, file, subject }: Violation) => [rule, renames.get(file) ?? file, renames.get(subject) ?? subject].join("\0");
  return { introduced: unmatched(after, before, identity), removed: unmatched(before, after, identity) };
}

function unmatched(items: Violation[], others: Violation[], identity: (violation: Violation) => string): Violation[] {
  const remaining = new Map<string, number>();
  for (const other of others) remaining.set(identity(other), (remaining.get(identity(other)) ?? 0) + 1);
  return items.filter((item) => {
    const count = remaining.get(identity(item)) ?? 0;
    if (count > 0) remaining.set(identity(item), count - 1);
    return count === 0;
  });
}
