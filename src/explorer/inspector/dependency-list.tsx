import type { FarDependency, ImportEvidence } from "../../architecture/contracts/index.ts";
import type { ArchitectureModel } from "../../architecture/model/index.ts";
import { compactNumber } from "../graph/visible-graph.ts";
import { ModulePath } from "./module-path.tsx";

const evidenceLimit = 8;

export function DependencyList({ title, direction, subject, dependencies, model, includeTests, onSelect }: { title: string; direction: "out" | "in"; subject: string; dependencies: FarDependency[]; model: ArchitectureModel; includeTests: boolean; onSelect(path: string): void }) {
  return (
    <section className="panel" role="region" aria-label={title}>
      <h3>
        {title} <span className="count">{dependencies.length}</span>
      </h3>
      {dependencies.length === 0 ? <p className="muted">None{includeTests ? "" : " outside tests"}.</p> : null}
      <ul className="dependency-list">
        {dependencies.map((dependency) => {
          const [from, to] = direction === "out" ? [subject, dependency.module] : [dependency.module, subject];
          return (
            <li key={dependency.module}>
              <details>
                <summary>
                  <button type="button" className={`link tone-${direction === "out" ? "outgoing" : "incoming"}`} aria-label={dependency.module} onClick={(event) => { event.preventDefault(); onSelect(dependency.module); }}>
                    <ModulePath path={dependency.module} />
                  </button>
                  <span className="count">{compactNumber(dependency.imports)}</span>
                </summary>
                <EvidenceList evidence={model.evidence(from, to, { includeTests, limit: evidenceLimit })} total={dependency.imports} model={model} onSelect={onSelect} />
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function EvidenceList({ evidence, total, model, onSelect }: { evidence: ImportEvidence[]; total: number; model: ArchitectureModel; onSelect(path: string): void }) {
  return (
    <ol className="evidence">
      {evidence.map((item) => (
        <li key={`${item.file}:${item.line}:${item.target}`}>
          <button type="button" className="link" onClick={() => onSelect(model.moduleOfFile(item.target)?.path ?? item.target)} title={`${item.file}:${item.line} imports ${item.target}`}>
            <ModulePath path={`${item.file}:${item.line}`} /> <span className="arrow">→</span> <ModulePath path={item.target} />
          </button>
        </li>
      ))}
      {total > evidence.length ? <li className="muted">and {(total - evidence.length).toLocaleString()} more imports</li> : null}
    </ol>
  );
}
