import { scoreTaskRuns, type ArmScore } from "./lib/score-task.ts";
import { taskRunsDir } from "./lib/runs.ts";
import { posthogRepository } from "./lib/scratch-worktree.ts";

const key = Bun.argv[2];
if (!key) {
  console.error("Usage: bun benchmark/score.ts <pr>\n  Scores every benchmark/runs/<pr>/<arm>/diff.patch against the task's base commit and writes runs/<pr>/scores.json.");
  process.exit(1);
}

const scores = await scoreTaskRuns(taskRunsDir(key), { repository: posthogRepository });
for (const [name, score] of Object.entries(scores.arms)) console.log(`${name.padEnd(12)} ${summary(score)}`);

function summary(score: ArmScore): string {
  if (!score.boundary || !score.focus) return `diff ${score.application}${score.applyError ? `: ${score.applyError}` : ""}`;
  const { facadeBypasses, newCrossProductDependencies, newCycles, newUnresolvedImports } = score.boundary;
  return [
    `hygiene ${score.hygiene}`,
    `bypasses ${facadeBypasses.length}`,
    `new deps ${newCrossProductDependencies.length}`,
    `cycles ${newCycles.length}`,
    `unresolved ${newUnresolvedImports.length}`,
    `files ${score.focus.filesChanged}`,
    `modules ${score.focus.modulesTouched}`,
    `focus ${score.focusScore}`,
  ].join("  ");
}
