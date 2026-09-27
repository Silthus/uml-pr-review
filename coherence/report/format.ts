import type { DimensionWeights } from "../contract.ts";
import { dimensionWeights } from "../score.ts";

export function signed(value: number): string {
  const shown = Number(value.toFixed(1));
  return shown > 0 ? `+${shown.toFixed(1)}` : shown < 0 ? `−${Math.abs(shown).toFixed(1)}` : "0.0";
}

export function weightsText(dimensions: (keyof DimensionWeights)[]): string {
  const weights = dimensions.map((dimension) => `${dimension} ${dimensionWeights[dimension]}`);
  return `${weights.slice(0, -1).join(", ")}, and ${weights.at(-1)}`;
}

export function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}
