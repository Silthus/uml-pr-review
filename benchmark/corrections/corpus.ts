import { createHash } from "node:crypto";
import { z } from "zod";
import type { CorpusComment } from "./comments.ts";
import { splits } from "./comments.ts";
import type { Fix } from "./fixes.ts";
import { type ConfirmationLabel, subtypes, type VerificationLabel } from "./labels.ts";

const repositoryUrl = "https://github.com/PostHog/posthog";

export const corpusRowSchema = z.object({
  id: z.string(),
  pr: z.number().int(),
  prUrl: z.string(),
  commentUrl: z.string(),
  reviewer: z.string(),
  mergedAt: z.string(),
  commentedAt: z.string().nullable(),
  path: z.string(),
  line: z.number().nullable(),
  product: z.string(),
  subtype: z.enum(subtypes),
  quote: z.string().max(200),
  commentCommit: z.string().nullable(),
  before: z.string().nullable(),
  fix: z.string().nullable(),
  fixUrl: z.string().nullable(),
  isolable: z.boolean(),
  verified: z.enum(["yes", "partly", "no", "unverifiable"]).nullable(),
  split: z.enum(splits),
});
export type CorpusRow = z.infer<typeof corpusRowSchema>;

type Confirmed = Extract<ConfirmationLabel, { architecture: true }>;

export function productOf(path: string): string {
  const segments = path.split("/");
  const [first, second, third] = segments;
  if (first === "products" && segments.length > 2) return second!;
  if (second === "src" && segments.length > 3) return `${first}/${third}`;
  return segments.length > 2 ? `${first}/${second}` : first!;
}

export function corpusRows(comments: CorpusComment[], confirmations: Map<string, ConfirmationLabel>, fixes: Map<string, Fix>, verifications: Map<string, VerificationLabel>): CorpusRow[] {
  return comments
    .flatMap((comment) => {
      const label = confirmations.get(comment.id);
      return label?.architecture ? [rowOf(comment, label, fixes.get(comment.id), verifications.get(comment.id))] : [];
    })
    .sort((a, b) => a.mergedAt.localeCompare(b.mergedAt) || a.pr - b.pr || a.id.localeCompare(b.id));
}

function rowOf(comment: CorpusComment, label: Confirmed, fix: Fix | undefined, verification: VerificationLabel | undefined): CorpusRow {
  return {
    id: comment.id,
    pr: comment.pr,
    prUrl: `${repositoryUrl}/pull/${comment.pr}`,
    commentUrl: comment.url,
    reviewer: comment.author,
    mergedAt: comment.mergedAt,
    commentedAt: comment.at,
    path: comment.path,
    line: comment.line,
    product: productOf(comment.path),
    subtype: label.subtype,
    quote: label.quote,
    commentCommit: fix?.commentCommit ?? null,
    before: fix?.before ?? null,
    fix: fix?.fix ?? null,
    fixUrl: fix?.fix ? `${repositoryUrl}/pull/${comment.pr}/commits/${fix.fix}` : null,
    isolable: fix !== undefined && fix.fix !== null && fix.isolable,
    verified: verification?.addressed ?? null,
    split: comment.split,
  };
}

export function jsonLines(rows: CorpusRow[]): string {
  return rows.map((row) => `${JSON.stringify(row)}\n`).join("");
}

export function heldOutDigest(rows: CorpusRow[]): string {
  return createHash("sha256").update(jsonLines(rows.filter(({ split }) => split === "heldout"))).digest("hex");
}
