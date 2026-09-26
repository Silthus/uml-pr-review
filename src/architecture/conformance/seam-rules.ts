import type { Seam } from "../contracts/index.ts";
import type { Change, FileImport } from "./change.ts";
import { type DraftFinding, draftOf, seamSubject } from "./draft.ts";
import * as feedback from "./feedback.ts";

const importsReportedPerRemovedSeam = 20;

export function seamFindings(change: Change, alreadyReported: DraftFinding[]): DraftFinding[] {
  const reported = new Set(alreadyReported.map(({ file, target }) => `${file}\n${target}`));
  return change.plan.seams.flatMap((seam) => {
    if (seam.action === "remove") return seamNotRemoved(change, seam, reported);
    return hasPlannedImport(change, seam) ? [] : [missingSeam(change, seam)];
  });
}

export function productionImportsAlong(change: Change, seam: Seam): FileImport[] {
  return change.importsAlong(seam).filter(({ test }) => !test);
}

function seamNotRemoved(change: Change, seam: Seam, reported: Set<string>): DraftFinding[] {
  return change
    .importsAlong(seam)
    .filter(({ file, target }) => !reported.has(`${file}\n${target}`))
    .slice(0, importsReportedPerRemovedSeam)
    .map((imported) =>
      draftOf({
        rule: "seam-not-removed",
        severity: "planned",
        file: imported.file,
        line: imported.line,
        subject: seamSubject(seam),
        target: imported.target,
        test: imported.test,
        ...feedback.seamNotRemoved(imported, seam),
      }),
    );
}

function hasPlannedImport(change: Change, seam: Seam): boolean {
  const imports = productionImportsAlong(change, seam);
  const interfaceFiles = seam.action === "add" ? seam.interface?.files : undefined;
  return interfaceFiles ? imports.some(({ target }) => interfaceFiles.includes(target)) : imports.length > 0;
}

function missingSeam(change: Change, seam: Seam): DraftFinding {
  const anchor = change.anchorIn(seam.from);
  const text = seam.action === "add" ? feedback.missingAddedSeam(seam, anchor.file) : feedback.missingKeptSeam(seam, change.plan.status);
  return draftOf({ rule: "missing-seam", severity: "planned", ...anchor, subject: seamSubject(seam), ...text });
}
