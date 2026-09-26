import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useCanvasActions } from "./canvas-actions.ts";
import type { PackageFlowNode } from "./flow-elements.ts";
import { describeContents, labelLines } from "../graph/nodes.ts";
import { ModulePath } from "../inspector/module-path.tsx";
import { stereotypeOf } from "./stereotype.ts";

export function PackageNode({ data }: NodeProps<PackageFlowNode>) {
  const actions = useCanvasActions();
  const classes = ["package", `tone-${data.tone}`, data.container ? "frame" : "leaf", data.ghost ? "ghost" : "", data.fresh ? "fresh" : "", data.status ? `status-${data.status}` : ""].filter(Boolean).join(" ");
  return (
    <div className={classes} title={data.path}>
      <Handle type="target" position={Position.Left} className="hidden-handle" />
      <Handle type="source" position={Position.Right} className="hidden-handle" />
      <button type="button" className="package-tab" aria-label={`${data.path} package`} onClick={() => actions.selectModule(data.path)} onDoubleClick={() => actions.focusConnections(data.path)}>
        <span className="package-label">{labelLines(data.label).map((line, index) => <span key={index} className="package-label-line">{line}</span>)}</span>
        {data.comments > 0 ? <span className="chip chip-comment" aria-label={`${data.comments} comments`}>{data.comments}</span> : null}
      </button>
      <div className="package-body">
        {data.context ? <div className="package-context">in <ModulePath path={data.context} /></div> : null}
        <div className="package-head">
          <span className="stereotype">{stereotypeOf(data.kind)}</span>
          {data.container ? <span className="package-meta">{describeContents(data, data.ghost)}</span> : null}
          {data.expandable ? <Disclosure data={data} /> : null}
        </div>
        {data.container ? null : <div className="package-meta package-meta-row">{describeContents(data, data.ghost)}</div>}
        {data.planAction || data.status ? (
          <div className="package-chips">
            {data.planAction ? <span className={`chip chip-action action-${data.planAction}`}>{data.planAction}</span> : null}
            {data.status ? <span className={`chip chip-status status-${data.status}`}>{statusGlyph(data.status)} {data.status}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Disclosure({ data }: { data: PackageFlowNode["data"] }) {
  const actions = useCanvasActions();
  const verb = data.expanded ? "collapse" : "expand";
  return (
    <button type="button" className="disclosure" aria-label={`${verb} ${data.path}`} aria-expanded={data.expanded} onClick={() => actions.toggleExpanded(data.path)}>
      {data.expanded ? "−" : "+"}
      {data.expanded && data.hiddenChildren > 0 ? <span>{data.hiddenChildren} folded</span> : null}
    </button>
  );
}

export function statusGlyph(status: "conforming" | "pending" | "violating"): string {
  if (status === "conforming") return "✓";
  if (status === "violating") return "✕";
  return "◌";
}
