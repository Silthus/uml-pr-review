export function signed(value: number): string {
  return value > 0 ? `+${value.toFixed(1)}` : value < 0 ? `−${Math.abs(value).toFixed(1)}` : "0.0";
}

export function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}
