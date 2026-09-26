#!/bin/zsh
set -eu
home="$(mktemp -d)"
bypass=(env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_MODEL -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_ENTRYPOINT HOME="$home")
echo "\$ HOME=$home claude mcp add --scope user --transport http uml-pr-review http://127.0.0.1:4477/mcp"
"${bypass[@]}" claude mcp add --scope user --transport http uml-pr-review http://127.0.0.1:4477/mcp
echo "\$ HOME=$home claude mcp list"
"${bypass[@]}" claude mcp list
echo "\$ grep -A4 '\"uml-pr-review\"' $home/.claude.json"
grep -A4 '"uml-pr-review"' "$home/.claude.json"
rm -rf "$home"
