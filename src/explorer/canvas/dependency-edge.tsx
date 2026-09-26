import { EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import type { Point } from "../layout/layout-engine.ts";
import { statusGlyph } from "./package-node.tsx";
import { useCanvasActions } from "./canvas-actions.ts";
import type { DependencyFlowEdge } from "./flow-elements.ts";

const cornerRadius = 10;
const arrowLength = 11;
const arrowHalfWidth = 5;

export function DependencyEdge({ id, source, target, data }: EdgeProps<DependencyFlowEdge>) {
  const actions = useCanvasActions();
  if (!data || data.points.length < 2) return null;
  const seam = data.seam;
  const tone = seam?.status === "violating" ? "violating" : data.tone;
  const classes = ["dependency", `tone-${tone}`, seam ? `seam seam-${seam.action}` : "", data.selected ? "selected" : "", data.fresh ? "fresh" : ""].filter(Boolean).join(" ");
  const path = roundedPath(data.points);
  const width = seam ? 2.2 : strokeWidth(data.imports);
  return (
    <g className={classes} data-edge={id}>
      <path className="dependency-hit" d={path} onClick={seam ? () => actions.selectSeam(source, target) : undefined} />
      <path className="dependency-line" d={path} style={{ strokeWidth: width }} />
      <polygon className="dependency-arrow" points={arrowHead(data.points)} />
      {data.labelAt ? (
        <EdgeLabelRenderer>
          <div className={`edge-label tone-${tone} ${seam ? "seam" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${data.labelAt.x}px, ${data.labelAt.y}px)` }} onClick={seam ? () => actions.selectSeam(source, target) : undefined}>
            {seam?.status ? <span className={`status-${seam.status}`}>{statusGlyph(seam.status)}</span> : null}
            <span className="edge-label-text">{data.label.split("\n").map((line, index) => <span key={index}>{line}</span>)}</span>
            {seam && seam.comments > 0 ? <span className="chip chip-comment">{seam.comments}</span> : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
}

function strokeWidth(imports: number): number {
  return Math.min(4.5, 1 + Math.log10(imports + 1) * 0.9);
}

function roundedPath(points: Point[]): string {
  const [first, ...rest] = points;
  if (!first) return "";
  let path = `M ${first.x} ${first.y}`;
  rest.forEach((point, index) => {
    const next = rest[index + 1];
    if (!next) {
      path += ` L ${point.x} ${point.y}`;
      return;
    }
    const before = index === 0 ? first : rest[index - 1]!;
    const entry = towards(point, before, cornerRadius);
    const exit = towards(point, next, cornerRadius);
    path += ` L ${entry.x} ${entry.y} Q ${point.x} ${point.y} ${exit.x} ${exit.y}`;
  });
  return path;
}

function towards(from: Point, to: Point, distance: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const step = Math.min(distance, length / 2);
  return { x: from.x + (dx / length) * step, y: from.y + (dy / length) * step };
}

function arrowHead(points: Point[]): string {
  const tip = points[points.length - 1]!;
  const before = points[points.length - 2]!;
  const dx = tip.x - before.x;
  const dy = tip.y - before.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const base = { x: tip.x - ux * arrowLength, y: tip.y - uy * arrowLength };
  const left = { x: base.x - uy * arrowHalfWidth, y: base.y + ux * arrowHalfWidth };
  const right = { x: base.x + uy * arrowHalfWidth, y: base.y - ux * arrowHalfWidth };
  return `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`;
}
