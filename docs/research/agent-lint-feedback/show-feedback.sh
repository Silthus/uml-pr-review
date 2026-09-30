#!/usr/bin/env bash
set -euo pipefail

transcript="${1:?usage: show-feedback.sh <transcript.jsonl>}"

jq -c '
  select(tostring | test("billing internals"))
  | {
      type,
      subtype,
      tool_results: [(.message.content // [])[]? | select(.type == "tool_result") | (.content | tostring | .[0:500])],
      other: (del(.message) | tostring | .[0:500])
    }
' "$transcript"

echo "--- tool calls"
jq -c 'select(.type == "assistant") | .message.content[] | select(.type == "tool_use") | {name, file: .input.file_path, old: (.input.old_string // null), new: (.input.new_string // null)}' "$transcript"
