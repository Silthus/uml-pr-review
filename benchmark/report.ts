import { join } from "node:path";
import { parseArgs } from "node:util";
import { renderReport, type Judgement, type TaskReport } from "./lib/report.ts";
import { benchmarkDir, loadRunTask, readJson, taskDirs, taskRunsDir } from "./lib/runs.ts";
import type { TaskScores } from "./lib/score-task.ts";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: { out: { type: "string", default: join(benchmarkDir, "..", "docs", "benchmark", "report.md") } },
  allowPositionals: true,
});

const dirs = positionals.length > 0 ? positionals.map(taskRunsDir) : await taskDirs();
const reports: TaskReport[] = [];
for (const dir of dirs) {
  const scores = await readJson<TaskScores>(join(dir, "scores.json"));
  if (!scores) {
    console.warn(`${dir} has no scores.json yet; run bun benchmark/score.ts first. Skipped.`);
    continue;
  }
  reports.push({ task: await loadRunTask(dir), scores, judgement: await readJson<Judgement>(join(dir, "judge.json")) });
}

await Bun.write(values.out, `${renderReport(reports)}\n`);
console.log(`Wrote ${values.out} from ${reports.length} tasks.`);
