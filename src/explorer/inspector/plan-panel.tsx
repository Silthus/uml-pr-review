import { useState } from "react";
import type { ArchitecturePlan, CommentTarget, PlanComment } from "../../architecture/contracts/index.ts";
import { statusGlyph } from "../canvas/package-node.tsx";
import { currentConformance, type CheckView } from "../state/check-provenance.ts";
import { CommentList, CommentThread, shortTime } from "./comments.tsx";
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
  const outsideThreads = threadsOutsidePlan(plan);
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
      {outsideThreads.length > 0 ? (
        <>
          <h3>Comments outside the plan <span className="count">{outsideThreads.reduce((total, thread) => total + thread.comments.length, 0)}</span></h3>
          {outsideThreads.map((thread) => (
            <OutsideThread key={thread.key} thread={thread} onSelectModule={onSelectModule} onSelectSeam={onSelectSeam} />
          ))}
        </>
      ) : null}
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

type ElementTarget = Exclude<CommentTarget, { kind: "plan" }>;
type OutsideThread = { key: string; target: ElementTarget; dropped: boolean; comments: PlanComment[] };

function threadsOutsidePlan(plan: ArchitecturePlan): OutsideThread[] {
  const threads = new Map<string, OutsideThread>();
  for (const comment of plan.comments) {
    const { target } = comment;
    if (target.kind === "plan" || isPlanned(plan, target)) continue;
    const key = targetKey(target);
    const thread = threads.get(key) ?? { key, target, dropped: wasDropped(plan, target), comments: [] };
    thread.comments.push(comment);
    threads.set(key, thread);
  }
  return [...threads.values()];
}

function targetKey(target: ElementTarget): string {
  return target.kind === "module" ? `module:${target.path}` : `seam:${target.from}->${target.to}`;
}

function isPlanned(plan: ArchitecturePlan, target: ElementTarget): boolean {
  if (target.kind === "module") return plan.modules.some((module) => module.path === target.path);
  return plan.seams.some((seam) => seam.from === target.from && seam.to === target.to);
}

function wasDropped(plan: ArchitecturePlan, target: ElementTarget): boolean {
  return plan.revisions.some((revision) =>
    revision.operations.some((operation) =>
      target.kind === "module" ? operation.op === "drop_module" && operation.path === target.path : operation.op === "drop_seam" && operation.from === target.from && operation.to === target.to,
    ),
  );
}

function OutsideThread({ thread, onSelectModule, onSelectSeam }: { thread: OutsideThread; onSelectModule(path: string): void; onSelectSeam(from: string, to: string): void }) {
  const { target } = thread;
  const label = target.kind === "module" ? target.path : `${target.from} → ${target.to}`;
  return (
    <section className="outside-thread" aria-label={`Comments on ${thread.dropped ? "dropped" : "unplanned"} ${target.kind} ${label}`}>
      <header>
        <span className="chip">{thread.dropped ? "dropped" : "unplanned"} {target.kind}</span>
        <button type="button" className="link" aria-label={`Show ${target.kind} ${label}`} onClick={() => (target.kind === "module" ? onSelectModule(target.path) : onSelectSeam(target.from, target.to))}>
          {target.kind === "module" ? <ModulePath path={target.path} /> : <span className="seam-ends"><ModulePath path={target.from} /> <span className="arrow">→</span> <ModulePath path={target.to} /></span>}
        </button>
      </header>
      <CommentList comments={thread.comments} />
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
      <time dateTime={result.checkedAt}>{checkedAtText(result.checkedAt)}</time>
      {`: ${result.verdict} · ${result.phase}. ${since.join(" ")} Check again to see the current state.`}
    </p>
  );
}

function checkedAtText(checkedAt: string): string {
  const at = new Date(checkedAt);
  const sameDay = at.toDateString() === new Date().toDateString();
  return sameDay ? `at ${shortTime(checkedAt)}` : `on ${at.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })} at ${shortTime(checkedAt)}`;
}

function StatusChip({ status }: { status: "conforming" | "pending" | "violating" | undefined }) {
  if (!status) return null;
  return <span className={`chip chip-status status-${status}`}>{statusGlyph(status)} {status}</span>;
}
