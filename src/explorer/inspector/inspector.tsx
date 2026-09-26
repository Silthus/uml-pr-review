import type { ArchitecturePlan, ConformanceResult } from "../../architecture/contracts/index.ts";
import type { ArchitectureModel } from "../../architecture/model/index.ts";
import type { Selection } from "../graph/visible-graph.ts";
import type { PlanActions } from "./plan-actions.ts";
import { PlanPanel } from "./plan-panel.tsx";
import { SelectedModule } from "./selected-module.tsx";
import { SelectedSeam } from "./selected-seam.tsx";

export function Inspector({ model, selection, plan, conformance, includeTests, actions, onSelectModule, onSelectSeam }: { model: ArchitectureModel; selection: Selection | null; plan: ArchitecturePlan | null; conformance: ConformanceResult | null; includeTests: boolean; actions: PlanActions; onSelectModule(path: string): void; onSelectSeam(from: string, to: string): void }) {
  const selectedModule = selection?.kind === "module" ? model.module(selection.path) : undefined;
  return (
    <aside className="inspector" aria-label="Inspector">
      {selection?.kind === "seam" ? (
        <SelectedSeam from={selection.from} to={selection.to} model={model} plan={plan} conformance={conformance} includeTests={includeTests} actions={actions} onSelect={onSelectModule} />
      ) : selectedModule ? (
        <SelectedModule module={selectedModule} model={model} plan={plan} conformance={conformance} includeTests={includeTests} actions={actions} onSelect={onSelectModule} />
      ) : (
        <section className="panel selected">
          <p className="eyebrow">{model.payload.repository.name}</p>
          <h2>Overview</h2>
          <p className="muted">Select a package to see what it depends on and what depends on it. Expand a package to open it in place.</p>
          <dl className="facts">
            <div><dt>Modules</dt><dd>{model.payload.modules.length.toLocaleString()}</dd></div>
            <div><dt>Files</dt><dd>{model.payload.stats.files.toLocaleString()}</dd></div>
            <div><dt>Imports</dt><dd>{model.payload.stats.imports.toLocaleString()}</dd></div>
          </dl>
        </section>
      )}
      {plan ? <PlanPanel plan={plan} conformance={conformance} actions={actions} onSelectModule={onSelectModule} onSelectSeam={onSelectSeam} /> : null}
    </aside>
  );
}
