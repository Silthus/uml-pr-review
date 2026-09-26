import { useState } from "react";
import type { ArchitecturePlan, ConformanceResult } from "../../architecture/contracts/index.ts";
import { statusGlyph } from "../canvas/package-node.tsx";
import { CommentThread } from "./comments.tsx";
import { FindingList } from "./finding-list.tsx";
import { ModulePath } from "./module-path.tsx";
import type { PlanActions } from "./plan-actions.ts";
import { ModuleForm } from "./selected-module.tsx";

export function PlanPanel({ plan, conformance, actions, onSelectModule, onSelectSeam }: { plan: ArchitecturePlan; conformance: ConformanceResult | null; actions: PlanActions; onSelectModule(path: string): void; onSelectSeam(from: string, to: string): void }) {
  const [creating, setCreating] = useState(false);
  const locked = plan.status === "locked";
  const moduleStatus = new Map(conformance?.modules.map((module) => [module.path, module.status]) ?? []);
  const seamStatus = new Map(conformance?.seams.map((seam) => [`${seam.from}->${seam.to}`, seam.status]) ?? []);
  const planComments = plan.comments.filter((comment) => comment.target.kind === "plan");
  return (
    <section className="panel plan" aria-label="Architecture plan">
      <p className="eyebrow">Architecture plan · revision {plan.revision}</p>
      <h2>{plan.title}</h2>
      <p className="goal">{plan.goal}</p>
      <div className="plan-state">
        <span className={`chip chip-lock ${plan.status}`}>{locked ? "Locked" : "Draft"}</span>
        {conformance ? <span className={`chip chip-status status-${conformance.verdict}`}>{statusGlyph(conformance.verdict)} {conformance.verdict} · {conformance.phase}</span> : <span className="muted">Not checked yet</span>}
      </div>
      <div className="actions">
        <button type="button" onClick={() => void actions.check(false)}>Check</button>
        <button type="button" onClick={() => void actions.check(true)}>Final check</button>
        <button type="button" className={locked ? "" : "primary"} onClick={() => void actions.setLocked(!locked)}>{locked ? "Unlock" : "Lock plan"}</button>
      </div>
      <h3>Modules <span className="count">{plan.modules.length}</span></h3>
      <ul className="plan-list">
        {plan.modules.map((module) => (
          <li key={module.path}>
            <button type="button" className="link" onClick={() => onSelectModule(module.path)}>
              <span className={`chip chip-action action-${module.action}`}>{module.action}</span>
              <ModulePath path={module.path} />
              <StatusChip status={moduleStatus.get(module.path)} />
            </button>
          </li>
        ))}
      </ul>
      {locked ? null : creating ? (
        <ModuleForm path="" exists={false} onSubmit={async (entry) => { await actions.upsertModule(entry); setCreating(false); }} />
      ) : (
        <button type="button" className="subtle" onClick={() => setCreating(true)}>New module…</button>
      )}
      <h3>Seams <span className="count">{plan.seams.length}</span></h3>
      <ul className="plan-list">
        {plan.seams.map((seam) => (
          <li key={`${seam.from}->${seam.to}`}>
            <button type="button" className="link" onClick={() => onSelectSeam(seam.from, seam.to)}>
              <span className={`chip chip-action seam-${seam.action}`}>{seam.action}</span>
              <span className="seam-ends"><ModulePath path={seam.from} /> <span className="arrow">→</span> <ModulePath path={seam.to} /></span>
              <StatusChip status={seamStatus.get(`${seam.from}->${seam.to}`)} />
            </button>
          </li>
        ))}
      </ul>
      {conformance ? (
        <>
          <h3>Findings <span className="count">{conformance.findings.length}</span></h3>
          {conformance.findings.length === 0 ? <p className="muted">No findings.</p> : <FindingList findings={conformance.findings} onSelect={onSelectModule} />}
        </>
      ) : null}
      <h3>Plan comments</h3>
      <CommentThread comments={planComments} target={{ kind: "plan" }} actions={actions} label="the plan" />
    </section>
  );
}

function StatusChip({ status }: { status: "conforming" | "pending" | "violating" | undefined }) {
  if (!status) return null;
  return <span className={`chip chip-status status-${status}`}>{statusGlyph(status)} {status}</span>;
}
