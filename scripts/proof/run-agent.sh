#!/bin/zsh
set -eu
if (( $# < 4 )); then
  echo "Usage: scripts/proof/run-agent.sh <workdir> <mcp config> <prompt> <stream-json log> [--resume <session>]" >&2
  exit 2
fi
workdir="$1"
mcp_config="$2"
prompt="$3"
log_file="$4"
resume=("${@:5}")
[[ -d "$workdir" ]] || { echo "No directory $workdir" >&2; exit 2; }
[[ -f "$mcp_config" ]] || { echo "No MCP config $mcp_config" >&2; exit 2; }
cd "$workdir"
exec env \
  -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_MODEL \
  -u ANTHROPIC_DEFAULT_FABLE_MODEL -u ANTHROPIC_DEFAULT_OPUS_MODEL \
  -u ANTHROPIC_DEFAULT_SONNET_MODEL -u ANTHROPIC_DEFAULT_HAIKU_MODEL \
  -u CLAUDE_CODE_SUBAGENT_MODEL -u ANTHROPIC_CUSTOM_MODEL_OPTION \
  -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_CHILD_SESSION \
  -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN \
  -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SESSION_ATTENDED \
  claude -p "${resume[@]}" \
    --model claude-opus-5-5 \
    --setting-sources local \
    --strict-mcp-config --mcp-config "$mcp_config" \
    --allowedTools "mcp__uml-pr-review__*" \
    --output-format stream-json --verbose \
    "$prompt" > "$log_file" 2>&1
