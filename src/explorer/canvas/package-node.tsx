import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useCanvasActions } from "./canvas-actions.ts";
import type { PackageFlowNode } from "./flow-elements.ts";
import { stereotypeOf } from "./stereotype.ts";

export function PackageNode({ data }: NodeProps<PackageFlowNode>) {
  const actions = useCanvasActions();
  const classes = ["package", `tone-${data.tone}`, data.container ? "container" : "leaf", data.ghost ? "ghost" : "", data.fresh ? "fresh" : "", data.status ? `status-${data.status}` : ""].filter(Boolean).join(" ");
  return (
    <div className={classes} title={data.path}>
      <Handle type="target" position={Position.Left} className="hidden-handle" />
      <Handle type="source" position={Position.Right} className="hidden-handle" />
      <button type="button" className="package-tab" aria-label={`${data.path} package`} onClick={() => actions.selectModule(data.path)}>
        <span className="package-label">{data.label}</span>
        {data.comments > 0 ? <span className="chip chip-comment" aria-label={`${data.comments} comments`}>{data.comments}</span> : null}
      </button>
      <div className="package-body">
        <div className="package-head">
          <span className="stereotype">{stereotypeOf(data.kind)}</span>
          <span className="package-meta">{describeContents(data)}</span>
          {data.planAction ? <span className={`chip chip-action action-${data.planAction}`}>{data.planAction}</span> : null}
          {data.status ? <span className={`chip chip-status status-${data.status}`}>{statusGlyph(data.status)} {data.status}</span> : null}
          {data.childCount > 0 ? <Disclosure data={data} /> : null}
        </div>
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

function describeContents(data: PackageFlowNode["data"]): string {
  if (data.ghost) return "planned, does not exist yet";
  const files = `${data.totalFiles.toLocaleString()} ${data.totalFiles === 1 ? "file" : "files"}`;
  if (data.childCount === 0) return files;
  return `${files} · ${data.childCount} ${data.childCount === 1 ? "module" : "modules"}`;
}

export function statusGlyph(status: "conforming" | "pending" | "violating"): string {
  if (status === "conforming") return "✓";
  if (status === "violating") return "✕";
  return "◌";
}
