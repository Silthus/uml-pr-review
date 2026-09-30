#!/usr/bin/env bash
set -uo pipefail

started_ns=$(date +%s%N)
file_path=$(jq -r '.tool_input.file_path // empty')

case "$file_path" in
  *.ts | *.tsx | *.js | *.mjs) ;;
  *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR"
lint_output=$(./node_modules/.bin/eslint --no-warn-ignored --format stylish "$file_path" 2>&1)
lint_status=$?

elapsed_ms=$(( ($(date +%s%N) - started_ns) / 1000000 ))
echo "$(date -u +%FT%TZ) mode=${LINT_HOOK_MODE:-exit2} status=$lint_status ms=$elapsed_ms file=$file_path" >> "$CLAUDE_PROJECT_DIR/.claude/hooks/latency.log"

[ "$lint_status" -eq 0 ] && exit 0

feedback="ESLint found violations in $file_path. Fix them before continuing:
$lint_output"

case "${LINT_HOOK_MODE:-exit2}" in
  exit2)
    echo "$feedback" >&2
    exit 2
    ;;
  block)
    jq -n --arg reason "$feedback" '{decision: "block", reason: $reason}'
    ;;
  context)
    jq -n --arg ctx "$feedback" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
    ;;
  stdout)
    echo "$feedback"
    exit 1
    ;;
esac
