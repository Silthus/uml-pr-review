import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useCanvasActions } from "./canvas-actions.ts";
import type { MoreFlowNode } from "./flow-elements.ts";

export function MoreNode({ data }: NodeProps<MoreFlowNode>) {
  const actions = useCanvasActions();
  return (
    <div className={`more-node tone-${data.tone}`}>
      <Handle type="target" position={Position.Left} className="hidden-handle" />
      <Handle type="source" position={Position.Right} className="hidden-handle" />
      <button type="button" aria-label={`show all modules in ${data.parent}`} onClick={() => actions.showAllChildren(data.parent)}>
        <strong>+{data.hidden} more</strong>
        <span>smaller modules, show all</span>
      </button>
    </div>
  );
}
