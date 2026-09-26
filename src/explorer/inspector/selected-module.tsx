import { useState, type FormEvent } from "react";
import type { ArchitecturePlan, ConformanceResult, ModuleView, PlannedModule, Seam } from "../../architecture/contracts/index.ts";
import type { ArchitectureModel } from "../../architecture/model/index.ts";
import { stereotypeOf } from "../canvas/stereotype.ts";
import type { PlanActions } from "./plan-actions.ts";
import { CommentThread } from "./comments.tsx";
import { DependencyList } from "./dependency-list.tsx";
import { ModulePath } from "./module-path.tsx";

export function SelectedModule({ module, model, plan, conformance, includeTests, actions, onSelect, onFocusConnections, lensOpen }: { module: ModuleView; model: ArchitectureModel; plan: ArchitecturePlan | null; conformance: ConformanceResult | null; includeTests: boolean; actions: PlanActions; onSelect(path: string): void; onFocusConnections(path: string): void; lensOpen: boolean }) {
  const planned = plan?.modules.find((entry) => entry.path === module.path) ?? null;
  const status = conformance?.modules.find((entry) => entry.path === module.path)?.status ?? null;
  const comments = plan?.comments.filter((comment) => comment.target.kind === "module" && comment.target.path === module.path) ?? [];
  return (
    <>
      <section className="panel selected">
        <p className="eyebrow">{stereotypeOf(module.kind)}</p>
        <h2>{module.label}</h2>
        <ModulePath path={module.path} className="full-path" />
        <dl className="facts">
          <div><dt>Files</dt><dd>{module.totalFiles.toLocaleString()}</dd></div>
          <div><dt>Own files</dt><dd>{module.directFiles.toLocaleString()}</dd></div>
          <div><dt>Modules</dt><dd>{module.childCount.toLocaleString()}</dd></div>
          {planned ? <div><dt>Plan</dt><dd className={`chip chip-action action-${planned.action}`}>{planned.action}</dd></div> : null}
          {status ? <div><dt>Check</dt><dd className={`chip chip-status status-${status}`}>{status}</dd></div> : null}
        </dl>
        {planned ? <p className="responsibility">{planned.responsibility}</p> : null}
        {lensOpen ? null : <div className="actions"><button type="button" className="primary" onClick={() => onFocusConnections(module.path)}>Focus connections</button></div>}
        {plan ? <ModulePlanActions module={module} planned={planned} plan={plan} actions={actions} /> : null}
      </section>
      <DependencyList title="Depends on" direction="out" subject={module.path} dependencies={model.dependencies(module.path, "out", { includeTests })} model={model} includeTests={includeTests} onSelect={onSelect} />
      <DependencyList title="Depended on by" direction="in" subject={module.path} dependencies={model.dependencies(module.path, "in", { includeTests })} model={model} includeTests={includeTests} onSelect={onSelect} />
      {plan ? (
        <section className="panel">
          <h3>Comments</h3>
          <CommentThread comments={comments} target={{ kind: "module", path: module.path }} actions={actions} label={module.label} />
        </section>
      ) : null}
    </>
  );
}

function ModulePlanActions({ module, planned, plan, actions }: { module: ModuleView; planned: PlannedModule | null; plan: ArchitecturePlan; actions: PlanActions }) {
  const [form, setForm] = useState<"module" | "seam" | null>(null);
  const locked = plan.status === "locked";
  if (locked) return <p className="muted">The plan is locked. Comments are still welcome.</p>;
  return (
    <div className="actions">
      {planned ? (
        <button type="button" onClick={() => void actions.dropModule(module.path)}>Remove from plan</button>
      ) : (
        <button type="button" onClick={() => setForm(form === "module" ? null : "module")}>Add to plan</button>
      )}
      <button type="button" onClick={() => setForm(form === "seam" ? null : "seam")}>Add seam from here</button>
      {form === "module" ? <ModuleForm path={module.path} exists onSubmit={async (entry) => { await actions.upsertModule(entry); setForm(null); }} /> : null}
      {form === "seam" ? <SeamForm from={module.path} onSubmit={async (seam) => { await actions.upsertSeam(seam); setForm(null); }} /> : null}
    </div>
  );
}

export function ModuleForm({ path, exists, onSubmit }: { path: string; exists: boolean; onSubmit(entry: Omit<PlannedModule, "origin">): Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const modulePath = field(fields, "path") || path;
    const responsibility = field(fields, "responsibility");
    if (!modulePath || !responsibility) return;
    void onSubmit({ path: modulePath, action: field(fields, "action") as PlannedModule["action"], responsibility });
  };
  return (
    <form className="edit-form" onSubmit={submit} aria-label="Planned module">
      {exists ? null : <input name="path" aria-label="Module path" placeholder="products/feature_flags/backend/usage" />}
      <select name="action" aria-label="Action" defaultValue={exists ? "modify" : "create"}>
        {exists ? null : <option value="create">create</option>}
        <option value="modify">modify</option>
        <option value="remove">remove</option>
      </select>
      <input name="responsibility" aria-label="Responsibility" placeholder="What this module is responsible for" />
      <button type="submit">Save module</button>
    </form>
  );
}

export function SeamForm({ from, onSubmit }: { from: string; onSubmit(seam: Omit<Seam, "origin">): Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const to = field(fields, "to");
    if (!to) return;
    const interfaceFile = field(fields, "interface");
    void onSubmit({ from, to, action: field(fields, "action") as Seam["action"], interface: interfaceFile ? { files: [interfaceFile], symbols: [] } : undefined, rationale: field(fields, "rationale") || undefined });
  };
  return (
    <form className="edit-form" onSubmit={submit} aria-label="Planned seam">
      <input name="to" aria-label="Seam target" placeholder="products/feature_flags/backend/facade" />
      <select name="action" aria-label="Seam action" defaultValue="add">
        <option value="add">add</option>
        <option value="keep">keep</option>
        <option value="remove">remove</option>
      </select>
      <input name="interface" aria-label="Interface file" placeholder="Interface file the seam routes through (optional)" />
      <input name="rationale" aria-label="Rationale" placeholder="Why (optional)" />
      <button type="submit">Save seam</button>
    </form>
  );
}

function field(fields: FormData, name: string): string {
  return String(fields.get(name) ?? "").trim();
}
