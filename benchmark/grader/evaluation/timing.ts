import type { Grader } from "../grade.ts";
import { quantile } from "./metrics.ts";

const mainline = "upstream/master";

export async function timeConsecutiveCommits(grader: Grader, count: number): Promise<string> {
  const seconds: number[] = [];
  try {
    for (let back = count; back >= 1; back--) seconds.push((await grader.grade(`${mainline}~${back + 1}`, `${mainline}~${back}`)).seconds);
  } finally {
    grader.close();
  }
  const warm = seconds.slice(1).sort((a, b) => a - b);
  const mean = warm.reduce((sum, value) => sum + value, 0) / Math.max(1, warm.length);
  return `${count} consecutive ${mainline} commits in one process: the first took ${seconds[0]?.toFixed(1)} s, then median ${quantile(warm, 0.5).toFixed(2)} s, p90 ${quantile(warm, 0.9).toFixed(2)} s, mean ${mean.toFixed(2)} s`;
}
