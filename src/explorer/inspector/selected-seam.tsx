import type { ArchitecturePlan, ConformanceResult } from "../../architecture/contracts/index.ts";
import type { ArchitectureModel } from "../../architecture/model/index.ts";
import { statusGlyph } from "../canvas/package-node.tsx";
import { CommentThread } from "./comments.tsx";
import { EvidenceList } from "./dependency-list.tsx";
import { FindingList } from "./finding-list.tsx";
import { ModulePath } from "./module-path.tsx";
import type { PlanActions } from "./plan-actions.ts";

export function SelectedSeam({ from, to, model, plan, conformance, includeTests, actions, onSelect }: { from: string; to: string; model: ArchitectureModel; plan: ArchitecturePlan | null; conformance: ConformanceResult | null; includeTests: boolean; actions: PlanActions; onSelect(path: string): void }) {
  const seam = plan?.seams.find((entry) => entry.from === from && entry.to === to) ?? null;
  const checked = conformance?.seams.find((entry) => entry.from === from && entry.to === to) ?? null;
  const findings = conformance?.findings.filter((finding) => finding.subject.kind === "seam" && finding.subject.from === from && finding.subject.to === to) ?? [];
  const comments = plan?.comments.filter((comment) => comment.target.kind === "seam" && comment.target.from === from && comment.target.to === to) ?? [];
  const evidence = model.evidence(from, to, { includeTests, limit: 8 });
  return (
    <>
      <section className="panel selected">
        <p className="eyebrow">{seam ? `${seam.action} seam` : "dependency"}</p>
        <h2 className="seam-title">
          <button type="button" className="link" onClick={() => onSelect(from)}><ModulePath path={from} /></button>
          <span className="arrow">→</span>
          <button type="button" className="link" onClick={() => onSelect(to)}><ModulePath path={to} /></button>
        </h2>
        <dl className="facts">
          {checked ? <div><dt>Check</dt><dd className={`chip chip-status status-${checked.status}`}>{statusGlyph(checked.status)} {checked.status}</dd></div> : null}
          {seam?.interface ? <div><dt>Interface</dt><dd><ul className="interface-files" aria-label="Interface files">{seam.interface.files.map((file) => <li key={file}><ModulePath path={file} /></li>)}</ul></dd></div> : null}
          {seam?.interface?.symbols.length ? <div><dt>Symbols</dt><dd>{seam.interface.symbols.join(", ")}</dd></div> : null}
        </dl>
        {seam?.rationale ? <p className="responsibility">{seam.rationale}</p> : null}
        {seam && plan?.status !== "locked" ? <div className="actions"><button type="button" onClick={() => void actions.dropSeam(from, to)}>Remove seam</button></div> : null}
      </section>
      {findings.length > 0 ? <section className="panel"><h3>Findings</h3><FindingList findings={findings} onSelect={onSelect} /></section> : null}
      <section className="panel">
        <h3>Imports today <span className="count">{evidence.length}</span></h3>
        {evidence.length === 0 ? <p className="muted">No imports cross this seam yet.</p> : <EvidenceList evidence={evidence} total={evidence.length} model={model} onSelect={onSelect} />}
      </section>
      {plan ? (
        <section className="panel">
          <h3>Comments</h3>
          <CommentThread comments={comments} target={{ kind: "seam", from, to }} actions={actions} label={`seam ${from} → ${to}`} />
        </section>
      ) : null}
    </>
  );
}
