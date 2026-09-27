export function cohenKappa(first: string[], second: string[]): number | null {
  const total = first.length;
  const observed = first.filter((label, index) => label === second[index]).length / total;
  const categories = new Set([...first, ...second]);
  const share = (labels: string[], category: string) => labels.filter((label) => label === category).length / total;
  const expected = [...categories].reduce((sum, category) => sum + share(first, category) * share(second, category), 0);
  return expected === 1 ? null : (observed - expected) / (1 - expected);
}

export function spearman(first: number[], second: number[]): number | null {
  return pearson(ranks(first), ranks(second));
}

export function pearson(first: number[], second: number[]): number | null {
  const [meanFirst, meanSecond] = [mean(first), mean(second)];
  const covariance = first.reduce((sum, value, index) => sum + (value - meanFirst) * (second[index]! - meanSecond), 0);
  const spread = (values: number[], centre: number) => Math.sqrt(values.reduce((sum, value) => sum + (value - centre) ** 2, 0));
  const denominator = spread(first, meanFirst) * spread(second, meanSecond);
  return denominator === 0 ? null : covariance / denominator;
}

export function stratifiedSample<T>(items: T[], stratumOf: (item: T) => string, size: number, seed: number): T[] {
  if (size >= items.length) return [...items];
  const random = seededRandom(seed);
  const strata = [...Map.groupBy(items, stratumOf)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const quotas = largestRemainder(strata.map(([, members]) => (members.length * size) / items.length));
  return strata.flatMap(([, members], index) => shuffled(members, random).slice(0, quotas[index]));
}

function largestRemainder(shares: number[]): number[] {
  const quotas = shares.map(Math.floor);
  const remaining = Math.round(shares.reduce((sum, share) => sum + share, 0)) - quotas.reduce((sum, quota) => sum + quota, 0);
  const byRemainder = shares.map((share, index) => ({ index, remainder: share - Math.floor(share) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder.slice(0, remaining)) quotas[index]! += 1;
  return quotas;
}

export function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function ranks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  for (let start = 0; start < order.length; ) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]!.value === order[start]!.value) end++;
    for (let position = start; position <= end; position++) result[order[position]!.index] = (start + end) / 2 + 1;
    start = end + 1;
  }
  return result;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
