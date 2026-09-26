export type Placement = { x: number; y: number; width: number; height: number };
export type Packed = { width: number; height: number; placements: Map<string, Placement> };

const padding = { top: 64, left: 20, bottom: 20, right: 20 };
const gap = 16;
const targetAspect = 1.2;
const maxColumns = 4;

export function packGrid(items: { id: string; width: number; height: number }[], options: { minWidth: number }): Packed {
  const columns = Math.max(1, Math.min(items.length, maxColumns, Math.ceil(Math.sqrt(items.length * targetAspect))));
  const placements = new Map<string, Placement>();
  let y = padding.top;
  let widest = 0;
  for (let start = 0; start < items.length; start += columns) {
    const row = items.slice(start, start + columns);
    const rowHeight = Math.max(...row.map((item) => item.height));
    let x = padding.left;
    for (const item of row) {
      placements.set(item.id, { x, y, width: item.width, height: item.height });
      x += item.width + gap;
    }
    widest = Math.max(widest, x - gap + padding.right);
    y += rowHeight + gap;
  }
  return { width: Math.max(options.minWidth, widest), height: y - gap + padding.bottom, placements };
}
