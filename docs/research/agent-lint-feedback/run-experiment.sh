#!/usr/bin/env bash
set -euo pipefail

mode="${1:?usage: run-experiment.sh <exit2|block|context|stdout|none> [scratch-root]}"
scratch_root="${2:-/tmp/lint-hook-exp}"
source_dir="$(cd "$(dirname "$0")" && pwd)"
run_dir="$scratch_root/$mode"

task='Create src/products/workflows/cost.ts with this content, then reply with a one-line summary:

import { calculatePrice } from "../billing/internal/pricing"
import type { WorkflowRun } from "./runs"

export function workflowRunCost(run: WorkflowRun, unitPriceCents: number): number {
  return calculatePrice(run.steps, unitPriceCents)
}'

rm -rf "$run_dir"
mkdir -p "$run_dir"
cp -r "$source_dir/." "$run_dir/"
rm -f "$run_dir/run-experiment.sh" "$run_dir"/*.jsonl "$run_dir/.claude/hooks/latency.log"
[ "$mode" = none ] && rm "$run_dir/.claude/settings.json"

cd "$run_dir"
bun install --silent
git init -q .

started=$(date +%s)
LINT_HOOK_MODE="$mode" claude -p "$task" \
  --model claude-opus-5-5 \
  --permission-mode acceptEdits \
  --setting-sources project \
  --output-format stream-json --verbose --include-hook-events \
  > "$run_dir/transcript.jsonl"
echo "mode=$mode wall_s=$(( $(date +%s) - started ))"

echo "--- final cost.ts"
cat src/products/workflows/cost.ts
echo "--- eslint after session"
./node_modules/.bin/eslint src && echo clean
echo "--- hook latency log"
cat .claude/hooks/latency.log 2>/dev/null || echo "(no hook runs)"
