import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useCanvasActions } from "./canvas-actions.ts";
import type { MoreFlowNode } from "./flow-elements.ts";

export function MoreNode({ data }: NodeProps<MoreFlowNode>) {
  const actions = useCanvasActions();
  const content = (
    <>
      <strong>{data.label}</strong>
      <span>{data.detail}</span>
    </>
  );
  return (
    <div className={`more-node tone-${data.tone}`}>
      <Handle type="target" position={Position.Left} className="hidden-handle" />
      <Handle type="source" position={Position.Right} className="hidden-handle" />
      {data.expandable && data.parent ? (
        <button type="button" aria-label={`show all modules in ${data.parent}`} onClick={() => actions.showAllChildren(data.parent!)}>{content}</button>
      ) : (
        <div className="more-static">{content}</div>
      )}
    </div>
  );
}
