import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Grader, GradeReport } from "../grade.ts";
import { detectorNames } from "../violations.ts";
import type { Range } from "./jobs.ts";

const ViolationSchema = z.object({ detector: z.enum(detectorNames), rule: z.string(), file: z.string(), line: z.number().nullable(), subject: z.string(), message: z.string() });
const FindingSchema = z.object({ introduced: z.array(ViolationSchema), removed: z.array(ViolationSchema) });
const StoredGradeSchema = z.object({
  base: z.string(),
  head: z.string(),
  files: z.array(z.object({ path: z.string(), addedLines: z.number() })),
  grade: z.number(),
  detectors: z.partialRecord(z.enum(detectorNames), FindingSchema),
  seconds: z.number(),
  error: z.string().optional(),
});

export type StoredGrade = z.infer<typeof StoredGradeSchema>;
export type StoredViolation = z.infer<typeof ViolationSchema>;

export class GradeStore {
  constructor(private readonly directory: string) {}

  async read(range: Range): Promise<StoredGrade | undefined> {
    const file = Bun.file(this.fileOf(range));
    if (!(await file.exists())) return undefined;
    const grade = StoredGradeSchema.parse(await file.json());
    return grade.error === undefined ? grade : undefined;
  }

  async failures(ranges: Range[]): Promise<StoredGrade[]> {
    const grades = await Promise.all(ranges.map(async (range) => ((await Bun.file(this.fileOf(range)).exists()) ? StoredGradeSchema.parse(await Bun.file(this.fileOf(range)).json()) : undefined)));
    return grades.filter((grade): grade is StoredGrade => grade?.error !== undefined);
  }

  async gradeAll(grader: Grader, ranges: Range[], onGraded: (done: number, report: StoredGrade) => void = () => {}): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    let done = 0;
    for (const range of ranges) {
      if (!(await Bun.file(this.fileOf(range)).exists())) {
        const report = await grader.grade(range.base, range.head).then(slim, (error: unknown) => failed(range, error));
        await Bun.write(this.fileOf(range), JSON.stringify(report));
        onGraded(++done, report);
      }
    }
  }

  private fileOf({ base, head }: Range): string {
    return join(this.directory, `${base.replace("^", "~1")}..${head}.json`);
  }
}

function slim(report: GradeReport): StoredGrade {
  const detectors = Object.fromEntries(Object.entries(report.detectors).map(([name, { introduced, removed }]) => [name, { introduced, removed }]));
  return { ...report, detectors };
}

function failed(range: Range, error: unknown): StoredGrade {
  return { ...range, files: [], grade: 0, detectors: {}, seconds: 0, error: String(error).slice(0, 300) };
}
