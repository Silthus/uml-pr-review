import { Fragment } from "react";
import type { Finding } from "../../architecture/contracts/index.ts";
import { ModulePath } from "./module-path.tsx";

export function FindingList({ findings, onSelect }: { findings: Finding[]; onSelect(path: string): void }) {
  return (
    <ol className="findings">
      {findings.map((finding) => (
        <li key={finding.id} className={`finding severity-${finding.severity}`} aria-label={`${finding.rule} at ${finding.file}:${finding.line}`}>
          <button type="button" className="link" onClick={() => onSelect(finding.subject.kind === "module" ? finding.subject.path : finding.subject.from)}>
            <ModulePath path={`${finding.file}:${finding.line}`} />
          </button>
          <p><InlineCode text={finding.message} /></p>
          <p className="fix"><InlineCode text={finding.fix} /></p>
        </li>
      ))}
    </ol>
  );
}

function InlineCode({ text }: { text: string }) {
  return text.split("`").map((piece, index) => (index % 2 === 1 ? <code key={index}>{piece}</code> : <Fragment key={index}>{piece}</Fragment>));
}
