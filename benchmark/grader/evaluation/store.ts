import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Grader, GradeReport } from "../grade.ts";
import type { DetectorName, Finding } from "../violations.ts";
import type { Range } from "./jobs.ts";

export type StoredGrade = Omit<GradeReport, "detectors"> & { detectors: Partial<Record<DetectorName, Finding>> };

export class GradeStore {
  constructor(private readonly directory: string) {}

  async read(range: Range): Promise<StoredGrade | undefined> {
    const file = Bun.file(this.fileOf(range));
    return (await file.exists()) ? ((await file.json()) as StoredGrade) : undefined;
  }

  async gradeAll(grader: Grader, ranges: Range[], onGraded: (done: number, report: StoredGrade) => void = () => {}): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    let done = 0;
    for (const range of ranges) {
      if (!(await Bun.file(this.fileOf(range)).exists())) {
        const report = await grader.grade(range.base, range.head).catch((error: unknown) => failed(range, error));
        await Bun.write(this.fileOf(range), JSON.stringify(slim(report)));
        onGraded(++done, slim(report));
      }
    }
  }

  private fileOf({ base, head }: Range): string {
    return join(this.directory, `${base.replace("^", "~1")}..${head}.json`);
  }
}

function slim(report: GradeReport | StoredGrade): StoredGrade {
  const detectors = Object.fromEntries(Object.entries(report.detectors).map(([name, { introduced, removed }]) => [name, { introduced, removed }]));
  return { ...report, detectors };
}

function failed(range: Range, error: unknown): StoredGrade {
  return { ...range, files: [], grade: 0, detectors: {}, seconds: 0, error: String(error).slice(0, 300) } as StoredGrade;
}
