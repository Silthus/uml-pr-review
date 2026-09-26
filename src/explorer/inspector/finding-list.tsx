import type { Finding } from "../../architecture/contracts/index.ts";
import { ModulePath } from "./module-path.tsx";

export function FindingList({ findings, onSelect }: { findings: Finding[]; onSelect(path: string): void }) {
  return (
    <ol className="findings">
      {findings.map((finding) => (
        <li key={finding.id} className={`finding severity-${finding.severity}`}>
          <button type="button" className="link" onClick={() => onSelect(finding.subject.kind === "module" ? finding.subject.path : finding.subject.from)}>
            <ModulePath path={`${finding.file}:${finding.line}`} />
          </button>
          <p>{finding.message}</p>
          <p className="fix">{finding.fix}</p>
        </li>
      ))}
    </ol>
  );
}
