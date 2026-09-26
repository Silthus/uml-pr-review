import { useState } from "react";
import type { ArchitecturePlan } from "../../architecture/contracts/index.ts";
import { statusGlyph } from "../canvas/package-node.tsx";
import { currentConformance, type CheckView } from "../state/check-provenance.ts";
import { CommentThread, shortTime } from "./comments.tsx";
import { FindingList } from "./finding-list.tsx";
import { ModulePath } from "./module-path.tsx";
import { closingOnSuccess, type PlanActions } from "./plan-actions.ts";
import { ModuleForm } from "./selected-module.tsx";

export function PlanPanel({ plan, check, actions, onSelectModule, onSelectSeam }: { plan: ArchitecturePlan; check: CheckView | null; actions: PlanActions; onSelectModule(path: string): void; onSelectSeam(from: string, to: string): void }) {
  const [creating, setCreating] = useState(false);
  const locked = plan.status === "locked";
  const conformance = currentConformance(check);
  const moduleStatus = new Map(conformance?.modules.map((module) => [module.path, module.status]) ?? []);
  const seamStatus = new Map(conformance?.seams.map((seam) => [`${seam.from}->${seam.to}`, seam.status]) ?? []);
  const planComments = plan.comments.filter((comment) => comment.target.kind === "plan");
  return (
    <section className="panel plan" aria-label="Architecture plan">
      <p className="eyebrow">{`Architecture plan · revision ${plan.revision}`}</p>
      <h2>{plan.title}</h2>
      <p className="goal">{plan.goal}</p>
      <div className="plan-state">
        <span className={`chip chip-lock ${plan.status}`}>{locked ? "Locked" : "Draft"}</span>
        <CheckChip check={check} />
      </div>
      {check?.provenance.kind === "outdated" ? <CheckProvenanceNote result={check.result} since={check.provenance.since} /> : null}
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
        <ModuleForm path="" exists={false} onSubmit={closingOnSuccess(actions.upsertModule, () => setCreating(false))} />
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

function CheckChip({ check }: { check: CheckView | null }) {
  if (!check) return <span className="muted">Not checked yet</span>;
  if (check.provenance.kind === "outdated") return <span className="chip chip-status status-outdated">Outdated check</span>;
  const { verdict, phase } = check.result;
  return <span className={`chip chip-status status-${verdict}`}>{`${statusGlyph(verdict)} ${verdict} · ${phase}`}</span>;
}

function CheckProvenanceNote({ result, since }: { result: CheckView["result"]; since: string[] }) {
  return (
    <p className="muted check-provenance">
      {`Checked revision ${result.planRevision} in ${result.worktree} `}
      <time dateTime={result.checkedAt}>{`at ${shortTime(result.checkedAt)}`}</time>
      {`: ${result.verdict} · ${result.phase}. Since then ${since.join(", and ")}. Check again to see the current state.`}
    </p>
  );
}

function StatusChip({ status }: { status: "conforming" | "pending" | "violating" | undefined }) {
  if (!status) return null;
  return <span className={`chip chip-status status-${status}`}>{statusGlyph(status)} {status}</span>;
}
