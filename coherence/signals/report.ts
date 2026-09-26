import { z } from "zod";

export const signalKinds = [
  "errors.occurrences",
  "errors.users",
  "apm.requests",
  "apm.error_rate",
  "apm.p95_ms",
  "logs.warn_error_lines",
  "usage.pageviews",
  "usage.users",
  "ci.test_failures",
  "ci.test_retries",
  "ci.test_p95_ms",
] as const;

export const SignalKindSchema = z.enum(signalKinds);

const EvidenceSchema = z.object({
  kind: z.enum(["error_issue", "route", "service", "logger", "scene", "test_file"]),
  id: z.string(),
  url: z.string().optional(),
  count: z.number().optional(),
});

export const AttributionSchema = z.enum(["exact", "route", "service"]);

export const SignalRowSchema = z.object({
  path: z.string(),
  signal: SignalKindSchema,
  value: z.number(),
  window: z.enum(["1d", "7d", "30d", "90d"]),
  attribution: AttributionSchema,
  evidence: z.array(EvidenceSchema),
});

export const SignalReportSchema = z.object({
  provider: z.literal("posthog"),
  source: z.object({ host: z.literal("us.posthog.com"), projectId: z.number().int() }),
  scope: z.string(),
  collectedAt: z.string(),
  rows: z.array(SignalRowSchema),
  unavailable: z.array(z.object({ signal: SignalKindSchema, reason: z.string() })),
});

export type SignalKind = z.infer<typeof SignalKindSchema>;
export type Attribution = z.infer<typeof AttributionSchema>;
export type SignalRow = z.infer<typeof SignalRowSchema>;
export type SignalReport = z.infer<typeof SignalReportSchema>;

export async function readSignalReport(path: string): Promise<SignalReport> {
  const parsed = SignalReportSchema.safeParse(await Bun.file(path).json());
  if (!parsed.success) throw new Error(`${path} is not a SignalReport: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
